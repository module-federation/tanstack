import { join } from "node:path";
import {
  pluginModuleFederation,
  type ModuleFederationOptions,
} from "@module-federation/rsbuild-plugin";
import type { RsbuildPlugin } from "@rsbuild/core";
import type { NodeEntryLoaderOptions } from "./node-entry-loader";
import { defaultShared, eagerShared, resolveShared, tanstackStartSharedPackages } from "./shared";

type ModuleFederationOverride = Partial<ModuleFederationOptions>;

type ClientFederationOptions = ModuleFederationOverride & {
  chunkLoadingGlobal?: string;
  environment?: string;
  forceScriptOutput?: boolean;
};

type ServerFederationOptions =
  | false
  | (ModuleFederationOverride & {
      chunkFilename?: string;
      entryFilename?: string;
      environment?: string;
      forceCommonJsOutput?: boolean;
      ssrEntryLoader?: NodeEntryLoaderOptions;
    });

export type TanStackStartRsbuildModuleFederationOptions = {
  client?: ClientFederationOptions;
  federation: ModuleFederationOptions;
  /**
   * Server-side federation. Pass `true` or an options object to enable it. Defaults to
   * `false`: browser-only federation.
   *
   * - With `exposes`, the build adds a Node container, `remoteEntry.ssr.cjs`, next to the
   *   browser entry (its chunks go in `ssr/`) and advertises it in the browser manifest
   *   as `ssrRemoteEntry`.
   * - With `remotes`, TanStack Start's server environment loads remotes through the
   *   Module Federation Node runtime, as async-node CommonJS (`dist/server/index.cjs`).
   */
  server?: ServerFederationOptions | true;
};

// The server container sits next to the manifest, like a Vite remote's SSR entry. Hosts
// resolve its chunks from either the container URL (Module Federation's Node runtime) or
// the manifest URL (`@module-federation/vite`), so both must share a directory. The
// extension says the container is CommonJS.
const SERVER_CONTAINER_FILENAME = "remoteEntry.ssr.cjs";
const SERVER_CHUNK_DIR = "ssr";
const SERVER_CONTAINER_ENVIRONMENT = "mf-server";
const NODE_ENTRY_LOADER = "@module-federation/tanstack/node-entry-loader";

