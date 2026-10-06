import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const apps = {
  viteHost: { name: "tanstack-start-vite-host", url: "http://127.0.0.1:3000/" },
  viteRemote: { name: "tanstack-start-vite-remote", url: "http://127.0.0.1:3001/" },
  rsbuildRemote: { name: "tanstack-start-rsbuild-remote", url: "http://127.0.0.1:3002/" },
  rsbuildHost: { name: "tanstack-start-rsbuild-host", url: "http://127.0.0.1:3003/" },
  rsbuildSsrRemote: { name: "tanstack-start-rsbuild-ssr-remote", url: "http://127.0.0.1:3004/" },
  rsbuildSsrHost: { name: "tanstack-start-rsbuild-ssr-host", url: "http://127.0.0.1:3005/" },
};

const remotes = ["viteRemote", "rsbuildRemote", "rsbuildSsrRemote"];
const hosts = ["viteHost", "rsbuildHost", "rsbuildSsrHost"];

const cards = {
  vite: "Owned by the remote app",
  rsbuild: "Federated from Rsbuild",
  rsbuildSsr: "Federated SSR from Rsbuild",
};

/**
 * Starts the six example apps with `script` ("start" for development servers, "preview"
 * for production builds) and registers the shared federation scenarios against them.
 * `outageRemotes` lists the remotes the outage scenario stops.
 */
