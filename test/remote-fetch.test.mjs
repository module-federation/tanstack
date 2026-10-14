import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "tanstack", "dist");
const { fetchRemoteJson, fetchRemoteText } = await import(
  pathToFileURL(join(dist, "remote-fetch.js")).href
);

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("fetchRemoteText enforces the response size limit while streaming", async () => {
  globalThis.fetch = async () => new Response("0123456789", { status: 200 });

  await assert.rejects(
    fetchRemoteText("https://remote.test/entry.js", { fetchMaxBytes: 5 }),
    /exceeds the maximum size of 5 bytes/,
  );
});

test("fetchRemoteText rejects a response whose content-length is already too large", async () => {
  globalThis.fetch = async () =>
    new Response("ok", { headers: { "content-length": "100" }, status: 200 });

  await assert.rejects(
    fetchRemoteText("https://remote.test/entry.js", { fetchMaxBytes: 5 }),
    /content-length: 100/,
  );
});

test("fetchRemoteJson rejects non-2xx and malformed responses", async () => {
  globalThis.fetch = async (url) =>
    url.endsWith("/missing")
      ? new Response("missing", { status: 404 })
      : new Response("not-json", { status: 200 });

  await assert.rejects(fetchRemoteJson("https://remote.test/missing"), /HTTP 404/);
  await assert.rejects(fetchRemoteJson("https://remote.test/malformed"), /Could not parse/);
});

test("fetchRemoteText aborts a request that exceeds the timeout", async () => {
  globalThis.fetch = async (_url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });

  await assert.rejects(fetchRemoteText("https://remote.test/slow", { fetchTimeoutMs: 5 }), {
    name: "AbortError",
  });
});
