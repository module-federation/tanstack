import type { ModuleFederation, ModuleFederationRuntimePlugin } from "@module-federation/runtime";
import { tanstackStartSharedPackages } from "./shared";

type LoadEntryArgs = Parameters<NonNullable<ModuleFederationRuntimePlugin["loadEntry"]>>[0];
type RemoteEntryExports = NonNullable<LoadEntryArgs["remoteEntryExports"]>;
type RemoteInfo = LoadEntryArgs["remoteInfo"];
type FederationHost = LoadEntryArgs["origin"];
type NodeModule = typeof import("node:module");
type RuntimeShareConfig = {
  requiredVersion: false | string;
  eager?: boolean;
  singleton?: boolean;
  strictVersion?: boolean;
  layer?: string | null;
};

const tanstackStartResolutionPackages = [
  "@tanstack/react-start",
  ...tanstackStartSharedPackages,
] as const;

export interface NodeEntryLoaderOptions {
  /** Re-check manifest/server entries after this many milliseconds. Omit to cache until exit. */
  maxAgeMs?: number;
  /** Revalidation strategy used by the Vite SSR entry loader. */
  strategy?: "temp-file" | "vm";
  /** Maximum time for a server-entry request. Defaults to 10 seconds; 0 disables the timeout. */
  fetchTimeoutMs?: number;
  /** Maximum server-entry response size for Vite remotes; 0 disables the limit. */
  fetchMaxBytes?: number;
}

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
 * - ES module entries (Vite remotes) use `@module-federation/vite`'s SSR loader in production.
 *   Vite 8 dev entries use the same ModuleRunner protocol with a host-aware transport, because
 *   TanStack Start's dev server exposes its SSR entry through the client environment and would
 *   otherwise evaluate optimized React and Router dependencies locally.
 *   The loader is loaded with Node's `require`, not the bundle's, so its `import()` calls work
 *   in Rsbuild's runner too.
 */
