import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "tanstack", "dist");
const { createRemoteServerFunctions, fetchRemoteServerFunction, remoteServerFunctionBase } =
  await import(pathToFileURL(join(dist, "server-functions.js")).href);

const host = "http://host.test";
const base = remoteServerFunctionBase("catalog");

// A remote server that records what it receives and answers according to the path.
let remote;
let remoteOrigin;
let received = [];

before(async () => {
  remote = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ body, headers: request.headers, method: request.method, url: request.url });

    if (request.url.includes("/slow-headers")) {
      setTimeout(() => response.end("late"), 500);
      return;
    }
    if (request.url.includes("/slow-body")) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("first ");
      setTimeout(() => response.end("second"), 300);
      return;
    }
    response.writeHead(201, {
      "content-type": "application/json",
      "set-cookie": "remote=1",
      "x-tss-serialized": "true",
    });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => remote.listen(0, "127.0.0.1", resolve));
  remoteOrigin = `http://127.0.0.1:${remote.address().port}`;
});

after(() => remote.close());

function call(path, init = {}) {
  return new Request(new URL(path, host), {
    ...init,
    headers: { "sec-fetch-site": "same-origin", ...init.headers },
  });
}

test("the base for a remote's server functions is namespaced by its name", () => {
  assert.equal(base, "/_federation/catalog/_serverFn/");
});

test("leaves other requests to the host", () => {
  const { handle } = createRemoteServerFunctions({
    remotes: { catalog: { origin: remoteOrigin } },
  });
  assert.equal(handle(call("/")), undefined);
  assert.equal(handle(call("/_serverFn/abc")), undefined);
  assert.equal(handle(call("/_federation/other/_serverFn/abc")), undefined);
  assert.equal(handle(call("/_federation/catalog/elsewhere/abc")), undefined);
});

