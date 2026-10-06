import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/rsbuild";
import { tanstackStartModuleFederation } from "@module-federation/tanstack/rsbuild";

export default defineConfig({
  dev: { lazyCompilation: false },
  server: {
    cors: { origin: ["http://127.0.0.1:3000", "http://127.0.0.1:3003"] },
    host: "127.0.0.1",
    port: 3002,
  },
  plugins: [
    pluginReact(),
    tanstackStart(),
    ...tanstackStartModuleFederation({
      federation: {
        exposes: { "./StatusCard": "./src/components/StatusCard.tsx" },
        name: "tanstack_rsbuild_remote",
      },
    }),
  ],
});
