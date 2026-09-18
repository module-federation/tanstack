import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function startApp(name) {
  const child = spawn("pnpm", ["--filter", name, "start"], {
    cwd: root,
    detached: true,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";

  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      child.output = `${child.output}${chunk}`.slice(-12_000);
    });
  }

  return child;
}

async function waitForResponse(url, child, predicate = () => true) {
  const deadline = Date.now() + 20_000;
  let lastError;
  let lastResponse;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.fail(`server stopped while waiting for ${url}\n${child.output}`);
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      lastResponse = { body: await response.text(), status: response.status };
      if (predicate(lastResponse)) return lastResponse;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  assert.fail(
    [
      `timed out waiting for ${url}`,
      lastResponse ? `last status: ${lastResponse.status}` : undefined,
      lastError ? `last error: ${lastError.message}` : undefined,
      child.output,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function stopApp(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  process.kill(-child.pid, "SIGTERM");

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, "SIGKILL");
  }
}

test("Vite host server-renders a component from the Vite remote", async () => {
  const remote = startApp("tanstack-start-vite-remote");
  let host;

  try {
    const remoteEntry = await waitForResponse(
      "http://127.0.0.1:3001/remoteEntry.js",
      remote,
      ({ status }) => status === 200,
    );
    assert.match(remoteEntry.body, /virtual:mf-exposes/);

    host = startApp("tanstack-start-vite-host");
    const response = await waitForResponse(
      "http://127.0.0.1:3000/",
      host,
      ({ body, status }) => status === 200 && body.includes("Owned by the remote app"),
    );

    assert.match(response.body, /Two full-stack apps\. One React tree\./);
    assert.match(response.body, /Rendered on the server/);
  } finally {
    if (host) await stopApp(host);
    await stopApp(remote);
  }
});

test("Vite and Rsbuild hosts serve reciprocal browser-interoperability shells", async () => {
  const viteRemote = startApp("tanstack-start-vite-remote");
  const rsbuildRemote = startApp("tanstack-start-rsbuild-remote");
  let viteHost;
  let rsbuildHost;

  try {
    await waitForResponse(
      "http://127.0.0.1:3001/remoteEntry.js",
      viteRemote,
      ({ status }) => status === 200,
    );
    const manifest = await waitForResponse(
      "http://127.0.0.1:3002/mf-manifest.json",
      rsbuildRemote,
      ({ status }) => status === 200,
    );
    assert.match(manifest.body, /tanstack_rsbuild_remote/);

    viteHost = startApp("tanstack-start-vite-host");
    rsbuildHost = startApp("tanstack-start-rsbuild-host");

    const viteResponse = await waitForResponse(
      "http://127.0.0.1:3000/",
      viteHost,
      ({ status }) => status === 200,
    );
    const rsbuildResponse = await waitForResponse(
      "http://127.0.0.1:3003/",
      rsbuildHost,
      ({ status }) => status === 200,
    );

    assert.match(viteResponse.body, /Rsbuild remote loads after hydration/);
    assert.match(rsbuildResponse.body, /Rspack host, two remote formats/);
    assert.match(rsbuildResponse.body, /Loading the Rsbuild remote/);
    assert.match(rsbuildResponse.body, /Loading the Vite remote/);
  } finally {
    if (rsbuildHost) await stopApp(rsbuildHost);
    if (viteHost) await stopApp(viteHost);
    await stopApp(rsbuildRemote);
    await stopApp(viteRemote);
  }
});
