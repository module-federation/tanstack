import { tanstackStartModuleFederation } from "@module-federation/tanstack";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStartModuleFederation({
      name: "tanstack_vite_remote",
      dts: false,
      // Workspace dependencies declare "workspace:*", which is not a semver range.
      shared: {
        "example-host-context": { requiredVersion: "*", singleton: true },
      },
      exposes: {
        "./RouterCard": "./src/components/RouterCard.tsx",
        "./StatusCard": "./src/components/StatusCard.tsx",
      },
    }),
    tanstackStart(),
    react(),
  ],
  server: {
    port: 3001,
    cors: true,
    origin: "http://127.0.0.1:3001",
  },
  preview: {
    port: 3001,
    cors: true,
  },
  ssr: {
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
  },
});
