import { createRequire } from "node:module";
import { join } from "node:path";
import { federation, type ModuleFederationOptions } from "@module-federation/vite";
import type { Plugin } from "vite";
import {
  createServerContainerCheck,
  resolveStartPluginCore,
  SERVER_CONTAINER_RPC,
  SERVER_FN_BASE_DEFINE,
} from "./server-container";
import { defaultShared, eagerShared, resolveShared } from "./shared";
import {
  createRemoteStylesheetResolverModule,
  REMOTE_STYLESHEET_RESOLVER_MODULE,
  RESOLVED_REMOTE_STYLESHEET_RESOLVER_MODULE,
} from "./remote-stylesheet-adapter";
import { viteVersionPlugin } from "./vite-compat";

export type TanStackStartModuleFederationOptions = Omit<ModuleFederationOptions, "target">;

// `@module-federation/vite` builds a remote's published SSR entry in this environment
// instead of TanStack Start's `ssr` environment, where Start compiles handlers in place.
// Vite environment names allow only letters, digits, `$` and `_`.
const SERVER_ENTRY_ENVIRONMENT = "mf_server";
const SERVER_ENTRY_FILENAME = "remoteEntry.ssr.js";

/** Creates one Vite federation plugin set for TanStack Start's client and SSR environments. */
export function tanstackStartModuleFederation(
  options: TanStackStartModuleFederationOptions,
): Plugin[] {
  const {
    shared,
    target: _environmentSpecificTarget,
    ...configured
  } = options as ModuleFederationOptions;

  // A host renders with its own React before any remote registers a provider. Eager host
  // shares keep that instance in the share scope, so remotes from other bundlers cannot
  // replace it. Remote-only builds stay lazy and defer to the host.
  const isHost = Object.keys(configured.remotes ?? {}).length > 0;
  const isRemote = Object.keys(configured.exposes ?? {}).length > 0;
  const resolvedShared = resolveViteShared(shared, isHost);

  return [
    viteVersionPlugin(),
    ...federation({
      ...configured,
      filename: configured.filename ?? "remoteEntry.js",
      manifest: configured.manifest ?? true,
      hostInitInjectLocation: configured.hostInitInjectLocation ?? "entry",
      shared: resolvedShared as ModuleFederationOptions["shared"],
      // Internal `@module-federation/vite` option, not part of its public types.
      ...(isRemote ? { ssrEnvironment: SERVER_ENTRY_ENVIRONMENT } : {}),
    } as ModuleFederationOptions),
    remoteStylesheetResolverPlugin(configured.remotes),
    devServerFunctionBasePlugin(),
    ...(isRemote ? serverEntryFunctionsPlugins(configured.name) : []),
  ];
}

function remoteStylesheetResolverPlugin(remotes: ModuleFederationOptions["remotes"]): Plugin {
  const moduleCode = createRemoteStylesheetResolverModule(remotes);

  return {
    name: "tanstack-start-federation:remote-stylesheet-resolver",
    enforce: "pre",
    resolveId(id) {
      return id === REMOTE_STYLESHEET_RESOLVER_MODULE
        ? RESOLVED_REMOTE_STYLESHEET_RESOLVER_MODULE
        : undefined;
    },
    load(id) {
      return id === RESOLVED_REMOTE_STYLESHEET_RESOLVER_MODULE ? moduleCode : undefined;
    },
  };
}

/**
 * Keeps each app's server function base in its own browser code during development. Vite's
 * dev server does not replace `define` entries in client code: its `/@vite/env` script
 * assigns them to `globalThis`. A page that loads a Vite remote's dev modules runs the host's
 * script and the remote's, so whichever runs last sets `process.env.TSS_SERVER_FN_BASE` for
 * both apps, and one app's server function calls go to the other's base. Production builds
 * replace the entry in place, which this does in development too.
 */
function devServerFunctionBasePlugin(): Plugin {
  return {
    name: "tanstack-start-federation:dev-server-fn-base",
    apply: "serve",
    applyToEnvironment: (environment) => environment.config.consumer === "client",
    transform: {
      filter: { code: SERVER_FN_BASE_DEFINE },
      handler(code) {
        const base = this.environment.config.define?.[SERVER_FN_BASE_DEFINE];
        if (typeof base !== "string") return;
        // The base fits on the replaced line, so line mappings stay intact.
        return { code: code.replaceAll(SERVER_FN_BASE_DEFINE, base), map: null };
      },
    },
  };
}