/** Creates browser and optional SSR federation adapters for TanStack Start's Rsbuild integration. */
export function tanstackStartModuleFederation({
  client = {},
  federation,
  server = false,
}: TanStackStartRsbuildModuleFederationOptions): RsbuildPlugin[] {
  const {
    chunkLoadingGlobal,
    environment: clientEnvironment = "client",
    forceScriptOutput = true,
    ...clientOverrides
  } = client;
  const federationName = federation.name;
  if (!federationName) throw new Error("federation.name is required");

  const isHost = hasEntries(federation.remotes);
  const isRemote = hasEntries(federation.exposes);
  const serverEnabled = server !== false;
  const exposesServerContainer = serverEnabled && isRemote;

  const clientFederationOptions = withDefaults(
    { ...federation, ...clientOverrides },
    isHost ? eagerShared : defaultShared,
  );
  if (exposesServerContainer) advertiseServerContainer(clientFederationOptions);

  const plugins: RsbuildPlugin[] = [
    pluginModuleFederation(clientFederationOptions, {
      environment: clientEnvironment,
      target: "web",
    }),
    ...(isHost ? [remoteRetryPlugin()] : []),
    clientCompatibilityPlugin({
      chunkLoadingGlobal: chunkLoadingGlobal ?? `chunk_${federationName}`,
      environment: clientEnvironment,
      forceScriptOutput,
      isRemote,
      name: federationName,
    }),
  ];

  if (!serverEnabled) return plugins;

  const {
    chunkFilename,
    entryFilename,
    environment: serverEnvironment = "ssr",
    forceCommonJsOutput = true,
    ssrEntryLoader,
    ...serverOverrides
  } = server === true ? {} : server;

  if (exposesServerContainer) {
    const { remotes: _remotes, ...containerOptions } = { ...federation, ...serverOverrides };
    plugins.push(
      serverContainerEnvironmentPlugin({ clientEnvironment }),
      pluginModuleFederation(
        withDefaults(
          {
            ...containerOptions,
            // The browser build owns the manifest and the federated types.
            dev: false,
            dts: false,
            filename: SERVER_CONTAINER_FILENAME,
            manifest: false,
          },
          defaultShared,
        ),
        { environment: SERVER_CONTAINER_ENVIRONMENT, target: "node" },
      ),
    );
  }

  if (isHost) {
    // The host's own server bundle consumes remotes. Its container, if any, is built by the
    // dedicated environment above, so TanStack's server output never contains one.
    const { exposes: _exposes, ...hostOptions } = { ...federation, ...serverOverrides };
    const serverHostOptions = withDefaults(hostOptions, eagerShared);
    serverHostOptions.shared = externalizeServerShared(serverHostOptions.shared);
    plugins.push(
      pluginModuleFederation(
        {
          ...serverHostOptions,
          manifest: false,
          runtimePlugins: [
            ...(hostOptions.runtimePlugins ?? []),
            ssrEntryLoader
              ? [NODE_ENTRY_LOADER, Object.fromEntries(Object.entries(ssrEntryLoader))]
              : NODE_ENTRY_LOADER,
          ],
        },
        { environment: serverEnvironment, target: "node" },
      ),
      serverCompatibilityPlugin({
        chunkFilename:
          chunkFilename ?? (forceCommonJsOutput ? `[id].${federationName}.cjs` : undefined),
        entryFilename: entryFilename ?? (forceCommonJsOutput ? "[name].cjs" : undefined),
        environment: serverEnvironment,
        forceCommonJsOutput,
      }),
    );
  }

  return plugins;
}

export const pluginTanStackStartModuleFederation = tanstackStartModuleFederation;

function isAbsoluteUrl(value: unknown): boolean {
  return typeof value === "string" && /^[a-z][a-z\d+.-]*:\/\//i.test(value);
}

function hasEntries(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value) && typeof value === "object" && Object.keys(value as object).length > 0;
}

function withDefaults(
  options: ModuleFederationOptions,
  sharedDefaults: Record<string, unknown>,
): ModuleFederationOptions {
  return {
    ...options,
    filename: options.filename ?? "remoteEntry.js",
    manifest: options.manifest ?? true,
    shared: resolveShared(options.shared, sharedDefaults) as ModuleFederationOptions["shared"],
    // TanStack Start imports React synchronously from its entries. Async startup waits for
    // shared modules before running them, so lazy shares cannot fail with RUNTIME-006.
    experiments: { asyncStartup: true, ...options.experiments },
  };
}

/**
 * Adds the Node container to the browser manifest, as Module Federation's dual-target
 * build does. A Node consumer reads `ssrRemoteEntry` and fetches the container from the
 * manifest's public path.
 */
function advertiseServerContainer(options: ModuleFederationOptions) {
  const manifest = options.manifest === true ? {} : options.manifest;
  if (!manifest) return;

  const userAdditionalData = manifest.additionalData;
  options.manifest = {
    ...manifest,
    async additionalData(context) {
      const stats = (await userAdditionalData?.(context)) ?? context.stats;
      Object.assign(stats.metaData, {
        ssrRemoteEntry: { name: SERVER_CONTAINER_FILENAME, path: "", type: "commonjs-module" },
      });
      return stats;
    },
  };
}

