import { join } from "node:path";
import {
  pluginModuleFederation,
  type ModuleFederationOptions,
} from "@module-federation/rsbuild-plugin";
import type { RsbuildPlugin } from "@rsbuild/core";
import { defaultShared, eagerShared, resolveShared } from "./shared";

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
    });

export type TanStackStartRsbuildModuleFederationOptions = {
  client?: ClientFederationOptions;
  federation: ModuleFederationOptions;
  /**
   * Server-side federation. Pass `true` or an options object to enable it. Defaults to
   * `false`: browser-only federation.
   *
   * - With `exposes`, the build adds a Node container in `<client dist>/ssr/` and
   *   advertises it in the browser manifest as `ssrRemoteEntry`.
   * - With `remotes`, TanStack Start's server environment loads remotes through the
   *   Module Federation Node runtime, as async-node CommonJS (`dist/server/index.cjs`).
   */
  server?: ServerFederationOptions | true;
};

/** Directory, inside the browser output, that holds the remote's Node container. */
export const SERVER_CONTAINER_DIR = "ssr";

const SERVER_CONTAINER_ENVIRONMENT = "mf-server";
const NODE_ENTRY_LOADER = "@module-federation/tanstack/node-entry-loader";
const SERVER_CONTAINER_FILENAME = "remoteEntry.js";

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
    ...serverOverrides
  } = server === true ? {} : server;

  if (exposesServerContainer) {
    const { remotes: _remotes, ...containerOptions } = { ...federation, ...serverOverrides };
    plugins.push(
      serverContainerEnvironmentPlugin({ clientEnvironment }),
      pluginModuleFederation(
        withDefaults({ ...containerOptions, filename: SERVER_CONTAINER_FILENAME }, defaultShared),
        { environment: SERVER_CONTAINER_ENVIRONMENT, target: "node" },
      ),
    );
  }

  if (isHost) {
    // The host's own server bundle consumes remotes. Its container, if any, is built by the
    // dedicated environment above, so TanStack's server output never contains one.
    const { exposes: _exposes, ...hostOptions } = { ...federation, ...serverOverrides };
    plugins.push(
      pluginModuleFederation(
        {
          ...withDefaults(hostOptions, eagerShared),
          manifest: false,
          runtimePlugins: [...(hostOptions.runtimePlugins ?? []), NODE_ENTRY_LOADER],
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
 * build does. A Node consumer reads `ssrRemoteEntry` and fetches the container from
 * `<publicPath>ssr/`.
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
        ssrRemoteEntry: {
          name: SERVER_CONTAINER_FILENAME,
          path: SERVER_CONTAINER_DIR,
          type: "commonjs-module",
        },
      });
      return stats;
    },
  };
}

/** Builds the remote's Node container in its own environment, inside the browser output. */
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
            output: { emitAssets: true, target: "node" },
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
        // the same origin.
        const publicPath = clientConfig.output.publicPath;
        containerConfig.output ||= {};
        containerConfig.output.path = join(clientConfig.output.path, SERVER_CONTAINER_DIR);
        containerConfig.output.publicPath =
          typeof publicPath === "string" && publicPath !== "auto"
            ? `${publicPath}${SERVER_CONTAINER_DIR}/`
            : "auto";
      });
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
      // from memory. Writing the server output keeps both from the same compilation.
      api.modifyEnvironmentConfig((config, { name }) => {
        if (name !== environment) return;
        config.dev.writeToDisk = true;
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