test("forwards a same-origin call with Start's protocol headers only", async () => {
  received = [];
  const { handle } = createRemoteServerFunctions({
    remotes: { catalog: { origin: remoteOrigin } },
  });
  const response = await handle(
    call(`${base}fn-1?payload=1`, {
      body: '{"data":1}',
      headers: {
        accept: "application/json",
        authorization: "Bearer host-token",
        "content-type": "application/json",
        cookie: "session=host",
        "x-tsr-serverfn": "true",
        "x-unrelated": "1",
      },
      method: "POST",
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("x-tss-serialized"), "true");
  assert.equal(response.headers.get("set-cookie"), null, "remote cookies stay off the host");

  const [{ body, headers, method, url }] = received;
  assert.equal(method, "POST");
  assert.equal(url, `${base}fn-1?payload=1`);
  assert.equal(body, '{"data":1}');
  assert.equal(headers.origin, remoteOrigin, "presents the remote's origin");
  assert.equal(headers["x-tsr-serverfn"], "true");
  assert.equal(headers["content-type"], "application/json");
  for (const header of ["authorization", "cookie", "x-unrelated"]) {
    assert.equal(headers[header], undefined, `${header} is not forwarded`);
  }
});

test("adds the headers the host chooses, with the request it is handling", async () => {
  received = [];
  const { handle } = createRemoteServerFunctions({
    remotes: {
      catalog: {
        headers: ({ request }) => ({ cookie: request.headers.get("cookie"), origin: "evil" }),
        origin: remoteOrigin,
      },
    },
  });
  await handle(call(`${base}fn-2`, { headers: { cookie: "session=host" } }));
  assert.equal(received[0].headers.cookie, "session=host");
  assert.equal(received[0].headers.origin, remoteOrigin, "headers cannot replace the origin");
});

test("rejects calls that do not come from the host's own pages", async () => {
  received = [];
  const { handle } = createRemoteServerFunctions({
    remotes: { catalog: { origin: remoteOrigin } },
  });
  for (const headers of [
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { "sec-fetch-site": null, origin: "http://evil.test" },
    { "sec-fetch-site": null, referer: "http://evil.test/page" },
    { "sec-fetch-site": null },
  ]) {
    const request = new Request(new URL(`${base}fn-3`, host), { method: "POST" });
    for (const [key, value] of Object.entries(headers)) {
      if (value !== null) request.headers.set(key, value);
    }
    assert.equal((await handle(request)).status, 403, JSON.stringify(headers));
  }

  const sameOrigin = new Request(new URL(`${base}fn-3`, host), {
    headers: { origin: host },
    method: "POST",
  });
  assert.equal((await handle(sameOrigin)).status, 201, "Origin of the host is accepted");
  assert.equal(received.length, 1, "rejected calls never reach the remote");
});

test("rejects other methods and malformed function paths", async () => {
  const { handle } = createRemoteServerFunctions({
    remotes: { catalog: { origin: remoteOrigin } },
  });
  const put = await handle(call(`${base}fn-4`, { body: "x", method: "PUT" }));
  assert.equal(put.status, 405);
  assert.equal(put.headers.get("allow"), "GET, POST");
  for (const path of [base, `${base}fn/extra`, `${base}fn%2Fextra`]) {
    assert.equal((await handle(call(path))).status, 404, path);
  }
});

test("answers 502 when the remote is unreachable or slow to respond", async () => {
  const offline = createRemoteServerFunctions({
    remotes: { catalog: { origin: "http://127.0.0.1:9" } },
  });
  assert.equal((await offline.handle(call(`${base}fn-5`))).status, 502);

  const slow = createRemoteServerFunctions({
    remotes: { catalog: { origin: remoteOrigin, timeoutMs: 100 } },
  });
  const started = Date.now();
  assert.equal((await slow.handle(call(`${base}slow-headers`))).status, 502);
  assert.ok(Date.now() - started < 450, "gives up after the timeout");
});

test("the timeout does not cut off a response that is still streaming", async () => {
  const { handle } = createRemoteServerFunctions({
    remotes: { catalog: { origin: remoteOrigin, timeoutMs: 100 } },
  });
  const response = await handle(call(`${base}slow-body`));
  assert.equal(await response.text(), "first second");
});

test("resolves a function origin on every call and rejects non-HTTP origins", async () => {
  let origin = remoteOrigin;
  const { handle } = createRemoteServerFunctions({
    remotes: { catalog: { origin: () => origin } },
  });
  assert.equal((await handle(call(`${base}fn-6`))).status, 201);
  origin = "http://127.0.0.1:9";
  assert.equal((await handle(call(`${base}fn-6`))).status, 502);

  assert.throws(
    () => createRemoteServerFunctions({ remotes: { catalog: { origin: "file:///etc" } } }),
    /needs an http or https origin/,
  );
  assert.throws(
    () => createRemoteServerFunctions({ remotes: { "../x": { origin: remoteOrigin } } }),
    /Invalid remote name/,
  );
});

test("calls from a remote's container use the host's configuration", async () => {
  await assert.rejects(
    fetchRemoteServerFunction("unrouted", `${remoteServerFunctionBase("unrouted")}fn`, {}),
    /does not route that remote's server functions/,
  );

  received = [];
  createRemoteServerFunctions({ remotes: { catalog: { origin: remoteOrigin } } });
  const response = await fetchRemoteServerFunction("catalog", `${base}fn-7?payload=2`, {
    headers: { "x-tsr-serverfn": "true" },
    method: "GET",
  });
  assert.equal(response.status, 201);
  assert.equal(received[0].url, `${base}fn-7?payload=2`);
  assert.equal(received[0].headers.origin, remoteOrigin);
});

test("remotes whose server functions share an ID each reach their own server", async () => {
  // Production builds can give two remotes' functions the same ID, such as one exported
  // from src/server-functions.ts in both. The remote's name keeps their calls apart.
  const servers = await Promise.all(
    ["catalog", "cart"].map(async (name) => {
      const server = createServer((request, response) => {
        // Answer out of order, so a response that reached the wrong caller would show.
        setTimeout(() => response.end(`${name}:${request.url}`), name === "catalog" ? 50 : 0);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return [name, server, `http://127.0.0.1:${server.address().port}`];
    }),
  );
  try {
    const { handle } = createRemoteServerFunctions({
      remotes: Object.fromEntries(servers.map(([name, , origin]) => [name, { origin }])),
    });
    const id = "shared-function-id";
    const calls = servers.flatMap(([name]) => {
      const path = `${remoteServerFunctionBase(name)}${id}`;
      return [
        // From the browser, through the host.
        handle(call(path, { method: "POST", body: "{}" })).then((response) => response.text()),
        // From the remote's container while the host renders.
        fetchRemoteServerFunction(name, path, { method: "POST", body: "{}" }).then((response) =>
          response.text(),
        ),
      ].map((answer) => answer.then((text) => [name, text]));
    });
    for (const [name, text] of await Promise.all(calls)) {
      assert.equal(text, `${name}:${remoteServerFunctionBase(name)}${id}`);
    }
  } finally {
    for (const [, server] of servers) server.close();
  }
});