/** Builds the remote's Node container in its own environment, into the browser output. */
function serverContainerEnvironmentPlugin({
  clientEnvironment,
}: {
  clientEnvironment: string;
}): RsbuildPlugin {
  return {
    name: "tanstack-start-federation-server-container",
    setup(api) {
      // Module Federation validates its node environment in a `pre` hook, before TanStack
      // Start defines its own environments, so this one is created bare and placed next to
      // the browser output once the bundler configs exist.
      api.modifyRsbuildConfig({
        order: "pre",
        handler(config) {
          config.environments ??= {};
          config.environments[SERVER_CONTAINER_ENVIRONMENT] = {
            // Module Federation adds the container entry; the placeholder keeps the
            // environment from bundling the application.
            source: { entry: { [SERVER_CONTAINER_ENVIRONMENT]: "data:text/javascript," } },
            // The output directory is shared with the browser build, which cleans it and
            // emits the stylesheets.
            output: { cleanDistPath: false, emitAssets: false, target: "node" },
          };
        },
      });

      api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
        const clientConfig = bundlerConfigs?.find(({ name }) => name === clientEnvironment);
        const containerConfig = bundlerConfigs?.find(
          ({ name }) => name === SERVER_CONTAINER_ENVIRONMENT,
        );
        if (!containerConfig) return;
        if (!clientConfig?.output?.path) {
          throw new Error(
            `TanStack Start's "${clientEnvironment}" environment was not found. ` +
              "Register tanstackStart() before tanstackStartModuleFederation().",
          );
        }

        // The container ships with the browser assets and loads its chunks over HTTP from
        // the same public path.
        const publicPath = clientConfig.output.publicPath;
        containerConfig.output ||= {};
        containerConfig.output.path = clientConfig.output.path;
        containerConfig.output.filename = `${SERVER_CHUNK_DIR}/[name].js`;
        containerConfig.output.chunkFilename = `${SERVER_CHUNK_DIR}/[id].[contenthash:8].js`;
        containerConfig.output.publicPath =
          typeof publicPath === "string" && publicPath !== "auto" ? publicPath : "auto";
      });
    },
  };
}

function externalizeServerShared(
  shared: ModuleFederationOptions["shared"],
): ModuleFederationOptions["shared"] {
  if (!shared || Array.isArray(shared)) return shared;

  const configuredShared = shared as Record<string, unknown>;
  const externalizedShared = { ...configuredShared };
  for (const packageName of tanstackStartSharedPackages) {
    externalizedShared[packageName] = externalizeSharedConfig(configuredShared[packageName]);
  }
  return externalizedShared as ModuleFederationOptions["shared"];
}

function externalizeSharedConfig(value: unknown): unknown {
  if (typeof value === "string") return { import: value };
  if (Array.isArray(value)) return value.map(externalizeSharedConfig);
  if (!value || typeof value !== "object") return { import: false };

  const config = value as Record<string, unknown>;
  return { ...config, import: config.import ?? false };
}

