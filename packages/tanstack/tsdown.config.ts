import { builtinModules } from "node:module";
import { defineConfig } from "tsdown";

const external = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  "@module-federation/vite",
  "@module-federation/vite/*",
];

export default defineConfig({
  clean: true,
  deps: { neverBundle: external },
  dts: { sourcemap: true },
  entry: { index: "./src/index.ts" },
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
});
