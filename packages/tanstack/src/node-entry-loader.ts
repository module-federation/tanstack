import type { ModuleFederationRuntimePlugin } from "@module-federation/runtime";

type LoadEntryArgs = Parameters<NonNullable<ModuleFederationRuntimePlugin["loadEntry"]>>[0];
type RemoteEntryExports = NonNullable<LoadEntryArgs["remoteEntryExports"]>;
type RemoteInfo = LoadEntryArgs["remoteInfo"];
type FederationHost = LoadEntryArgs["origin"];
type NodeModule = typeof import("node:module");

/** A remote's server entry failed to load. `phase` says which step failed; `cause` keeps the original error. */
export class RemoteEntryError extends Error {
  readonly phase: "fetch" | "evaluate" | "loader";
  readonly remote: string;
  readonly url: string;

  constructor(
    message: string,
    options: { cause?: unknown; phase: RemoteEntryError["phase"]; remote: string; url: string },
  ) {
    super(message, { cause: options.cause });
    this.name = "RemoteEntryError";
    this.phase = options.phase;
    this.remote = options.remote;
    this.url = options.url;
  }
}

/**
 * Loads remote server entries for an Rsbuild host's server bundle.
 *
 * - CommonJS containers (Rsbuild remotes) are fetched and compiled here as CommonJS
 *   modules, so their own `import()` calls work. Module Federation's default Node loader
 *   evaluates them with `vm`, which Rsbuild's development runner cannot support.
 * - ES module entries (Vite remotes) go to `@module-federation/vite`'s SSR loader, which
 *   handles both production builds and Vite dev servers. It is loaded with Node's
 *   `require`, not the bundle's, so its `import()` calls work in Rsbuild's runner too.
 */