export function describeExamples(script, { outageRemotes = remotes } = {}) {
  const processes = {};
  let browser;

  const start = async (key) => {
    processes[key] = startApp(apps[key].name, script);
    // A missing route renders TanStack's not-found page without touching any remote.
    await waitForResponse(`${apps[key].url}__ready`, processes[key], ({ status }) => status < 500);
  };

  before(async () => {
    await Promise.all(remotes.map(start));
    await Promise.all(hosts.map(start));
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    await Promise.all(Object.values(processes).map(stopApp));
  });

  test("SSR hosts render remote markup for concurrent first requests", async () => {
    for (const [host, marker] of [
      ["viteHost", cards.vite],
      ["rsbuildSsrHost", cards.rsbuildSsr],
    ]) {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => fetch(apps[host].url).then(readResponse)),
      );
      for (const { body, status } of responses) {
        assert.equal(status, 200, host);
        assert.ok(body.includes(marker), `${host} initial HTML contains the remote card`);
        assert.ok(
          body.includes("Rendered on the server"),
          `${host} renders the remote on the server`,
        );
      }
    }
  });

  test("remote manifests reference reachable assets", async () => {
    for (const key of remotes) {
      const manifestUrl = new URL("mf-manifest.json", apps[key].url).href;
      const manifest = await (await fetch(manifestUrl)).json();
      const assets = manifestAssets(manifest);
      assert.ok(assets.length > 0, `${key} lists assets`);
      for (const asset of assets) {
        const url = new URL(asset, manifestUrl).href;
        const { status } = await fetch(url);
        assert.equal(status, 200, url);
      }
    }
  });

  test("Vite host hydrates the Vite and Rsbuild remotes with one React instance", async () => {
    await withPage(apps.viteHost.url, async (page) => {
      await page.getByText("Hydrated on the host").waitFor({ timeout: 20_000 });
      await assertInteractive(page, cards.vite);
      await assertInteractive(page, cards.rsbuild);
    });
  });

  test("Rsbuild host loads the Vite and Rsbuild remotes with one React instance", async () => {
    await withPage(apps.rsbuildHost.url, async (page) => {
      await assertInteractive(page, cards.vite);
      await assertInteractive(page, cards.rsbuild);
    });
  });

  test("Rsbuild SSR host hydrates the server-rendered Rsbuild remote", async () => {
    await withPage(apps.rsbuildSsrHost.url, async (page) => {
      await page.getByText("Hydrated on the host").waitFor({ timeout: 20_000 });
      await assertInteractive(page, cards.rsbuildSsr);
    });
  });

  test("Rsbuild remotes work as standalone TanStack Start apps", async () => {
    await withPage(apps.rsbuildRemote.url, (page) => assertInteractive(page, cards.rsbuild));
    await withPage(apps.rsbuildSsrRemote.url, (page) => assertInteractive(page, cards.rsbuildSsr));
  });

  // @module-federation/vite never initializes a container with `exposes` when it is opened
  // directly in development, and 1.23.0 broke the production path too (1.22.x works).
  test.todo("Vite remote hydrates as a standalone app");

  // Runs last: it stops remotes, then starts them again.
  test("hosts fall back while remotes are offline and recover when they return", async () => {
    await Promise.all(outageRemotes.map((key) => stopApp(processes[key])));
    const offline = (key) => outageRemotes.includes(key);

    for (const [host, fallbacks] of [
      [
        "viteHost",
        [
          offline("viteRemote") && "Vite remote is unavailable",
          offline("rsbuildRemote") && "Rsbuild remote is unavailable",
        ],
      ],
      [
        "rsbuildHost",
        [(offline("viteRemote") || offline("rsbuildRemote")) && "Remote unavailable"],
      ],
      ["rsbuildSsrHost", [offline("rsbuildSsrRemote") && "Rsbuild SSR remote is unavailable"]],
    ]) {
      const expected = fallbacks.filter(Boolean);
      if (expected.length === 0) continue;

      const { status } = await fetch(apps[host].url);
      assert.equal(status, 200, `${host} still serves its page`);
      await withPage(
        apps[host].url,
        async (page) => {
          for (const fallback of expected) {
            await page.getByText(fallback).first().waitFor({ timeout: 20_000 });
          }
        },
        // React reports the failed server render as recoverable and renders the
        // boundary on the client, which is the fallback under test.
        { allowErrors: true },
      );
    }

    await Promise.all(outageRemotes.map(start));

    for (const [host, remote, marker] of [
      ["viteHost", "viteRemote", cards.vite],
      ["rsbuildSsrHost", "rsbuildSsrRemote", cards.rsbuildSsr],
    ]) {
      if (!offline(remote)) continue;
      const { body } = await waitForResponse(apps[host].url, processes[host], ({ body }) =>
        body.includes(marker),
      );
      assert.ok(body.includes("Rendered on the server"), `${host} renders the remote again`);
    }
    await withPage(apps.rsbuildHost.url, async (page) => {
      await assertInteractive(page, cards.vite);
      await assertInteractive(page, cards.rsbuild);
    });
    await withPage(apps.viteHost.url, async (page) => {
      await page.getByText("Hydrated on the host").waitFor({ timeout: 20_000 });
      await assertInteractive(page, cards.vite);
      await assertInteractive(page, cards.rsbuild);
    });
  });

  /** Opens a page, runs `check`, and fails on uncaught errors or console errors and warnings. */
  async function withPage(url, check, { allowErrors = false } = {}) {
    const page = await browser.newPage();
    const errors = [];
    if (!allowErrors) {
      page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type())) {
          errors.push(`${message.type()}: ${message.text()}`);
        }
      });
    }
    try {
      await page.goto(url);
      await check(page);
      assert.deepEqual(errors, [], url);
    } finally {
      await page.close();
    }
  }
}

/** Lists every file a manifest points to, relative to the manifest URL. */
function manifestAssets(manifest) {
  const { metaData } = manifest;
  const entries = [metaData.remoteEntry, metaData.ssrRemoteEntry]
    .filter(Boolean)
    .map(({ path, name }) => (path ? `${path.replace(/^\/|\/$/g, "")}/${name}` : name));
  const files = [...manifest.exposes, ...manifest.shared].flatMap(({ assets }) => [
    ...assets.js.sync,
    ...assets.js.async,
    ...assets.css.sync,
    ...assets.css.async,
  ]);
  return [...new Set([...entries, ...files])];
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

function startApp(name, script) {
  const child = spawn("pnpm", ["--filter", name, script], {
    cwd: root,
    detached: true,
    env: { ...process.env, NODE_ENV: script === "start" ? "development" : "production" },
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

async function readResponse(response) {
  return { body: await response.text(), status: response.status };
}

async function waitForResponse(url, child, predicate = () => true) {
  const deadline = Date.now() + 60_000;
  let lastError;
  let lastResponse;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.fail(`server stopped while waiting for ${url}\n${child.output}`);
    }

    try {
      lastResponse = await readResponse(await fetch(url, { signal: AbortSignal.timeout(5_000) }));
      if (predicate(lastResponse)) return lastResponse;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
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
