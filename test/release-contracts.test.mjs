import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages", "tanstack");
const packageRequire = createRequire(join(packageRoot, "package.json"));
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const rootPackageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const ciWorkflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
const previewWorkflow = readFileSync(join(root, ".github", "workflows", "pkg-pr-new.yml"), "utf8");
const releaseWorkflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
const { tanstackStartModuleFederation } = await import(join(packageRoot, "dist", "index.mjs"));

function upstreamOptions(options) {
  const plugins = tanstackStartModuleFederation(options);
  assert.ok(Array.isArray(plugins), "federation wrapper returns Vite plugins");
  const upstream = plugins.filter((plugin) => plugin.name === "module-federation-vite");
  assert.equal(upstream.length, 1, "wrapper delegates to one federation instance");
  assert.ok(upstream[0]._options, "upstream plugin exposes normalized options");
  return upstream[0]._options;
}

test("applies TanStack-safe defaults", () => {
  const options = upstreamOptions({
    name: "host",
    filename: undefined,
    manifest: undefined,
    hostInitInjectLocation: undefined,
  });
  assert.equal(options.filename, "remoteEntry.js");
  assert.equal(options.manifest, true);
  assert.equal(options.hostInitInjectLocation, "entry");
  assert.equal(options.shared.react.shareConfig.singleton, true);
  assert.equal(options.shared["react-dom"].shareConfig.singleton, true);
});

test("preserves explicit federation settings and shared entries", () => {
  const options = upstreamOptions({
    name: "remote",
    filename: "custom-entry.js",
    manifest: false,
    hostInitInjectLocation: "html",
    shared: {
      react: { singleton: false, requiredVersion: "^19.0.0" },
      lodash: { singleton: true },
    },
  });
  assert.equal(options.filename, "custom-entry.js");
  assert.equal(options.manifest, false);
  assert.equal(options.hostInitInjectLocation, "html");
  assert.equal(options.shared.react.shareConfig.singleton, false);
  assert.equal(options.shared.react.shareConfig.requiredVersion, "^19.0.0");
  assert.equal(options.shared.lodash.shareConfig.singleton, true);
  assert.ok(options.shared["react-dom"], "unconfigured React DOM remains shared");
});

test("does not mutate the caller's options", () => {
  const options = {
    name: "host",
    shared: { react: { singleton: false } },
    remotes: { remote: { type: "module", name: "remote", entry: "remoteEntry.js" } },
  };
  const before = structuredClone(options);
  upstreamOptions(options);
  assert.deepEqual(options, before);
});

test("accepts the upstream array form", () => {
  const options = upstreamOptions({ name: "remote", shared: ["lodash", "react"] });
  assert.deepEqual(Object.keys(options.shared).sort(), ["lodash", "react", "react-dom"]);
  assert.equal(options.shared.react.shareConfig.singleton, true);
  assert.equal(options.shared["react-dom"].shareConfig.singleton, true);
});

test("leaves the build target to each TanStack environment", () => {
  const options = upstreamOptions({ name: "host", target: "node" });
  assert.equal(options.target, undefined);
});

test("published metadata points to ESM build and declaration map", () => {
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.exports["."].import, "./dist/index.mjs");
  assert.equal(packageJson.exports["."].types, "./dist/index.d.mts");
  assert.equal(
    packageRequire.resolve("@module-federation/tanstack"),
    join(packageRoot, "dist", "index.mjs"),
  );
  for (const file of ["index.mjs", "index.mjs.map", "index.d.mts", "index.d.mts.map"]) {
    assert.ok(existsSync(join(packageRoot, "dist", file)), `dist/${file} exists`);
  }
});

test("CI uses Node versions supported by the package build toolchain", () => {
  const supportedNode = "^22.18.0 || ^24.11.0 || >=26.0.0";
  assert.equal(rootPackageJson.engines.node, supportedNode);
  assert.equal(packageJson.engines.node, supportedNode);
  assert.match(ciWorkflow, /node: \["22\.18\.0", "24", "26"\]/);
  assert.doesNotMatch(ciWorkflow, /22\.12\.0/);
});

test("GitHub prereleases publish the version validated against their tag", () => {
  assert.match(releaseWorkflow, /Tag\/version mismatch/);
  assert.doesNotMatch(releaseWorkflow, /Set deterministic prerelease version/);
  assert.doesNotMatch(
    releaseWorkflow,
    /github\.event\.release\.prerelease[\s\S]*npm pkg set version/,
  );
});

test("npm publications share one package-wide concurrency queue", () => {
  assert.match(releaseWorkflow, /group: publish-module-federation-tanstack/);
  assert.doesNotMatch(releaseWorkflow, /group:.*github\.(?:ref|run)/);
});

test("first package preview does not require an existing npm release", () => {
  assert.match(previewWorkflow, /pkg-pr-new@0\.0\.54 publish \.\/packages\/tanstack/);
  assert.doesNotMatch(previewWorkflow, /--compact/);
});
