import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages", "tanstack");
const packageRequire = createRequire(join(packageRoot, "package.json"));
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const rootPackageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const ciWorkflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
const previewWorkflow = readFileSync(join(root, ".github", "workflows", "pkg-pr-new.yml"), "utf8");
const releaseWorkflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
const { tanstackStartModuleFederation } = await import(
  pathToFileURL(join(packageRoot, "dist", "index.js")).href
);
const { eagerShared, resolveShared } = await import(
  pathToFileURL(join(packageRoot, "dist", "shared.js")).href
);
const { tanstackStartModuleFederation: tanstackStartRsbuildModuleFederation } = await import(
  pathToFileURL(join(packageRoot, "dist", "rsbuild.js")).href
);

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
  assert.equal(options.shared.react.shareConfig.eager, false, "Vite defaults stay non-eager");
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

test("Rsbuild defaults make synchronous React shares eager without mutating overrides", () => {
  const callerShared = { react: { eager: false, singleton: false } };
  const before = structuredClone(callerShared);
  const shared = resolveShared(callerShared, eagerShared);

  assert.deepEqual(callerShared, before);
  assert.deepEqual(shared.react, { eager: false, singleton: false });
  assert.deepEqual(shared["react-dom"], { eager: true, singleton: true });
});

test("Rsbuild configures separate browser and async-node federation environments", () => {
  const plugins = tanstackStartRsbuildModuleFederation({
    federation: { name: "test_remote" },
  });

  assert.deepEqual(
    plugins.map(({ name }) => name),
    [
      "rsbuild:module-federation-enhanced",
      "tanstack-start-federation-client-compat",
      "rsbuild:module-federation-enhanced",
      "tanstack-start-federation-ssr-compat",
    ],
  );

  const clientConfig = { name: "client", output: {} };
  const serverConfig = {
    name: "ssr",
    output: { chunkLoadingGlobal: "stale" },
  };
  applyCompilerHook(
    plugins.find(({ name }) => name === "tanstack-start-federation-client-compat"),
    [clientConfig, serverConfig],
  );
  applyCompilerHook(
    plugins.find(({ name }) => name === "tanstack-start-federation-ssr-compat"),
    [clientConfig, serverConfig],
  );

  assert.deepEqual(clientConfig.output, {
    chunkFormat: "array-push",
    chunkLoading: "jsonp",
    chunkLoadingGlobal: "chunk_test_remote",
    module: false,
    uniqueName: "test_remote",
  });
  assert.equal(serverConfig.target, "async-node");
  assert.deepEqual(serverConfig.output, {
    chunkFilename: "[id].test_remote.cjs",
    chunkFormat: "commonjs",
    chunkLoading: "async-node",
    filename: "[name].cjs",
    library: { type: "commonjs2" },
    module: false,
  });

  assert.equal(
    tanstackStartRsbuildModuleFederation({
      federation: { name: "browser_only" },
      server: false,
    }).length,
    2,
  );

  const esmPlugins = tanstackStartRsbuildModuleFederation({
    federation: { name: "esm_server" },
    server: { forceCommonJsOutput: false },
  });
  const esmServerConfig = {
    name: "ssr",
    output: { chunkFilename: "[id].js", filename: "[name].js" },
  };
  applyCompilerHook(
    esmPlugins.find(({ name }) => name === "tanstack-start-federation-ssr-compat"),
    [esmServerConfig],
  );
  assert.deepEqual(esmServerConfig, {
    name: "ssr",
    output: { chunkFilename: "[id].js", filename: "[name].js" },
  });
});

function applyCompilerHook(plugin, bundlerConfigs) {
  let hook;
  plugin.setup({
    onBeforeCreateCompiler(callback) {
      hook = callback;
    },
  });
  assert.ok(hook, `${plugin.name} registers a compiler hook`);
  hook({ bundlerConfigs });
}

test("published metadata selects ESM and CommonJS builds with matching types", () => {
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.exports["."].import.default, "./dist/index.js");
  assert.equal(packageJson.exports["."].import.types, "./dist/index.d.ts");
  assert.equal(packageJson.exports["."].require.default, "./dist/index.cjs");
  assert.equal(packageJson.exports["."].require.types, "./dist/index.d.cts");
  assert.equal(
    packageRequire.resolve("@module-federation/tanstack"),
    join(packageRoot, "dist", "index.cjs"),
  );
  for (const file of ["index.cjs", "index.js", "index.d.cts", "index.d.ts"]) {
    assert.ok(existsSync(join(packageRoot, "dist", file)), `dist/${file} exists`);
  }
});

