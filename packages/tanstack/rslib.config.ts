import { defineConfig } from "@rslib/core";

const entry = {
  index: "./src/index.ts",
  "node-entry-loader": "./src/node-entry-loader.ts",
  rsbuild: "./src/rsbuild.ts",
  runtime: "./src/runtime.ts",
  shared: "./src/shared.ts",
  vite: "./src/vite.ts",
  "vite-compat": "./src/vite-compat.ts",
};

const output = {
  distPath: { root: "./dist" },
  sourceMap: { js: "source-map" },
  target: "node",
} as const;

// The `build` script runs the CJS library first. With TypeScript 7, rsbuild-plugin-dts
// renames every `.d.ts` in `dist` to `.d.cts` during the CJS pass, which would also
// consume the ESM declarations if they were emitted first.
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
