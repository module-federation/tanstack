import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostDist = join(root, "apps", "host", "dist");
const remoteDist = join(root, "apps", "remote", "dist");
const rsbuildHostDist = join(root, "apps", "rsbuild-host", "dist");
const rsbuildRemoteDist = join(root, "apps", "rsbuild-remote", "dist");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("all TanStack Start apps produce client and server builds", () => {
  for (const [name, dist] of [
    ["host", hostDist],
    ["remote", remoteDist],
    ["rsbuild host", rsbuildHostDist],
    ["rsbuild remote", rsbuildRemoteDist],
  ]) {
    assert.ok(existsSync(join(dist, "client", "mf-manifest.json")), `${name} client`);
    const serverEntry = name.startsWith("rsbuild") ? "index.js" : "server.js";
    assert.ok(existsSync(join(dist, "server", serverEntry)), `${name} server`);
  }
});

test("remote publishes browser and server federation entries", () => {
  const client = join(remoteDist, "client");
  assert.ok(existsSync(join(client, "remoteEntry.js")));
  assert.ok(existsSync(join(client, "remoteEntry.ssr.js")));

  const manifest = readJson(join(client, "mf-manifest.json"));
  assert.equal(manifest.name, "tanstack_remote");
  assert.equal(manifest.metaData.remoteEntry.name, "remoteEntry.js");
  assert.equal(manifest.metaData.ssrRemoteEntry.name, "remoteEntry.ssr.js");

  const statusCard = manifest.exposes.find(({ path }) => path === "./StatusCard");
  assert.ok(statusCard, "StatusCard expose is listed");
  assert.ok(statusCard.assets.css.sync.length > 0, "StatusCard CSS is published");

  for (const dependency of ["react", "react-dom"]) {
    const shared = manifest.shared.find(({ name }) => name === dependency);
    assert.equal(shared?.singleton, true, `${dependency} is a singleton`);
  }
});

test("host records the TanStack remote and server-side loader", () => {
  const manifest = readJson(join(hostDist, "client", "mf-manifest.json"));
  const remote = manifest.remotes.find(({ alias }) => alias === "tanstack_remote");
  assert.equal(remote?.moduleName, "StatusCard");

  const serverFiles = readFileSync(join(hostDist, "server", ".vite", "manifest.json"), "utf8");
  assert.match(serverFiles, /ssrEntryLoader/);
  assert.match(serverFiles, /tanstack_remote/);
});

test("Vite and Rsbuild publish reciprocal client interoperability contracts", () => {
  const viteHostManifest = readJson(join(hostDist, "client", "mf-manifest.json"));
  const rsbuildHostManifest = readJson(join(rsbuildHostDist, "client", "mf-manifest.json"));
  const rsbuildRemoteClient = readJson(join(rsbuildRemoteDist, "client", "mf-manifest.json"));

  assert.equal(
    viteHostManifest.remotes.find(({ alias }) => alias === "tanstack_rsbuild_remote")?.moduleName,
    "StatusCard",
  );
  assert.equal(
    rsbuildHostManifest.remotes.find(({ alias }) => alias === "tanstack_remote")?.entry,
    "http://127.0.0.1:3001/mf-manifest.json",
  );
  assert.equal(
    rsbuildHostManifest.remotes.find(({ alias }) => alias === "tanstack_rsbuild_remote")?.entry,
    "http://127.0.0.1:3002/mf-manifest.json",
  );
  assert.equal(rsbuildRemoteClient.metaData.remoteEntry.type, "global");
  assert.equal(rsbuildRemoteClient.metaData.remoteEntry.name, "remoteEntry.js");
  const statusCard = rsbuildRemoteClient.exposes.find(({ path }) => path === "./StatusCard");
  assert.ok(statusCard?.assets.css.sync.length > 0, "Rsbuild StatusCard CSS is published");
  assert.equal(
    existsSync(join(rsbuildRemoteDist, "server", "serverRemoteEntry.cjs")),
    false,
    "client-only cross-bundler remote does not publish an unused SSR container",
  );
  assert.equal(
    existsSync(join(rsbuildHostDist, "server", "mf-manifest.json")),
    false,
    "client-only cross-bundler host does not initialize remotes during SSR",
  );

  for (const manifest of [rsbuildRemoteClient]) {
    for (const dependency of ["react", "react-dom"]) {
      assert.equal(
        manifest.shared.find(({ name }) => name === dependency)?.singleton,
        true,
        `${dependency} is a singleton`,
      );
    }
  }
});
