import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages", "tanstack");
const dist = join(packageRoot, "dist");

test("published declarations reference included source maps", () => {
  for (const declarationName of [
    "index.d.cts",
    "index.d.ts",
    "node-entry-loader.d.cts",
    "node-entry-loader.d.ts",
    "rsbuild.d.cts",
    "rsbuild.d.ts",
    "runtime.d.cts",
    "runtime.d.ts",
    "vite.d.cts",
    "vite.d.ts",
  ]) {
    const declaration = readFileSync(join(dist, declarationName), "utf8");
    const sourceMap = declaration.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/m)?.[1];

    assert.ok(sourceMap, `${declarationName} has no source map reference`);
    assert.ok(
      existsSync(join(dist, sourceMap)),
      `${declarationName} references missing source map ${sourceMap}`,
    );
  }
});

test("npm package contains only runtime, metadata, and documentation files", () => {
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: packageRoot,
    encoding: "utf8",
  });

  assert.equal(packed.status, 0, packed.stderr);
  const [manifest] = JSON.parse(packed.stdout);
  const files = manifest.files.map(({ path }) => path).sort();

  const entries = [
    "index",
    "node-entry-loader",
    "rsbuild",
    "runtime",
    "shared",
    "vite",
    "vite-compat",
  ];
  const runtimeFiles = entries.flatMap((entry) => {
    const sourceMaps = entry === "index" ? [] : [`dist/${entry}.js.map`];
    return [
      `dist/${entry}.cjs`,
      `dist/${entry}.cjs.map`,
      `dist/${entry}.d.cts`,
      `dist/${entry}.d.cts.map`,
      `dist/${entry}.d.ts`,
      `dist/${entry}.d.ts.map`,
      `dist/${entry}.js`,
      ...sourceMaps,
    ];
  });

  assert.deepEqual(
    files,
    ["CHANGELOG.md", "LICENSE", "README.md", ...runtimeFiles, "package.json"].sort(),
  );
});