test("clean consumers resolve CJS and ESM entrypoints without the other adapter", () => {
  const viteConsumer = createConsumer(["@module-federation/vite"]);
  const rsbuildConsumer = createConsumer(["@module-federation/rsbuild-plugin", "@rsbuild/core"]);

  try {
    const viteRequire = createRequire(join(viteConsumer, "consumer.cjs"));
    const rsbuildRequire = createRequire(join(rsbuildConsumer, "consumer.cjs"));
    const cjsRoot = viteRequire("@module-federation/tanstack");
    const cjsRsbuild = rsbuildRequire("@module-federation/tanstack/rsbuild");

    assert.equal(typeof cjsRoot.tanstackStartModuleFederation, "function");
    assert.equal(typeof cjsRsbuild.tanstackStartModuleFederation, "function");
    assertConsumerImport(viteConsumer, "@module-federation/tanstack");
    assertConsumerImport(viteConsumer, "@module-federation/tanstack/vite");
    assertConsumerImport(rsbuildConsumer, "@module-federation/tanstack/rsbuild");
  } finally {
    rmSync(viteConsumer, { force: true, recursive: true });
    rmSync(rsbuildConsumer, { force: true, recursive: true });
  }

  assert.doesNotMatch(
    readFileSync(join(packageRoot, "dist", "rsbuild.js"), "utf8"),
    /@module-federation\/vite/,
  );
  assert.doesNotMatch(
    readFileSync(join(packageRoot, "dist", "vite.js"), "utf8"),
    /@module-federation\/rsbuild-plugin/,
  );
});

function assertConsumerImport(consumer, specifier) {
  const entry = join(consumer, "consumer.mjs");
  writeFileSync(
    entry,
    `import { tanstackStartModuleFederation } from ${JSON.stringify(specifier)};\n` +
      `if (typeof tanstackStartModuleFederation !== "function") process.exit(2);\n`,
  );
  const result = spawnSync(process.execPath, [entry], {
    cwd: consumer,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

function createConsumer(adapterPackages) {
  const consumer = mkdtempSync(join(tmpdir(), "mf-tanstack-consumer-"));
  const packageTarget = join(consumer, "node_modules", "@module-federation", "tanstack");
  mkdirSync(dirname(packageTarget), { recursive: true });
  cpSync(packageRoot, packageTarget, {
    filter: (source) => !source.includes("/node_modules/") && !source.includes("/.turbo/"),
    recursive: true,
  });

  for (const packageName of adapterPackages) {
    const adapterRoot = findPackageRoot(packageRequire.resolve(packageName));
    const adapterTarget = join(consumer, "node_modules", ...packageName.split("/"));
    mkdirSync(dirname(adapterTarget), { recursive: true });
    symlinkSync(adapterRoot, adapterTarget);
  }

  return consumer;
}

function findPackageRoot(entryPoint) {
  let directory = dirname(entryPoint);
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Could not find package root for ${entryPoint}`);
    directory = parent;
  }
  return directory;
}

test("CI uses Node versions supported by the package build toolchain", () => {
  const supportedNode = "^22.18.0 || ^24.11.0 || >=26.0.0";
  assert.equal(rootPackageJson.engines.node, supportedNode);
  assert.equal(packageJson.engines.node, supportedNode);
  assert.match(ciWorkflow, /node: \["22\.18\.0", "24", "26"\]/);
  assert.doesNotMatch(ciWorkflow, /22\.12\.0/);
});

test("bundler adapters are isolated optional peers", () => {
  for (const dependency of [
    "@module-federation/rsbuild-plugin",
    "@module-federation/vite",
    "@rsbuild/core",
    "vite",
  ]) {
    assert.ok(packageJson.peerDependencies[dependency], `${dependency} has a peer range`);
    assert.equal(packageJson.peerDependenciesMeta[dependency]?.optional, true);
  }
  assert.equal(packageJson.optionalDependencies, undefined);
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
