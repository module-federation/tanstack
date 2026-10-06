import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const urls = {
  viteHost: "http://127.0.0.1:3000/",
  viteRemote: "http://127.0.0.1:3001/",
  rsbuildRemote: "http://127.0.0.1:3002/",
  rsbuildHost: "http://127.0.0.1:3003/",
};

const apps = {};
let browser;

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
  const deadline = Date.now() + 30_000;
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
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  process.kill(-child.pid, "SIGTERM");

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, "SIGKILL");
  }
}

/** Opens a page and records uncaught errors and React warnings logged as console errors. */
async function openPage(url) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  return { errors, page };
}

/** Clicks a remote card's counter and proves the remote's state updates on the host. */
async function assertInteractive(page, cardText) {
  const button = page
    .locator("article", { hasText: cardText })
    .getByRole("button", { name: /Remote count/ });
  await button.waitFor({ timeout: 20_000 });
  const count = async () => Number((await button.textContent()).match(/\d+/)?.[0]);

  // A server-rendered button ignores clicks until React hydrates it.
  const deadline = Date.now() + 20_000;
  while ((await count()) === 0) {
    assert.ok(Date.now() < deadline, `${cardText} never became interactive`);
    await button.click();
    await page.waitForTimeout(100);
  }

  const before = await count();
  await button.click();
  await page.waitForFunction(
    ([text, expected]) =>
      [...document.querySelectorAll("article")]
        .find((article) => article.textContent.includes(text))
        ?.querySelector("button")
        ?.textContent.includes(String(expected)),
    [cardText, before + 1],
    { timeout: 5_000 },
  );
}

before(async () => {
  apps.viteRemote = startApp("tanstack-start-vite-remote");
  apps.rsbuildRemote = startApp("tanstack-start-rsbuild-remote");
  await waitForResponse(
    `${urls.viteRemote}remoteEntry.js`,
    apps.viteRemote,
    ({ status }) => status === 200,
  );
  await waitForResponse(
    `${urls.rsbuildRemote}mf-manifest.json`,
    apps.rsbuildRemote,
    ({ status }) => status === 200,
  );

  apps.viteHost = startApp("tanstack-start-vite-host");
  apps.rsbuildHost = startApp("tanstack-start-rsbuild-host");
  await waitForResponse(urls.viteHost, apps.viteHost, ({ status }) => status === 200);
  await waitForResponse(urls.rsbuildHost, apps.rsbuildHost, ({ status }) => status === 200);

  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await Promise.all(Object.values(apps).map(stopApp));
});

test("Vite host server-renders a component from the Vite remote", async () => {
  const response = await waitForResponse(
    urls.viteHost,
    apps.viteHost,
    ({ body, status }) => status === 200 && body.includes("Owned by the remote app"),
  );

  assert.match(response.body, /Two full-stack apps\. One React tree\./);
  assert.match(response.body, /Rendered on the server/);
  assert.match(response.body, /Rsbuild remote loads after hydration/);
});

test("Rsbuild remote serves a browser manifest", async () => {
  const manifest = await waitForResponse(
    `${urls.rsbuildRemote}mf-manifest.json`,
    apps.rsbuildRemote,
    ({ status }) => status === 200,
  );
  assert.match(manifest.body, /tanstack_rsbuild_remote/);
});

test("Rsbuild host serves loading placeholders for both remotes", async () => {
  const response = await waitForResponse(urls.rsbuildHost, apps.rsbuildHost);
  assert.match(response.body, /Rspack host, two remote formats/);
  assert.match(response.body, /Loading the Rsbuild remote/);
  assert.match(response.body, /Loading the Vite remote/);
});

test("Vite host hydrates the Vite and Rsbuild remotes with one React instance", async () => {
  const { errors, page } = await openPage(urls.viteHost);
  try {
    await page.getByText("Hydrated on the host").waitFor({ timeout: 20_000 });
    await assertInteractive(page, "Owned by the remote app");
    await assertInteractive(page, "Federated from Rsbuild");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("Rsbuild host loads the Vite and Rsbuild remotes with one React instance", async () => {
  const { errors, page } = await openPage(urls.rsbuildHost);
  try {
    await assertInteractive(page, "Owned by the remote app");
    await assertInteractive(page, "Federated from Rsbuild");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("Rsbuild remote works as a standalone TanStack Start app", async () => {
  const { errors, page } = await openPage(urls.rsbuildRemote);
  try {
    await assertInteractive(page, "Federated from Rsbuild");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

// @module-federation/vite 1.22 never self-initializes a container with `exposes` in
// development, so its React share waits for a host. Production builds hydrate standalone.
test.todo("Vite remote hydrates as a standalone app in development");

// Runs last: it stops the Rsbuild remote.
test("hosts keep working when the Rsbuild remote is offline", async () => {
  await stopApp(apps.rsbuildRemote);

  for (const [url, fallback] of [
    [urls.viteHost, "Rsbuild remote is unavailable"],
    [urls.rsbuildHost, "Remote unavailable"],
  ]) {
    const page = await browser.newPage();
    const uncaught = [];
    page.on("pageerror", (error) => uncaught.push(error.stack ?? error.message));
    try {
      await page.goto(url);
      await page.getByText(fallback).waitFor({ timeout: 20_000 });
      await assertInteractive(page, "Owned by the remote app");
      assert.deepEqual(uncaught, [], url);
    } finally {
      await page.close();
    }
  }
});
