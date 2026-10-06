import type { ModuleFederationRuntimePlugin } from "@module-federation/runtime";

declare const __non_webpack_require__: NodeJS.Require;

type RemoteEntryExports = NonNullable<
  Parameters<NonNullable<ModuleFederationRuntimePlugin["loadEntry"]>>[0]["remoteEntryExports"]
>;

/**
 * Loads CommonJS remote entries over HTTP for a host's server bundle.
 *
 * Module Federation's default Node loader reaches `vm` and `path` through `import()`.
 * Rsbuild's development runner executes server bundles in a `vm` function without a
 * dynamic-import callback, so that `import()` throws. Node built-ins are loaded with
 * `require` here instead, matching how the federation chunk loader already works.
 */
export default function nodeEntryLoaderPlugin(): ModuleFederationRuntimePlugin {
  return {
    name: "tanstack-start-node-entry-loader",
    async loadEntry({ remoteInfo }) {
      const { entry, entryGlobalName, type } = remoteInfo;
      if (type !== "commonjs-module" || !/^https?:\/\//.test(entry)) return undefined;

      const response = await fetch(entry);
      if (!response.ok) {
        throw new Error(`Failed to fetch remote entry ${entry}: HTTP ${response.status}`);
      }
      const source = await response.text();

      const nodeRequire = __non_webpack_require__;
      const vm: typeof import("node:vm") = nodeRequire("node:vm");
      const { createRequire }: typeof import("node:module") = nodeRequire("node:module");
      const path: typeof import("node:path") = nodeRequire("node:path");

      const { pathname } = new URL(entry);
      const container = { exports: {} as Record<string, unknown> };
      const run = new vm.Script(
        `(function (exports, module, require, __dirname, __filename) {${source}\n})`,
        {
          filename: entry,
          importModuleDynamically: vm.constants?.USE_MAIN_CONTEXT_DEFAULT_LOADER,
        },
      ).runInThisContext();
      run(
        container.exports,
        container,
        createRequire(path.join(process.cwd(), "__mf_require_base__.js")),
        path.posix.dirname(pathname),
        path.posix.basename(pathname),
      );

      const exports = container.exports;
      const remoteEntry = (entryGlobalName && exports[entryGlobalName]) || exports;
      if (!isRemoteEntry(remoteEntry)) {
        throw new Error(`Remote entry ${entry} did not export a federation container.`);
      }
      return remoteEntry;
    },
  };
}

function isRemoteEntry(value: unknown): value is RemoteEntryExports {
  const candidate = value as Partial<RemoteEntryExports> | undefined;
  return typeof candidate?.get === "function" && typeof candidate.init === "function";
}
