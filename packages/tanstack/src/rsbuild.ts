import {
  pluginModuleFederation,
  type ModuleFederationOptions,
} from "@module-federation/rsbuild-plugin";
import type { RsbuildPlugin } from "@rsbuild/core";
import { eagerShared, resolveShared } from "./shared";

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
   * Experimental SSR federation. Pass `true` or an options object to add an async-node
   * CommonJS server container. Defaults to `false`: browser-only federation.
   */
  server?: ServerFederationOptions | true;
};

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
  const clientFederationOptions = withDefaults({ ...federation, ...clientOverrides });
  const federationName = clientFederationOptions.name;

  if (!federationName) throw new Error("federation.name is required");

  const plugins: RsbuildPlugin[] = [
    pluginModuleFederation(clientFederationOptions, {
      environment: clientEnvironment,
      target: "web",
    }),
    clientCompatibilityPlugin({
      chunkLoadingGlobal: chunkLoadingGlobal ?? `chunk_${federationName}`,
      environment: clientEnvironment,
      forceScriptOutput,
      name: federationName,
    }),
  ];

  if (server === false) return plugins;

  const {
    chunkFilename,
    entryFilename,
    environment: serverEnvironment = "ssr",
    forceCommonJsOutput = true,
    ...serverOverrides
  } = server === true ? {} : server;
  const serverFederationOptions = withDefaults(
    { ...federation, ...serverOverrides },
    forceCommonJsOutput ? "serverRemoteEntry.cjs" : "serverRemoteEntry.js",
  );

  return [
    ...plugins,
    pluginModuleFederation(serverFederationOptions, {
      environment: serverEnvironment,
      target: "node",
    }),
    serverCompatibilityPlugin({
      chunkFilename:
        chunkFilename ?? (forceCommonJsOutput ? `[id].${federationName}.cjs` : undefined),
      entryFilename: entryFilename ?? (forceCommonJsOutput ? "[name].cjs" : undefined),
      environment: serverEnvironment,
      forceCommonJsOutput,
    }),
  ];
}

export const pluginTanStackStartModuleFederation = tanstackStartModuleFederation;

function withDefaults(
  options: ModuleFederationOptions,
  filename = "remoteEntry.js",
): ModuleFederationOptions {
  return {
    ...options,
    filename: options.filename ?? filename,
    manifest: options.manifest ?? true,
    shared: resolveShared(options.shared, eagerShared) as ModuleFederationOptions["shared"],
  };
}

function clientCompatibilityPlugin({
  chunkLoadingGlobal,
  environment,
  forceScriptOutput,
  name,
}: {
  chunkLoadingGlobal: string;
  environment: string;
  forceScriptOutput: boolean;
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
    },
  };
}
