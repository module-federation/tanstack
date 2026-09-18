import { tanstackStartModuleFederation } from "@module-federation/tanstack";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStartModuleFederation({
      name: "tanstack_remote",
      dts: false,
      exposes: {
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
