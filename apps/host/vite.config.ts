import { tanstackStartModuleFederation } from "@module-federation/tanstack";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStartModuleFederation({
      name: "tanstack_host",
      dts: false,
      remotes: {
        tanstack_remote: {
          type: "module",
          name: "tanstack_remote",
          entry: "http://127.0.0.1:3001/remoteEntry.js",
        },
        tanstack_rsbuild_remote: {
          type: "global",
          name: "tanstack_rsbuild_remote",
          entry: "http://127.0.0.1:3002/mf-manifest.json",
        },
      },
    }),
    tanstackStart(),
    react(),
  ],
  server: {
    port: 3000,
  },
  ssr: {
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
  },
});