export default function nodeEntryLoaderPlugin(
  options: NodeEntryLoaderOptions = {},
): ModuleFederationRuntimePlugin {
  const revalidationHooks = isRevalidationEnabled(options.maxAgeMs)
    ? createRevalidationHooks(options.maxAgeMs)
    : {};

  return {
    name: "tanstack-start-node-entry-loader",
    ...revalidationHooks,
    apply(origin) {
      if (!isNodeServer()) return;
      registerNodeSharedModules(origin);
    },
    async loadEntry(args) {
      const { remoteInfo } = args;
      if (!isNodeServer() || !/^https?:\/\//.test(remoteInfo.entry)) return undefined;
      if (remoteInfo.type === "commonjs-module") {
        return loadCommonJsEntry(remoteInfo, options.fetchTimeoutMs);
      }
      if (remoteInfo.type === "module" || remoteInfo.type === "esm") {
        return loadModuleEntry(args, options);
      }
      return undefined;
    },
  };
}

// Matches @module-federation/vite's SSR fetch timeout.
const FETCH_TIMEOUT_MS = 10_000;

function requestOptions(fetchTimeoutMs: number | undefined) {
  const timeout = fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
  return timeout === 0 ? {} : { signal: AbortSignal.timeout(timeout) };
}

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

type ResolvedPackage = { path: string; require: NodeJS.Require };

function resolvePackage(
  specifier: string,
  requires: NodeJS.Require[],
): ResolvedPackage | undefined {
  for (const require of requires) {
    const resolved = resolveFromRequire(specifier, require);
    if (resolved) return { path: resolved, require };
  }

  // pnpm can place a transitive shared dependency below the package that imports it. In that
  // case resolving from the app root fails even though the package is part of the app's graph.
  // Resolve through TanStack Start's package roots before giving up.
  for (const parentPackage of tanstackStartResolutionPackages) {
    for (const appRequire of requires) {
      const parent = resolvePackageRoot(parentPackage, appRequire);
      if (!parent) continue;

      const parentRequire = nodeModule().createRequire(parent);
      const resolved = resolveFromRequire(specifier, parentRequire);
      if (resolved) return { path: resolved, require: parentRequire };
    }
  }

  return undefined;
}

function resolveFromRequire(specifier: string, require: NodeJS.Require) {
  try {
    return require.resolve(specifier);
  } catch {
    return undefined;
  }
}

function resolvePackageRoot(specifier: string, require: NodeJS.Require) {
  return (
    resolveFromRequire(specifier, require) ??
    resolveFromRequire(`${specifier}/package.json`, require)
  );
}

async function loadCommonJsEntry(
  { entry, entryGlobalName, name }: RemoteInfo,
  fetchTimeoutMs = FETCH_TIMEOUT_MS,
) {
  let source: string;
  try {
    const response = await fetch(entry, requestOptions(fetchTimeoutMs));
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
  default: (options: {
    resolvedShared: Record<string, string>;
    maxAgeMs?: number;
    strategy?: "temp-file" | "vm";
    fetchTimeoutMs?: number;
    fetchMaxBytes?: number;
  }) => ModuleFederationRuntimePlugin;
  revalidate?: (remoteEntryUrl?: string) => void;
  SsrEntryHttpError?: new (...args: never[]) => Error;
};

type ViteLoader = {
  httpError?: ViteSsrEntryLoaderModule["SsrEntryHttpError"];
  plugin: ModuleFederationRuntimePlugin;
  revalidate?: ViteSsrEntryLoaderModule["revalidate"];
  require: NodeJS.Require;
  resolvedShared: Record<string, string>;
};

const viteLoaders = new WeakMap<ModuleFederation, ViteLoader>();

function registerNodeSharedModules(origin: FederationHost) {
  const requires = appRequires();
  const shared: Record<
    string,
    {
      version: string;
      lib: () => any;
      loaded: true;
      scope?: string | string[];
      shareConfig: RuntimeShareConfig;
    }
  > = {};

  for (const packageName of tanstackStartSharedPackages) {
    const resolved = resolvePackage(packageName, requires);
    if (!resolved) continue;

    const version = readPackageVersion(resolved.path, packageName);
    if (!version) continue;

    const configured = origin.options.shared[packageName]?.[0] as
      { scope?: string | string[]; shareConfig?: Record<string, unknown> } | undefined;
    shared[packageName] = {
      version,
      lib: () => resolved.require(resolved.path),
      loaded: true,
      scope: configured?.scope,
      shareConfig: {
        eager: true,
        singleton: true,
        requiredVersion: version,
        ...configured?.shareConfig,
      } as RuntimeShareConfig,
    };
  }

  if (Object.keys(shared).length > 0) origin.registerShared(shared);
}

function readPackageVersion(filename: string, packageName: string) {
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  let directory = path.dirname(filename);

  while (true) {
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (packageJson.name === packageName) return packageJson.version;
    } catch {
      // Continue walking toward the application root.
    }

    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function loadModuleEntry(args: LoadEntryArgs, options: NodeEntryLoaderOptions) {
  const { entry, name } = args.remoteInfo;
  let viteLoader = viteLoaders.get(args.origin);
  if (!viteLoader) {
    viteLoader = createViteLoader(args, options);
    viteLoaders.set(args.origin, viteLoader);
  }
  // Shared modules the host loaded since the last remote are aligned too.
  provideHostModules(args.origin, viteLoader.resolvedShared, viteLoader.require);

  let remoteEntry: RemoteEntryExports | void;
  try {
    const devEntry = resolveViteDevEntry(entry);
    remoteEntry = devEntry
      ? await loadViteDevEntry(devEntry, viteLoader)
      : await viteLoader.plugin.loadEntry?.(args);
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
      ...requestOptions(options.fetchTimeoutMs),
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

type ViteModuleRunner = { import<T>(url: string): Promise<T> };

const viteDevRunners = new Map<string, Promise<ViteModuleRunner>>();

/** Uses the Vite 8 runner protocol for TanStack Start's development SSR entries. */
function resolveViteDevEntry(entry: string) {
  return entry.includes("/__mf_ssr__/") ? entry : undefined;
}

async function loadViteDevEntry(
  entry: string,
  loader: ViteLoader,
): Promise<RemoteEntryExports | void> {
  const remoteOrigin = new URL(entry).origin;
  const runnerKey = `${remoteOrigin}:${JSON.stringify(loader.resolvedShared)}`;
  let runner = viteDevRunners.get(runnerKey);
  if (!runner) {
    runner = createViteDevRunner(remoteOrigin, loader);
    viteDevRunners.set(runnerKey, runner);
  }
  return runner
    .then((module) => module.import<RemoteEntryExports>(new URL(entry).pathname))
    .catch((error: unknown) => {
      if (viteDevRunners.get(runnerKey) === runner) viteDevRunners.delete(runnerKey);
      throw error;
    });
}

async function createViteDevRunner(
  remoteOrigin: string,
  loader: ViteLoader,
): Promise<ViteModuleRunner> {
  const { ModuleRunner, ESModulesEvaluator } = loader.require("vite/module-runner") as {
    ModuleRunner: new (
      options: {
        hmr: false;
        transport: { invoke(payload: unknown): Promise<unknown> };
      },
      evaluator: unknown,
    ) => ViteModuleRunner;
    ESModulesEvaluator: new () => unknown;
  };
  const runnerEndpoint = `${remoteOrigin}/__mf_runner__`;
  const pathToFileURL = (process.getBuiltinModule("node:url") as typeof import("node:url"))
    .pathToFileURL;

  return new ModuleRunner(
    {
      hmr: false,
      transport: {
        async invoke(payload: unknown) {
          const response = await fetch(runnerEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          const result = await response.json();
          const data = payload as {
            data?: { data?: [string]; name?: string };
          };
          const id = data.data?.data?.[0];
          const sharedPath =
            data.data?.name === "fetchModule" && id
              ? resolveViteSharedPath(id, loader.resolvedShared)
              : undefined;
          if (sharedPath) {
            return {
              result: { externalize: pathToFileURL(sharedPath).href, type: "module" },
            };
          }
          return result;
        },
      },
    },
    new ESModulesEvaluator(),
  );
}

function resolveViteSharedPath(id: string, resolvedShared: Record<string, string>) {
  const cleanId = id.split("?", 1)[0] ?? id;
  for (const [packageName, filename] of Object.entries(resolvedShared).sort(
    ([left], [right]) => right.length - left.length,
  )) {
    if (
      cleanId === packageName ||
      cleanId.startsWith(`${packageName}/`) ||
      cleanId.includes(`/node_modules/.vite/deps/${packageName.replaceAll("/", "_")}`)
    ) {
      return filename;
    }
  }
  return undefined;
}

function createViteLoader(
  { origin, remoteInfo }: LoadEntryArgs,
  options: NodeEntryLoaderOptions,
): ViteLoader {
  const requires = appRequires();

  const loader = resolvePackage("@module-federation/vite/ssrEntryLoader", requires);
  if (!loader) {
    throw new RemoteEntryError(
      `Remote "${remoteInfo.name}" is a Vite remote. Add @module-federation/vite to the ` +
        "host's dependencies to render it on the server.",
      { phase: "loader", remote: remoteInfo.name, url: remoteInfo.entry },
    );
  }

  const resolvedShared: Record<string, string> = {};
  for (const specifier of [...VITE_SHARED_PACKAGES, ...Object.keys(origin.options.shared)]) {
    const resolved = resolvePackage(specifier, requires);
    if (resolved) resolvedShared[specifier] = resolved.path;
  }
  // The loader is an ES module; Node 22.12+ requires it synchronously.
  const loaderModule = loader.require(loader.path) as ViteSsrEntryLoaderModule;
  return {
    httpError: loaderModule.SsrEntryHttpError,
    plugin: loaderModule.default({ resolvedShared, ...options }),
    revalidate: loaderModule.revalidate,
    require: loader.require,
    resolvedShared,
  };
}

function isRevalidationEnabled(maxAgeMs: number | undefined): maxAgeMs is number {
  return typeof maxAgeMs === "number" && Number.isFinite(maxAgeMs) && maxAgeMs >= 0;
}

function createRevalidationHooks(maxAgeMs: number) {
  const lastLoadedAtByOrigin = new WeakMap<ModuleFederation, Map<string, number>>();
  // Re-registration is synchronous, but loading and evaluating the new entry is not. Keep a
  // per-remote barrier so concurrent expired requests share that asynchronous revalidation.
  const pendingRevalidationsByOrigin = new WeakMap<
    ModuleFederation,
    Map<string, PendingRevalidation>
  >();

  return {
    async beforeRequest(context) {
      const { id, origin } = context;
      const remote = findRemote(origin, id);
      if (!remote) return context;

      const pendingRevalidations = getPendingRevalidations(origin);
      const pendingRevalidation = pendingRevalidations.get(remote.name);
      if (pendingRevalidation) {
        await pendingRevalidation.promise;
        return context;
      }

      const lastLoadedAt = getLastLoadedAt(origin);
      const loadedAt = lastLoadedAt.get(remote.name);
      if (loadedAt !== undefined && Date.now() - loadedAt >= maxAgeMs) {
        lastLoadedAt.delete(remote.name);
        const nextRevalidation = createPendingRevalidation();
        pendingRevalidations.set(remote.name, nextRevalidation);
        try {
          invalidateRemote(origin, remote);
        } catch (error) {
          pendingRevalidations.delete(remote.name);
          nextRevalidation.resolve();
          throw error;
        }
      }
      return context;
    },
    afterLoadRemote({ origin, remote, error }) {
      if (!remote) return;
      const pendingRevalidations = getPendingRevalidations(origin);
      const lastLoadedAt = getLastLoadedAt(origin);
      if (!error && !lastLoadedAt.has(remote.name)) lastLoadedAt.set(remote.name, Date.now());
      const pendingRevalidation = pendingRevalidations.get(remote.name);
      if (pendingRevalidation) {
        pendingRevalidations.delete(remote.name);
        pendingRevalidation.resolve();
      }
    },
  } satisfies Pick<ModuleFederationRuntimePlugin, "beforeRequest" | "afterLoadRemote">;

  function getLastLoadedAt(origin: ModuleFederation) {
    let lastLoadedAt = lastLoadedAtByOrigin.get(origin);
    if (!lastLoadedAt) {
      lastLoadedAt = new Map();
      lastLoadedAtByOrigin.set(origin, lastLoadedAt);
    }
    return lastLoadedAt;
  }

  function getPendingRevalidations(origin: ModuleFederation) {
    let pendingRevalidations = pendingRevalidationsByOrigin.get(origin);
    if (!pendingRevalidations) {
      pendingRevalidations = new Map();
      pendingRevalidationsByOrigin.set(origin, pendingRevalidations);
    }
    return pendingRevalidations;
  }
}

interface PendingRevalidation {
  promise: Promise<void>;
  resolve: () => void;
}

function createPendingRevalidation(): PendingRevalidation {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function findRemote(origin: ModuleFederation, id: string) {
  return origin.options.remotes.find((remote) => {
    const names = [remote.name, remote.alias].filter(
      (name): name is string => typeof name === "string",
    );
    return names.some((name) => id === name || id.startsWith(`${name}/`));
  });
}

function invalidateRemote(
  origin: ModuleFederation,
  remote: ModuleFederation["options"]["remotes"][number],
) {
  if (
    (remote.type === "module" || remote.type === "esm") &&
    "entry" in remote &&
    typeof remote.entry === "string"
  ) {
    viteLoaders.get(origin)?.revalidate?.(remote.entry);
  }
  origin.registerRemotes([{ ...remote }], { force: true });
}

/**
 * Vite remotes can import shared packages from node_modules instead of the share scope:
 * the Vite dev transport and the production loader both resolve them to the host's files.
 * Registering those files in Node's module cache and Vite's shared-module cache keeps one
 * instance of every configured package, including the React and Router runtimes.
 */
function provideHostModules(
  origin: FederationHost,
  resolvedShared: Record<string, string>,
  require: NodeJS.Require,
) {
  const Module = nodeModule() as unknown as new (id: string) => CompilableModule & {
    loaded: boolean;
  };
  for (const [scopeName, scope] of Object.entries(origin.shareScopeMap)) {
    for (const [packageName, versions] of Object.entries(scope)) {
      const provided = Object.values(versions).find(
        (shared) => shared.from === origin.name && shared.loaded && shared.lib,
      );
      if (!provided?.lib) continue;

      const sharedModule = provided.lib();
      provideViteSharedModule(scopeName, packageName, sharedModule);
      const filename =
        resolvedShared[packageName] ?? findCachedModuleFilename(sharedModule, require);
      if (filename) resolvedShared[packageName] ??= filename;

      // Something already loaded this package from node_modules; nothing else to align.
      if (!filename || require.cache[filename]) continue;

      const cached = new Module(filename);
      cached.filename = filename;
      cached.exports = sharedModule;
      cached.loaded = true;
      require.cache[filename] = cached as unknown as NodeJS.Module;
    }
  }
}

function findCachedModuleFilename(exports: unknown, require: NodeJS.Require) {
  const cache = (require as NodeJS.Require & { cache: Record<string, NodeJS.Module> }).cache;
  for (const [filename, cached] of Object.entries(cache)) {
    if (cached?.exports === exports) return filename;
  }
  return undefined;
}

type ViteModuleCache = {
  share?: Record<string, unknown>;
};

type ViteModuleCacheGlobals = typeof globalThis & {
  __mf_module_cache__?: ViteModuleCache;
  __mf_module_cache_react_server__?: ViteModuleCache;
};

/**
 * Vite's dev ModuleRunner consults this cache before falling back to its own optimized
 * dependency graph. Seed it with the host's already-loaded singleton so a Vite SSR remote
 * cannot create a second React or Router context in the same server process.
 */
function provideViteSharedModule(scopeName: string, packageName: string, module: unknown) {
  const globalState = globalThis as ViteModuleCacheGlobals;
  for (const cacheKey of ["__mf_module_cache__", "__mf_module_cache_react_server__"] as const) {
    const cache = (globalState[cacheKey] ??= {});
    const share = (cache.share ??= {});
    share[`${scopeName}:${packageName}`] ??= module;
    if (scopeName === "default") share[packageName] ??= module;
  }
}
