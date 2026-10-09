import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "tanstack", "dist");
const loaderUrl = pathToFileURL(join(dist, "node-entry-loader.js")).href;
const { default: nodeEntryLoader, RemoteEntryError } = await import(loaderUrl);
const { getRemoteStylesheets, lazyRemote } = await import(
  pathToFileURL(join(dist, "runtime.js")).href
);
// The React copy the runtime resolves.
const packageRequire = createRequire(join(root, "packages", "tanstack", "package.json"));
const { createInstance } = packageRequire("@module-federation/runtime");
const { createElement, Suspense } = packageRequire("react");
const { renderToString } = packageRequire("react-dom/server");
const { prerenderToNodeStream } = packageRequire("react-dom/static");

const files = new Map();
const requests = [];
let server;
let origin;

before(async () => {
  server = createServer((request, response) => {
    requests.push(request.url);
    const file = files.get(request.url);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    const body = typeof file.body === "function" ? file.body() : file.body;
    const send = () => response.writeHead(200, { "content-type": file.type }).end(body);
    if (file.delayMs) setTimeout(send, file.delayMs);
    else send();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function serve(path, body, type = "text/javascript", delayMs = 0) {
  files.set(path, { body, delayMs, type });
  return `${origin}${path}`;
}

function loadEntry(entry, type = "commonjs-module") {
  const remoteInfo = { entry, entryGlobalName: "remote", name: "remote", type };
  return nodeEntryLoader().loadEntry({ origin: {}, remoteInfo });
}

test("loads HTTP CommonJS containers as CommonJS modules", async () => {
  // Rsbuild containers import Node built-ins through `new Function` at runtime.
  const entry = serve(
    "/cjs/remoteEntry.ssr.cjs",
    `
      const importNode = new Function("name", "return import(name)");
      module.exports = {
        init() {},
        async get(request) {
          const path = await importNode("node:path");
          return () => ({ request, separator: path.sep, filename: __filename });
        },
      };
    `,
  );

  const container = await loadEntry(entry);
  const factory = await container.get("./Card");
  assert.deepEqual(factory(), { request: "./Card", separator: "/", filename: entry });
});

test("revalidates a CommonJS server entry after maxAgeMs expires", async () => {
  let version = "v1";
  const entry = serve(
    "/revalidate/remoteEntry.ssr.cjs",
    () => `
      module.exports.remote = {
        init() {},
        async get() {
          return () => ({ default: "${version}" });
        },
      };
    `,
  );
  const host = createInstance({
    name: "revalidate_host",
    remotes: [
      {
        name: "revalidate_remote",
        entry,
        entryGlobalName: "remote",
        type: "commonjs-module",
      },
    ],
    plugins: [nodeEntryLoader({ maxAgeMs: 0 })],
  });

  assert.deepEqual(await host.loadRemote("revalidate_remote/Value"), { default: "v1" });
  version = "v2";
  assert.deepEqual(await host.loadRemote("revalidate_remote/Value"), { default: "v2" });
  assert.equal(
    requests.filter((request) => request === "/revalidate/remoteEntry.ssr.cjs").length,
    2,
  );
});

test("measures maxAgeMs from the remote entry load, not the last expose request", async () => {
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    let version = "v1";
    const entry = serve(
      "/revalidate/ttl-remoteEntry.ssr.cjs",
      () => `
        module.exports.remote = {
          init() {},
          async get() {
            return () => ({ default: "${version}" });
          },
        };
      `,
    );
    const host = createInstance({
      name: "ttl_host",
      remotes: [
        {
          name: "ttl_remote",
          entry,
          entryGlobalName: "remote",
          type: "commonjs-module",
        },
      ],
      plugins: [nodeEntryLoader({ maxAgeMs: 100 })],
    });

    assert.deepEqual(await host.loadRemote("ttl_remote/Value"), { default: "v1" });
    now = 60;
    version = "v2";
    assert.deepEqual(await host.loadRemote("ttl_remote/Value"), { default: "v1" });
    now = 101;
    version = "v3";
    assert.deepEqual(await host.loadRemote("ttl_remote/Value"), { default: "v3" });
    assert.equal(
      requests.filter((request) => request === "/revalidate/ttl-remoteEntry.ssr.cjs").length,
      2,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("single-flights concurrent remote revalidation requests", async () => {
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    let version = "v1";
    const entry = serve(
      "/revalidate/concurrent-remoteEntry.ssr.cjs",
      () => `
        module.exports.remote = {
          init() {},
          async get() {
            return () => ({ default: "${version}" });
          },
        };
      `,
      "text/javascript",
      10,
    );
    const host = createInstance({
      name: "concurrent_revalidate_host",
      remotes: [
        {
          name: "concurrent_revalidate_remote",
          entry,
          entryGlobalName: "remote",
          type: "commonjs-module",
        },
      ],
      plugins: [nodeEntryLoader({ maxAgeMs: 100 })],
    });

    assert.deepEqual(await host.loadRemote("concurrent_revalidate_remote/Value"), {
      default: "v1",
    });
    now = 101;
    version = "v2";
    const values = await Promise.all([
      host.loadRemote("concurrent_revalidate_remote/Value"),
      host.loadRemote("concurrent_revalidate_remote/Value"),
    ]);

    assert.deepEqual(values, [{ default: "v2" }, { default: "v2" }]);
    assert.equal(
      requests.filter((request) => request === "/revalidate/concurrent-remoteEntry.ssr.cjs").length,
      2,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("allows disabling the CommonJS entry timeout", async () => {
  const entry = serve(
    "/timeout/remoteEntry.ssr.cjs",
    `
      module.exports.remote = {
        init() {},
        async get() {
          return () => ({ default: "loaded" });
        },
      };
    `,
    "text/javascript",
    20,
  );
  const container = await nodeEntryLoader({ fetchTimeoutMs: 0 }).loadEntry({
    origin: {},
    remoteInfo: {
      entry,
      entryGlobalName: "remote",
      name: "timeout_remote",
      type: "commonjs-module",
    },
  });

  assert.equal(typeof container.get, "function");
});

test("revalidates a Vite SSR entry after maxAgeMs expires", async () => {
  let requestsForViteEntry = 0;
  const entry = serve("/revalidate-vite/remoteEntry.ssr.js", () => {
    requestsForViteEntry += 1;
    return `
      export async function init() {}
      export async function get() {
        return () => ({ default: "v${requestsForViteEntry}" });
      }
      `;
  });
  const outcome = await runInHost(`
    const { createRequire } = await import("node:module");
    const { createInstance } = createRequire(process.cwd() + "/package.json")(
      "@module-federation/runtime",
    );
    const host = createInstance({
      name: "revalidate_vite_host",
      remotes: [{ name: "revalidate_vite_remote", entry: ${JSON.stringify(entry)}, type: "module" }],
      plugins: [loader({ maxAgeMs: 0 })],
    });
    const first = await host.loadRemote("revalidate_vite_remote/Value");
    const second = await host.loadRemote("revalidate_vite_remote/Value");
    console.log(JSON.stringify({ first, second }));
  `);
  assert.deepEqual(outcome, {
    first: { default: "v1" },
    second: { default: "v2" },
  });
  assert.equal(requestsForViteEntry, 2);
});

test("reports which step failed and keeps the cause", async () => {
  await assert.rejects(loadEntry(`${origin}/missing/remoteEntry.ssr.cjs`), (error) => {
    assert.ok(error instanceof RemoteEntryError);
    assert.equal(error.phase, "fetch");
    assert.equal(error.remote, "remote");
    assert.equal(error.url, `${origin}/missing/remoteEntry.ssr.cjs`);
    assert.match(error.cause.message, /HTTP 404/);
    return true;
  });

  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const offline = `http://127.0.0.1:${closed.address().port}/remoteEntry.ssr.cjs`;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(loadEntry(offline), { name: "RemoteEntryError", phase: "fetch" });

  const throwing = serve("/throws/remoteEntry.ssr.cjs", 'throw new Error("container failed");');
  await assert.rejects(loadEntry(throwing), (error) => {
    assert.equal(error.phase, "evaluate");
    assert.equal(error.cause.message, "container failed");
    return true;
  });

  const empty = serve("/empty/remoteEntry.ssr.cjs", "module.exports = {};");
  await assert.rejects(loadEntry(empty), {
    message: /did not export a federation container/,
    phase: "evaluate",
  });
});

test("leaves other entries to the federation runtime", async () => {
  assert.equal(await loadEntry(`${origin}/remoteEntry.js`, "global"), undefined);
  assert.equal(await loadEntry("/local/remoteEntry.ssr.cjs"), undefined);
});

test("Vite remotes ask for @module-federation/vite when the host lacks it", () => {
  const app = mkdtempSync(join(tmpdir(), "mf-tanstack-host-"));
  try {
    const script = join(app, "server.mjs");
    writeFileSync(
      script,
      `
        const { default: loader } = await import(${JSON.stringify(loaderUrl)});
        const remoteInfo = { entry: "http://127.0.0.1:9/remoteEntry.ssr.js", name: "vite_remote", type: "module" };
        const origin = { name: "host", options: { shared: {} }, shareScopeMap: {} };
        try {
          await loader().loadEntry({ origin, remoteInfo });
        } catch (error) {
          console.log(JSON.stringify({ message: error.message, phase: error.phase }));
        }
      `,
    );
    const result = spawnSync(process.execPath, [script], { cwd: app, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const error = JSON.parse(result.stdout);
    assert.equal(error.phase, "loader");
    assert.match(error.message, /Add @module-federation\/vite to the host's dependencies/);
  } finally {
    rmSync(app, { force: true, recursive: true });
  }
});

/**
 * Runs `body` as an ES module in the Rsbuild SSR example host, which depends on
 * @module-federation/vite and React, and returns the JSON it logs last. It runs in a child
 * process so the loader's module registrations stay out of this one.
 */
async function runInHost(body) {
  const app = join(root, "apps", "rsbuild-ssr-host");
  const directory = mkdtempSync(join(tmpdir(), "mf-tanstack-host-"));
  try {
    const script = join(directory, "server.mjs");
    writeFileSync(
      script,
      `const { default: loader } = await import(${JSON.stringify(loaderUrl)});\n${body}`,
    );
    // Asynchronous, so this process's test server can answer the child.
    const { stdout } = await promisify(execFile)(process.execPath, [script], { cwd: app });
    return JSON.parse(stdout.trim().split("\n").at(-1));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test("Vite remotes resolve node_modules React to the host's own instance", async () => {
  const outcome = await runInHost(`
    import { createRequire } from "node:module";
    const hostReact = { version: "host" };
    const unused = { version: "not loaded" };
    const origin = {
      name: "host",
      options: { shared: {} },
      shareScopeMap: {
        default: {
          react: { "19.3.0": { from: "host", loaded: true, lib: () => hostReact } },
          "react-dom": { "19.3.0": { from: "host", lib: () => unused } },
        },
      },
    };
    // A closed port: the load fails, after the host's modules are registered.
    const remoteInfo = { entry: "http://127.0.0.1:9/remoteEntry.js", name: "vite_remote", type: "module" };
    const phase = await loader().loadEntry({ origin, remoteInfo }).catch((error) => error.phase);
    const appRequire = createRequire(process.cwd() + "/package.json");
    console.log(JSON.stringify({
      phase,
      react: appRequire("react") === hostReact,
      reactDom: appRequire("react-dom") === unused,
    }));
  `);
  assert.deepEqual(outcome, { phase: "fetch", react: true, reactDom: false });
});

test("Vite remotes report a reachable remote without a server entry", async () => {
  // A Vite remote built without a server entry: its manifest lists no ssrRemoteEntry.
  const entry = serve("/no-ssr/remoteEntry.js", "export {};");
  serve(
    "/no-ssr/mf-manifest.json",
    JSON.stringify({
      exposes: [],
      metaData: { remoteEntry: { name: "remoteEntry.js", path: "" } },
    }),
    "application/json",
  );
  const outcome = await runInHost(`
    const origin = { name: "host", options: { shared: {} }, shareScopeMap: {} };
    const remoteInfo = { entry: ${JSON.stringify(entry)}, name: "vite_remote", type: "module" };
    const error = await loader().loadEntry({ origin, remoteInfo }).catch((error) => error);
    console.log(JSON.stringify({ message: error.message, phase: error.phase }));
  `);
  assert.equal(outcome.phase, "loader");
  assert.match(outcome.message, /could not load the server entry of remote "vite_remote"/);
});

test("getRemoteStylesheets resolves an expose's CSS from its manifest", async () => {
  const manifest = (publicPath) =>
    JSON.stringify({
      exposes: [
        {
          assets: { css: { async: ["assets/lazy.css"], sync: ["assets/card.css"] } },
          name: "Card",
          path: "./Card",
        },
      ],
      metaData: { publicPath },
    });

  const auto = serve("/auto/mf-manifest.json", manifest("auto"), "application/json");
  assert.deepEqual(await getRemoteStylesheets(auto, "./Card"), [
    `${origin}/auto/assets/card.css`,
    `${origin}/auto/assets/lazy.css`,
  ]);
  assert.deepEqual(await getRemoteStylesheets(auto, "Card"), [
    `${origin}/auto/assets/card.css`,
    `${origin}/auto/assets/lazy.css`,
  ]);
  await assert.rejects(getRemoteStylesheets(auto, "./Missing"), /does not expose "\.\/Missing"/);

  const cdn = serve(
    "/cdn/mf-manifest.json",
    manifest("https://cdn.test/remote/"),
    "application/json",
  );
  assert.deepEqual(await getRemoteStylesheets(cdn, "./Card"), [
    "https://cdn.test/remote/assets/card.css",
    "https://cdn.test/remote/assets/lazy.css",
  ]);
});

test("getRemoteStylesheets reuses manifests briefly and retries failures", async () => {
  const path = "/cache/mf-manifest.json";
  const url = `${origin}${path}`;
  const fetches = () => requests.filter((request) => request === path).length;

  await assert.rejects(getRemoteStylesheets(url, "./Card"), /HTTP 404/);
  serve(path, JSON.stringify({ exposes: [{ name: "Card", path: "./Card" }] }), "application/json");
  assert.deepEqual(await getRemoteStylesheets(url, "./Card"), []);
  assert.deepEqual(await getRemoteStylesheets(url, "./Card"), []);
  assert.equal(fetches(), 2, "the failure was retried, the success reused");

  assert.deepEqual(await getRemoteStylesheets(url, "./Card", { maxAgeMs: 0 }), []);
  assert.equal(fetches(), 3, "an expired manifest is fetched again");
});

/** Server-renders `element` to HTML once every Suspense boundary has settled. */
async function prerender(element) {
  const errors = [];
  const { prelude } = await prerenderToNodeStream(
    createElement(Suspense, { fallback: "fallback" }, element),
    { onError: (error) => void errors.push(error.message) },
  );
  let html = "";
  for await (const chunk of prelude) html += chunk;
  return { errors, html };
}

test("lazyRemote renders the remote, and loads again only after retryAfterMs", async () => {
  let online = false;
  let loads = 0;
  const Card = ({ label }) => createElement("p", null, `card ${label}`);
  const RemoteCard = lazyRemote(
    async () => {
      loads++;
      if (!online) throw new Error("remote offline");
      return { default: Card };
    },
    { retryAfterMs: 100 },
  );

  const offline = await prerender(createElement(RemoteCard, { label: "one" }));
  assert.deepEqual(offline.errors, ["remote offline"]);
  assert.doesNotMatch(offline.html, /card/);
  assert.equal(loads, 1);

  // The remote is back, but the failure stands until retryAfterMs passes.
  online = true;
  const tooSoon = await prerender(createElement(RemoteCard, { label: "two" }));
  assert.deepEqual(tooSoon.errors, ["remote offline"]);
  assert.equal(loads, 1);

  await new Promise((resolve) => setTimeout(resolve, 120));
  const recovered = await prerender(createElement(RemoteCard, { label: "three" }));
  assert.deepEqual(recovered.errors, []);
  assert.match(recovered.html, /card three/);
  assert.equal(loads, 2);

  // A loaded remote is never loaded again.
  online = false;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.match(renderToString(createElement(RemoteCard, { label: "four" })), /card four/);
  assert.equal(loads, 2);
});
