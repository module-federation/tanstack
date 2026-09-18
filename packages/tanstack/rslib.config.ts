import { defineConfig } from "@rslib/core";

const entry = {
  index: "./src/index.ts",
  rsbuild: "./src/rsbuild.ts",
  shared: "./src/shared.ts",
  vite: "./src/vite.ts",
};

const output = {
  distPath: { root: "./dist" },
  sourceMap: { js: "source-map" },
  target: "node",
} as const;

export default defineConfig({
  lib: [
    {
      bundle: false,
      dts: { autoExtension: true },
      format: "esm",
      output,
      redirect: { dts: { extension: true } },
      source: { entry },
      syntax: "es2022",
    },
    {
      bundle: false,
      dts: { autoExtension: true },
      format: "cjs",
      output,
      source: { entry },
      syntax: "es2022",
    },
  ],
});
