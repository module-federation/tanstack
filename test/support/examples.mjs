import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { getRemoteStylesheets } from "../../packages/tanstack/dist/runtime.js";

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

// The remotes each SSR host renders on the server, across both bundlers.
const serverRendered = {
  viteHost: ["viteRemote", "rsbuildSsrRemote"],
  rsbuildSsrHost: ["rsbuildSsrRemote", "viteRemote"],
};

const remoteCards = { viteRemote: cards.vite, rsbuildSsrRemote: cards.rsbuildSsr };

/**
 * Starts the six example apps with `script` ("start" for development servers, "preview"
 * for production builds) and registers the shared federation scenarios against them.
 */
export function describeExamples(script) {
  const processes = {};
  let browser;

  const start = async (key) => {
    processes[key] = startApp(apps[key].name, script);
    // A missing route renders TanStack's not-found page without touching any remote.
    await waitForResponse(`${apps[key].url}__ready`, processes[key], ({ status }) => status < 500);
  };

  // Production server entries of the Rsbuild SSR host, read before its dev server starts.
  const serverBuild = join(root, "apps", "rsbuild-ssr-host", "dist", "server", "index.cjs");
  let productionServerEntry;

  before(async () => {
    if (existsSync(serverBuild)) productionServerEntry = readFileSync(serverBuild, "utf8");
    await Promise.all(remotes.map(start));
    await Promise.all(hosts.map(start));
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    await Promise.all(Object.values(processes).map(stopApp));
  });

  test("SSR hosts render Vite and Rsbuild remote markup for concurrent first requests", async () => {
    for (const [host, remoteKeys] of Object.entries(serverRendered)) {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          fetch(apps[host].url, { signal: AbortSignal.timeout(60_000) }).then(readResponse),
        ),
      );
      for (const { body, status } of responses) {
        assert.equal(status, 200, host);
        for (const remote of remoteKeys) {
          assert.ok(body.includes(remoteCards[remote]), `${host} initial HTML contains ${remote}`);
        }
        assert.equal(
          body.match(/Rendered on the server/g)?.length,
          remoteKeys.length,
          `${host} renders every remote on the server`,
        );
      }
    }
  });

  test("server-rendered remotes are styled before JavaScript runs", async () => {
    for (const [host, remoteKeys] of Object.entries(serverRendered)) {
      const stylesheets = Object.fromEntries(
        await Promise.all(
          remoteKeys.map(async (remote) => [
            remote,
            await getRemoteStylesheets(
              new URL("mf-manifest.json", apps[remote].url).href,
              "./StatusCard",
            ),
          ]),
        ),
      );
      // A Vite dev server injects CSS from JavaScript, so its manifest lists none. Builds
      // must list every remote's stylesheet.
      const styled = remoteKeys.filter((remote) => stylesheets[remote].length > 0);
      if (script === "preview") assert.deepEqual(styled, remoteKeys, host);

      const context = await browser.newContext({ javaScriptEnabled: false });
      try {
        const page = await context.newPage();
        // Without JavaScript, streamed Suspense content stays hidden, so warm the host up
        // first: once its remotes are loaded, it renders them inline.
        await fetch(apps[host].url, { signal: AbortSignal.timeout(60_000) });
        await page.goto(apps[host].url);
        const loaded = await page.evaluate(() => [...document.styleSheets].map(({ href }) => href));

        for (const remote of styled) {
          for (const href of stylesheets[remote]) {
            assert.ok(loaded.includes(href), `${host} loads ${href}`);
          }
          const background = await page
            .locator("article", { hasText: remoteCards[remote] })
            .evaluate((card) => getComputedStyle(card).backgroundColor);
          assert.notEqual(background, "rgba(0, 0, 0, 0)", `${host} styles ${remote}`);
        }
      } finally {
        await context.close();
      }
    }
  });

  if (script === "start") {
    test("development servers leave production server builds alone", (t) => {
      if (productionServerEntry === undefined) {
        t.skip("needs a production build from before the development servers started");
        return;
      }
      // `rsbuild preview` serves dist/server, so a dev server must not write its bundle there.
      assert.equal(readFileSync(serverBuild, "utf8"), productionServerEntry);
    });
  }

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
      await page.getByText("Hydrated on the host").first().waitFor({ timeout: 20_000 });
      for (const card of [cards.vite, cards.rsbuildSsr, cards.rsbuild]) {
        await assertInteractive(page, card);
      }
      await assertHostContext(page, [cards.vite, cards.rsbuildSsr, cards.rsbuild], "Vite host");
    });
  });

  test("Rsbuild host loads the Vite and Rsbuild remotes with one React instance", async () => {
    await withPage(apps.rsbuildHost.url, async (page) => {
      await assertInteractive(page, cards.vite);
      await assertInteractive(page, cards.rsbuild);
      await assertHostContext(page, [cards.vite, cards.rsbuild], "Rsbuild host");
    });
  });

  test("Rsbuild SSR host hydrates the server-rendered Rsbuild and Vite remotes", async () => {
    await withPage(apps.rsbuildSsrHost.url, async (page) => {
      await page.getByText("Hydrated on the host").first().waitFor({ timeout: 20_000 });
      await assertInteractive(page, cards.rsbuildSsr);
      await assertInteractive(page, cards.vite);
      await assertHostContext(page, [cards.rsbuildSsr, cards.vite], "Rsbuild SSR host");
    });
  });

  test("remotes work as standalone TanStack Start apps", async () => {
    for (const [key, card] of [
      ["viteRemote", cards.vite],
      ["rsbuildRemote", cards.rsbuild],
      ["rsbuildSsrRemote", cards.rsbuildSsr],
    ]) {
      await withPage(apps[key].url, async (page) => {
        await assertInteractive(page, card);
        await assertHostContext(page, [card], "standalone");
      });
    }
  });

  // The last two scenarios stop remotes, then start them again.
  test("hosts fall back while remotes are offline and recover when they return", async () => {
    await Promise.all(remotes.map((key) => stopApp(processes[key])));

    for (const [host, expected] of [
      [
        "viteHost",
        [
          "Vite remote is unavailable",
          "Rsbuild SSR remote is unavailable",
          "Rsbuild remote is unavailable",
        ],
      ],
      ["rsbuildHost", ["Remote unavailable"]],
      ["rsbuildSsrHost", ["Rsbuild SSR remote is unavailable", "Vite remote is unavailable"]],
    ]) {
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

    await Promise.all(remotes.map(start));
    await assertServerRendersRemotes("again");
    await withPage(apps.rsbuildHost.url, async (page) => {
      await assertInteractive(page, cards.vite);
      await assertInteractive(page, cards.rsbuild);
    });
    await withPage(apps.viteHost.url, async (page) => {
      await page.getByText("Hydrated on the host").first().waitFor({ timeout: 20_000 });
      for (const card of [cards.vite, cards.rsbuildSsr, cards.rsbuild]) {
        await assertInteractive(page, card);
      }
    });
    await withPage(apps.rsbuildSsrHost.url, async (page) => {
      await assertInteractive(page, cards.rsbuildSsr);
      await assertInteractive(page, cards.vite);
    });
  });

  test("SSR hosts that start during an outage render the remotes once they return", async () => {
    await Promise.all(remotes.map((key) => stopApp(processes[key])));
    const ssrHosts = Object.keys(serverRendered);
    await Promise.all(ssrHosts.map((key) => stopApp(processes[key])));
    await Promise.all(ssrHosts.map(start));

    // The first requests fail to load every remote.
    for (const host of ssrHosts) {
      const { body, status } = await readResponse(
        await fetch(apps[host].url, { signal: AbortSignal.timeout(60_000) }),
      );
      assert.equal(status, 200, `${host} serves its page while remotes are offline`);
      assert.equal(body.includes("Rendered on the server"), false, host);
    }

    await Promise.all(remotes.map(start));
    await assertServerRendersRemotes("after starting during an outage");
    await withPage(apps.viteHost.url, async (page) => {
      await page.getByText("Hydrated on the host").first().waitFor({ timeout: 20_000 });
      for (const card of [cards.vite, cards.rsbuildSsr, cards.rsbuild]) {
        await assertInteractive(page, card);
      }
      await assertHostContext(page, [cards.vite, cards.rsbuildSsr, cards.rsbuild], "Vite host");
    });
    await withPage(apps.rsbuildSsrHost.url, async (page) => {
      await assertInteractive(page, cards.rsbuildSsr);
      await assertInteractive(page, cards.vite);
      await assertHostContext(page, [cards.rsbuildSsr, cards.vite], "Rsbuild SSR host");
    });
  });

  /** Waits until every SSR host renders all of its remotes on the server. */
  async function assertServerRendersRemotes(when) {
    for (const [host, remoteKeys] of Object.entries(serverRendered)) {
      const { body } = await waitForResponse(apps[host].url, processes[host], ({ body }) =>
        remoteKeys.every((remote) => body.includes(remoteCards[remote])),
      );
      assert.equal(
        body.match(/Rendered on the server/g)?.length,
        remoteKeys.length,
        `${host} renders its remotes on the server ${when}`,
      );
    }
  }

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

/** Proves each remote card reads the context its host provides through a shared module. */
async function assertHostContext(page, cardTexts, hostName) {
  for (const cardText of cardTexts) {
    const card = page.locator("article", { hasText: cardText });
    await card.getByText(`Host: ${hostName}`).waitFor({ timeout: 5_000 });
  }
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
