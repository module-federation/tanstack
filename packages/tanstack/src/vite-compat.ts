import type { Plugin } from "vite";

/**
 * Fails fast on Vite 7 and older. `@module-federation/vite` loads remotes on the server
 * only through Vite 8's module runner and Rolldown output, so federated SSR breaks
 * silently on older versions.
 */
export function viteVersionPlugin(): Plugin {
  return {
    name: "tanstack-start-federation:vite-version",
    enforce: "pre",
    config() {
      const version = this.meta.viteVersion;
      const major = Number(version?.split(".")[0]);
      if (major < 8) {
        throw new Error(
          `@module-federation/tanstack requires Vite 8; this project runs Vite ${version}.`,
        );
      }
    },
  };
}

const REMOTE_PENDING_EXPORT = "export const __mf_remote_pending =";
const HANDLED_REMOTE_PENDING = /__mf_remote_pending\??\.catch/;
// The export server wrappers use: one load, started when the wrapper is evaluated.
const EAGER_REMOTE_PENDING_EXPORT =
  /export const( __mf_remote_pending =\s*__mfRemotePending\s*\?\?\s*__mfStartRemoteLoad\(\)\.then\(__mfAssignRemoteModule\);)/;
// "let" padded to the length of "const", so the incoming source map stays valid.
const RETRYABLE_REMOTE_PENDING_EXPORT = "export let  $1";

const REMOTE_LOAD_RETRY = `
function __mfTanstackRetryAfterFailure(pending) {
  pending.then(undefined, () => {
    const retry = __mfTanstackNextAttempt();
    if (__mfRemotePending === pending) __mfRemotePending = retry;
    if (__mf_remote_pending === pending) __mf_remote_pending = retry;
  });
}
function __mfTanstackNextAttempt() {
  let attempt;
  const retry = {
    then(onFulfilled, onRejected) {
      if (!attempt) {
        attempt = __mfStartRemoteLoad().then(__mfAssignRemoteModule);
        if (__mfRemotePending === retry) __mfRemotePending = attempt;
        if (__mf_remote_pending === retry) __mf_remote_pending = attempt;
        __mfTanstackRetryAfterFailure(attempt);
      }
      return attempt.then(onFulfilled, onRejected);
    },
  };
  return retry;
}
if (__mfRemotePending) __mfTanstackRetryAfterFailure(__mfRemotePending);
if (__mf_remote_pending !== __mfRemotePending) __mfTanstackRetryAfterFailure(__mf_remote_pending);
`;

// Development server wrappers export `then`, so Vite's module runner waits for the remote
// when it imports them, and caches the outcome for every later import.
const DEV_THEN_EXPORT = "export function then(onFulfilled, onRejected) {";
// Same length, so the incoming source map stays valid.
const RENAMED_DEV_THEN = "function __mfThen1st(onFulfilled, onRejected) {";

const DEV_THEN_RETRY = `
export function then(onFulfilled, onRejected) {
  return __mfThen1st()
    .then(undefined, () => ({
      get default() {
        return __mfDefaultExport;
      },
      get __moduleExports() {
        return exportModule;
      },
      __mf_remote_pending: { then: (resolve, reject) => __mf_remote_pending.then(resolve, reject) },
    }))
    .then(onFulfilled, onRejected);
}
`;

/**
 * Works around two `@module-federation/vite` defects in the wrappers that load remotes.
 *
 * - On the server, a wrapper is evaluated once and makes one load attempt, exported as
 *   `__mf_remote_pending`. When that attempt fails, every later import fails with the same
 *   error, so a server that started during a remote outage never renders that remote. The
 *   adapter makes the next import after a failure start a new attempt.
 *   In development, the wrapper's `then` export also resolves after a failed load, with
 *   exports that read the retried load: Vite's module runner would otherwise cache the
 *   rejection for every later import.
 * - A wrapper re-evaluated after its remote was cached exports a fresh load that nothing
 *   awaits, so a remote outage becomes an unhandled rejection that exits the Vite dev
 *   server. Awaiting the export still rejects. Wrappers that handle it are left alone.
 *
 * Reported as module-federation/vite#1424 and fixed for the rejection in #1421.
 */
export function remotePendingPlugin(): Plugin {
  return {
    name: "tanstack-start-federation:remote-pending",
    enforce: "post",
    transform: {
      filter: { id: /__loadRemote__/ },
      handler(code) {
        if (EAGER_REMOTE_PENDING_EXPORT.test(code)) {
          // The retry handles every rejection, so it also prevents the unhandled one.
          let retrying =
            code.replace(EAGER_REMOTE_PENDING_EXPORT, RETRYABLE_REMOTE_PENDING_EXPORT) +
            REMOTE_LOAD_RETRY;
          if (retrying.includes(DEV_THEN_EXPORT)) {
            retrying = retrying.replace(DEV_THEN_EXPORT, RENAMED_DEV_THEN) + DEV_THEN_RETRY;
          }
          return { code: retrying, map: null };
        }
        if (!code.includes(REMOTE_PENDING_EXPORT) || HANDLED_REMOTE_PENDING.test(code)) return;
        // Appending moves no code, so the incoming source map stays valid.
        return { code: `${code}\n__mf_remote_pending?.catch?.(() => {});\n`, map: null };
      },
    },
  };
}

const TEMP_MODULE_IMPORT =
  /(async function importTempModule\([^)]*\)\s*\{\s*return await )import\(/;

/**
 * Works around a `@module-federation/vite` defect in development. Its SSR loader saves a
 * remote's server entry to a temporary file and imports it, but in a dev server that
 * import goes through Vite's module runner, which evaluates every file as an ES module.
 * CommonJS entries, such as Rsbuild server containers, then fail with "module is not
 * defined". Importing through Node lets it choose the format, as production builds do.
 * Reported as module-federation/vite#1423.
 */
export function nativeTempModuleImportPlugin(): Plugin {
  return {
    name: "tanstack-start-federation:native-temp-module-import",
    apply: "serve",
    transform: {
      filter: { id: /@module-federation[\\/]vite[\\/]lib[\\/]ssrEntryLoader-[^\\/?]+\.js(?:\?|$)/ },
      handler(code) {
        if (!TEMP_MODULE_IMPORT.test(code)) return;
        // `Function` code imports through Node's loader, not the module runner. The helper
        // goes at the end so earlier lines keep their positions for the source map.
        return {
          code:
            code.replace(TEMP_MODULE_IMPORT, "$1__mfNativeImport(") +
            '\nconst __mfNativeImport = new Function("specifier", "return import(specifier)");\n',
          map: null,
        };
      },
    },
  };
}