export default function nodeEntryLoaderPlugin(): ModuleFederationRuntimePlugin {
  return {
    name: "tanstack-start-node-entry-loader",
    async loadEntry(args) {
      const { remoteInfo } = args;
      if (!isNodeServer() || !/^https?:\/\//.test(remoteInfo.entry)) return undefined;
      if (remoteInfo.type === "commonjs-module") return loadCommonJsEntry(remoteInfo);
      if (remoteInfo.type === "module" || remoteInfo.type === "esm") return loadModuleEntry(args);
      return undefined;
    },
  };
}

// Matches @module-federation/vite's SSR fetch timeout.
const FETCH_TIMEOUT_MS = 10_000;

function isNodeServer() {
  return typeof process !== "undefined" && typeof process.getBuiltinModule === "function";
}

function nodeModule() {
  return process.getBuiltinModule("node:module") as NodeModule;
}

/** Requires from the app, because the host's server bundle has no node_modules of its own. */
function appRequires() {
  const { createRequire } = nodeModule();
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  // The app root first, then the entry script for servers started from elsewhere.
  return [path.join(process.cwd(), "package.json"), process.argv[1]]
    .filter((base): base is string => Boolean(base))
    .map((base) => createRequire(base));
}

async function loadCommonJsEntry({ entry, entryGlobalName, name }: RemoteInfo) {
  let source: string;
  try {
    const response = await fetch(entry, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    source = await response.text();
  } catch (cause) {
    throw new RemoteEntryError(
      `Could not fetch the server entry of remote "${name}" from ${entry}.`,
      {
        cause,
        phase: "fetch",
        remote: name,
        url: entry,
      },
    );
  }

  let exports: Record<string, unknown>;
  try {
    const Module = nodeModule() as unknown as new (id: string) => CompilableModule;
    const container = new Module(entry);
    container.filename = entry;
    container.paths = appRequires()[0]?.resolve.paths("react") ?? [];
    // What `require()` does with a file's source: Node compiles it as a CommonJS module
    // whose `import()` calls use Node's own loader.
    container._compile(source, entry, "commonjs");
    exports = container.exports as Record<string, unknown>;
  } catch (cause) {
    throw new RemoteEntryError(`The server entry of remote "${name}" threw while loading.`, {
      cause,
      phase: "evaluate",
      remote: name,
      url: entry,
    });
  }

  const remoteEntry = (entryGlobalName && exports[entryGlobalName]) || exports;
  if (!isRemoteEntry(remoteEntry)) {
    throw new RemoteEntryError(
      `The server entry of remote "${name}" did not export a federation container.`,
      { phase: "evaluate", remote: name, url: entry },
    );
  }
  return remoteEntry;
}

interface CompilableModule {
  exports: unknown;
  filename: string;
  paths: string[];
  _compile(source: string, filename: string, format?: "commonjs"): void;
}

function isRemoteEntry(value: unknown): value is RemoteEntryExports {
  const candidate = value as Partial<RemoteEntryExports> | undefined;
  return typeof candidate?.get === "function" && typeof candidate.init === "function";
}

// Packages a Vite remote's server code may import directly, besides the host's shared
// packages. Resolving them from the host keeps one copy of each in the process.
const VITE_SHARED_PACKAGES = [
  "@module-federation/runtime",
  "@module-federation/runtime-core",
  "@module-federation/sdk",
  "react",
  "react-dom",
  "react/compiler-runtime",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
];

type ViteSsrEntryLoaderModule = {
  default: (options: { resolvedShared: Record<string, string> }) => ModuleFederationRuntimePlugin;
  SsrEntryHttpError?: new (...args: never[]) => Error;
};

type ViteLoader = {
  httpError?: ViteSsrEntryLoaderModule["SsrEntryHttpError"];
  plugin: ModuleFederationRuntimePlugin;
  require: NodeJS.Require;
  resolvedShared: Record<string, string>;
};

let viteLoader: ViteLoader | undefined;

async function loadModuleEntry(args: LoadEntryArgs) {
  const { entry, name } = args.remoteInfo;
  viteLoader ??= createViteLoader(args);
  // Shared modules the host loaded since the last remote are aligned too.
  provideHostModules(args.origin, viteLoader.resolvedShared, viteLoader.require);

  let remoteEntry: RemoteEntryExports | void;
  try {
    remoteEntry = await viteLoader.plugin.loadEntry?.(args);
  } catch (cause) {
    const { httpError } = viteLoader;
    throw new RemoteEntryError(
      `Could not load the server entry of remote "${name}" from ${entry}.`,
      {
        cause,
        phase: httpError && cause instanceof httpError ? "fetch" : "evaluate",
        remote: name,
        url: entry,
      },
    );
  }
  // Without an entry the runtime would try its own Node loader, which cannot load ES
  // modules without Node flags. Report the failure instead. The Vite loader returns
  // nothing for an unreachable remote, so tell that case apart.
  if (!remoteEntry) {
    const reachable = await fetch(entry, {
      method: "HEAD",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then(
      (response) => response.ok,
      () => false,
    );
    throw new RemoteEntryError(
      reachable
        ? `@module-federation/vite could not load the server entry of remote "${name}" ` +
            `from ${entry}; its warnings have the cause.`
        : `Could not reach remote "${name}" at ${entry}.`,
      { phase: reachable ? "loader" : "fetch", remote: name, url: entry },
    );
  }
  return remoteEntry;
}

function createViteLoader({ origin, remoteInfo }: LoadEntryArgs): ViteLoader {
  const requires = appRequires();
  const resolve = (specifier: string) => {
    for (const require of requires) {
      try {
        return { path: require.resolve(specifier), require };
      } catch {
        // Try the next base.
      }
    }
    return undefined;
  };

  const loader = resolve("@module-federation/vite/ssrEntryLoader");
  if (!loader) {
    throw new RemoteEntryError(
      `Remote "${remoteInfo.name}" is a Vite remote. Add @module-federation/vite to the ` +
        "host's dependencies to render it on the server.",
      { phase: "loader", remote: remoteInfo.name, url: remoteInfo.entry },
    );
  }

  const resolvedShared: Record<string, string> = {};
  for (const specifier of [...VITE_SHARED_PACKAGES, ...Object.keys(origin.options.shared)]) {
    const resolved = resolve(specifier);
    if (resolved) resolvedShared[specifier] = resolved.path;
  }

  // The loader is an ES module; Node 22.12+ requires it synchronously.
  const loaderModule = loader.require(loader.path) as ViteSsrEntryLoaderModule;
  return {
    httpError: loaderModule.SsrEntryHttpError,
    plugin: loaderModule.default({ resolvedShared }),
    require: loader.require,
    resolvedShared,
  };
}

/**
 * Vite remotes can import shared packages from node_modules instead of the share scope:
 * a Vite dev server's module runner externalizes them, and resolved imports in production
 * builds point there. The host bundles its own copies, so this registers them in Node's
 * module cache under their node_modules paths. The process then keeps one React.
 */
function provideHostModules(
  origin: FederationHost,
  resolvedShared: Record<string, string>,
  require: NodeJS.Require,
) {
  const Module = nodeModule() as unknown as new (id: string) => CompilableModule & {
    loaded: boolean;
  };
  for (const scope of Object.values(origin.shareScopeMap)) {
    for (const [packageName, versions] of Object.entries(scope)) {
      const filename = resolvedShared[packageName];
      // Something already loaded this package from node_modules; nothing to align.
      if (!filename || require.cache[filename]) continue;
      const provided = Object.values(versions).find(
        (shared) => shared.from === origin.name && shared.loaded && shared.lib,
      );
      if (!provided?.lib) continue;

      const cached = new Module(filename);
      cached.filename = filename;
      cached.exports = provided.lib();
      cached.loaded = true;
      require.cache[filename] = cached as unknown as NodeJS.Module;
    }
  }
}
