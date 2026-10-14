import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/rsbuild";
import { tanstackStartModuleFederation } from "@module-federation/tanstack/rsbuild";

export default defineConfig({
  dev: { lazyCompilation: false },
  server: { host: "127.0.0.1", port: 3003 },
  plugins: [
    pluginReact(),
    tanstackStart(),
    ...tanstackStartModuleFederation({
      federation: {
        dts: false,
        name: "tanstack_rsbuild_host",
        // Workspace dependencies declare "workspace:*", which is not a semver range.
        shared: {
          "example-host-context": { requiredVersion: "*", singleton: true },
        },
        // Resolve remotes on demand so one offline remote cannot block host startup.
        shareStrategy: "loaded-first",
        remotes: {
          tanstack_vite_remote: "tanstack_vite_remote@http://127.0.0.1:3001/mf-manifest.json",
          tanstack_rsbuild_remote: "tanstack_rsbuild_remote@http://127.0.0.1:3002/mf-manifest.json",
        },
      },
    }),
  ],
});
