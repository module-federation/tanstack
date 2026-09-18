import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostDist = join(root, "apps", "host", "dist");
const remoteDist = join(root, "apps", "remote", "dist");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("both TanStack Start apps produce client and server builds", () => {
  for (const [name, dist] of [
    ["host", hostDist],
    ["remote", remoteDist],
  ]) {
    assert.ok(existsSync(join(dist, "client", ".vite", "manifest.json")), `${name} client`);
    assert.ok(existsSync(join(dist, "server", "server.js")), `${name} server`);
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
