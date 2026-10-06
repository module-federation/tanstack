import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/rsbuild";
import { tanstackStartModuleFederation } from "@module-federation/tanstack/rsbuild";

export default defineConfig({
  dev: { lazyCompilation: false },
  server: { host: "127.0.0.1", port: 3005 },
  plugins: [
    pluginReact(),
    tanstackStart(),
    ...tanstackStartModuleFederation({
      federation: {
        dts: false,
        name: "tanstack_rsbuild_ssr_host",
        // Workspace dependencies declare "workspace:*", which is not a semver range.
        shared: { "example-host-context": { requiredVersion: "*", singleton: true } },
        shareStrategy: "loaded-first",
        remotes: {
          tanstack_rsbuild_ssr_remote:
            "tanstack_rsbuild_ssr_remote@http://127.0.0.1:3004/mf-manifest.json",
          tanstack_vite_remote: "tanstack_vite_remote@http://127.0.0.1:3001/mf-manifest.json",
        },
      },
      // Loads remotes on the server. Vite remotes also need @module-federation/vite installed.
      server: true,
    }),
  ],
});