const REMOTE_FAILURE_FACTORY = /(webpackRequire\.m\[id\]\s*=\s*\(\)\s*=>\s*\{)(\s*throw error;)/;

/**
 * Lets a host load a remote again after a failed load. Module Federation's bundler runtime
 * replaces a remote module that failed with one that throws, and retries the load on the
 * next import, but the module cache keeps the first failure's empty exports. A server
 * that hit a remote outage, or started during one, would then never render that remote.
 * Rspack's `strictModuleExceptionHandling` caches the error instead, so this removes the
 * failed module from the cache.
 */
function remoteRetryPlugin(): RsbuildPlugin {
  return {
    name: "tanstack-start-federation-remote-retry",
    setup(api) {
      api.transform(
        { test: /[\\/]@module-federation[\\/]webpack-bundler-runtime[\\/]dist[\\/]remotes\.c?js$/ },
        ({ code }) =>
          // One line, so the rest of the file keeps its positions.
          code.replace(
            REMOTE_FAILURE_FACTORY,
            "$1 if (webpackRequire.c) delete webpackRequire.c[id];$2",
          ),
      );
    },
  };
}

function clientCompatibilityPlugin({
  chunkLoadingGlobal,
  environment,
  forceScriptOutput,
  isRemote,
  name,
}: {
  chunkLoadingGlobal: string;
  environment: string;
  forceScriptOutput: boolean;
  isRemote: boolean;
  name: string;
}): RsbuildPlugin {
  return {
    name: "tanstack-start-federation-client-compat",
    setup(api) {
      api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
        for (const config of bundlerConfigs ?? []) {
          if (config.name !== environment) continue;

          config.output ||= {};
          config.output.chunkFormat = "array-push";
          config.output.chunkLoading = "jsonp";
          config.output.chunkLoadingGlobal = chunkLoadingGlobal;
          config.output.uniqueName ??= name;

          // TanStack Start derives the public path from `server.base`, which Rsbuild always
          // sets, so a remote ends up with a host-relative "/" in production. Hosts on other
          // origins would then request its chunks from themselves. "auto" resolves them from
          // the remote's own script and manifest URLs; an absolute URL (such as a CDN) is kept.
          if (isRemote && !isAbsoluteUrl(config.output.publicPath)) {
            config.output.publicPath = "auto";
          }

          if (forceScriptOutput) {
            config.output.module = false;
            const experiments = (config.experiments ??= {}) as { outputModule?: boolean };
            experiments.outputModule = false;
          }
        }
      });
    },
  };
}

function serverCompatibilityPlugin({
  chunkFilename,
  entryFilename,
  environment,
  forceCommonJsOutput,
}: {
  chunkFilename?: string;
  entryFilename?: string;
  environment: string;
  forceCommonJsOutput: boolean;
}): RsbuildPlugin {
  return {
    name: "tanstack-start-federation-ssr-compat",
    setup(api) {
      api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
        for (const config of bundlerConfigs ?? []) {
          if (config.name !== environment) continue;

          config.output ||= {};
          if (forceCommonJsOutput) {
            config.output.filename = entryFilename ?? "[name].cjs";
            config.output.chunkFilename =
              chunkFilename ?? `[id].${config.output.uniqueName ?? "server"}.cjs`;
            config.target = "async-node";
            config.output.module = false;
            config.output.chunkFormat = "commonjs";
            config.output.chunkLoading = "async-node";
            config.output.library = { type: "commonjs2" };
            delete config.output.chunkLoadingGlobal;
          } else {
            if (entryFilename) config.output.filename = entryFilename;
            if (chunkFilename) config.output.chunkFilename = chunkFilename;
          }
        }
      });

      if (!forceCommonJsOutput) return;

      // async-node chunk loading reads chunks from disk, while the dev server runs the entry
      // from memory. Writing the server output keeps both from the same compilation. The
      // dev output goes to a cache directory: in `dist/server` it would replace a production
      // build that `rsbuild preview` serves, and dev chunks share its chunk names.
      api.modifyEnvironmentConfig((config, { name }) => {
        if (name !== environment) return;
        config.dev.writeToDisk = true;
        if (api.context.action === "dev") {
          config.output.distPath.root = join(
            api.context.rootPath,
            "node_modules",
            ".cache",
            "tanstack-start-federation",
            environment,
          );
        }
      });

      // TanStack Start's preview server, and deployments built against it, import
      // `dist/server/index.js`. Keep that entry as an ES module that re-exports the CommonJS
      // bundle. With async startup, the bundle exports a promise that settles once
      // federation has initialized.
      api.processAssets(
        { stage: "additional", environments: [environment] },
        ({ assets, compilation, sources }) => {
          if (!assets["index.cjs"] || assets["index.js"]) return;
          compilation.emitAsset("index.js", new sources.RawSource(SERVER_ENTRY_SHIM));
        },
      );
    },
  };
}

const SERVER_ENTRY_SHIM = `import { createRequire } from "node:module";

const server = await createRequire(import.meta.url)("./index.cjs");

export const createServerEntry = server.createServerEntry;
export default server.default;
`;