function resolveViteShared(shared: ModuleFederationOptions["shared"], isHost: boolean) {
  return resolveShared(shared, isHost ? eagerShared : defaultShared);
}

type StartCompilerPlugin = (options: {
  environments: { name: string; type: "client" | "server" }[];
  framework: "react";
  providerEnvName: string;
}) => Plugin[];

/**
 * Loads the Vite host of TanStack Start's compiler. Start compiles only its own environments
 * and has no public API for another one, so this reads it from `@tanstack/start-plugin-core`
 * and returns `undefined` when a release moves it.
 */
function loadStartCompiler(root: string): StartCompilerPlugin | undefined {
  try {
    const compilerHost = join(
      resolveStartPluginCore(root),
      "dist/esm/vite/start-compiler-plugin/plugin.js",
    );
    const { startCompilerPlugin } = createRequire(join(root, "package.json"))(compilerHost);
    return typeof startCompilerPlugin === "function" ? startCompilerPlugin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keeps server function handlers out of a Vite remote's published SSR entry, like the
 * Rsbuild adapter's Node container: the entry's environment is compiled as a server
 * environment that calls functions provided by Start's `ssr` environment, so each handler
 * becomes an RPC caller to the remote's server. Any module that still defines a server
 * function after that stops the build.
 */
function serverEntryFunctionsPlugins(remoteName: string): Plugin[] {
  const startCompilerPlugin = loadStartCompiler(process.cwd());
  // Only the compiler itself: Start's own instance keeps the server function resolver and
  // ID validation of its environments.
  const compiler = (
    startCompilerPlugin?.({
      environments: [{ name: SERVER_ENTRY_ENVIRONMENT, type: "server" }],
      framework: "react",
      providerEnvName: "ssr",
    }) ?? []
  )
    .filter(
      ({ name }) =>
        name === `tanstack-start-core::server-fn:${SERVER_ENTRY_ENVIRONMENT}` ||
        name === "tanstack-start-core:compiler-virtual-module",
    )
    .map((plugin): Plugin => ({ ...plugin, apply: "build" }));

  let check: ((code: string, id: string) => void) | undefined;

  return [
    ...compiler,
    {
      name: "tanstack-start-federation:server-entry-rpc",
      apply: "build",
      enforce: "pre",
      applyToEnvironment: ({ name }) => name === SERVER_ENTRY_ENVIRONMENT,
      resolveId: {
        filter: { id: /^@tanstack\/react-start\/ssr-rpc$/ },
        handler(_source, importer) {
          return this.resolve(SERVER_CONTAINER_RPC, importer, { skipSelf: true });
        },
      },
    },
    {
      name: "tanstack-start-federation:server-entry-functions",
      apply: "build",
      configResolved(config) {
        // `@module-federation/vite` before 1.24.1 ignores `ssrEnvironment` and builds the
        // published SSR entry in Start's `ssr` environment, with the handlers in it.
        if (!config.environments[SERVER_ENTRY_ENVIRONMENT]) {
          throw new Error(
            `@module-federation/tanstack requires @module-federation/vite 1.24.1 or later ` +
              `to keep server function handlers out of remote "${remoteName}"'s published ` +
              `SSR entry.`,
          );
        }
      },
      configEnvironment(name) {
        if (name !== SERVER_ENTRY_ENVIRONMENT) return;
        return {
          define: { __MF_TANSTACK_REMOTE_NAME__: JSON.stringify(remoteName) },
          // The caller reads the remote's name at build time, so it is bundled.
          resolve: { noExternal: ["@module-federation/tanstack"] },
        };
      },
      transform: {
        filter: { id: /\.[cm]?[jt]sx?(?:$|\?)/ },
        handler(code, id) {
          if (this.environment.name !== SERVER_ENTRY_ENVIRONMENT) return;
          check ??= createServerContainerCheck({
            compilerLoaded: compiler.length > 0,
            container: SERVER_ENTRY_FILENAME,
            getServerFunctionBase: () => this.environment.config.define?.[SERVER_FN_BASE_DEFINE],
            remoteName,
          });
          check(code, id);
        },
      },
    },
  ];
}
