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
        shareStrategy: "loaded-first",
        remotes: {
          tanstack_rsbuild_ssr_remote:
            "tanstack_rsbuild_ssr_remote@http://127.0.0.1:3004/mf-manifest.json",
        },
      },
      // Loads remotes on the server through the Module Federation Node runtime.
      server: true,
    }),
  ],
});
