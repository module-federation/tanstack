import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/rsbuild";
import { tanstackStartModuleFederation } from "@module-federation/tanstack/rsbuild";

export default defineConfig({
  dev: { lazyCompilation: false },
  server: {
    cors: { origin: ["http://127.0.0.1:3005"] },
    host: "127.0.0.1",
    port: 3004,
  },
  plugins: [
    pluginReact(),
    tanstackStart(),
    ...tanstackStartModuleFederation({
      federation: {
        dev: { disableDynamicRemoteTypeHints: true },
        dts: false,
        exposes: { "./StatusCard": "./src/components/StatusCard.tsx" },
        name: "tanstack_rsbuild_ssr_remote",
      },
      // Builds an async-node server container next to the browser container, so an
      // Rsbuild host can render this card on the server.
      server: true,
    }),
  ],
});
