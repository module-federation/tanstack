# @module-federation/tanstack

TanStack Start integration for Module Federation on Vite and Rsbuild. The
adapter packages are optional peers, so importing one adapter does not resolve
the other.

## Support status

| Host    | Remote  | Browser federation | Federated SSR                      |
| ------- | ------- | ------------------ | ---------------------------------- |
| Vite    | Vite    | Supported          | Supported                          |
| Vite    | Rsbuild | Supported          | Supported (remote: `server: true`) |
| Rsbuild | Vite    | Supported          | Supported (host: `server: true`)   |
| Rsbuild | Rsbuild | Supported          | Supported (both: `server: true`)   |

"Federated SSR" means the remote component is rendered into the host's initial
HTML. Every row is covered by browser tests against both development servers
and production builds: the remote hydrates, shares the host's React and
context, responds to clicks, logs no errors, and the host falls back and
recovers when the remote goes offline.

## Vite

```ts
import { tanstackStartModuleFederation } from "@module-federation/tanstack/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStartModuleFederation({
      name: "host",
      remotes: {
        remote: {
          type: "module",
          name: "remote",
          entry: "https://example.test/remoteEntry.js",
        },
      },
    }),
    tanstackStart(),
    react(),
  ],
});
```

Place the federation wrapper before `tanstackStart()`, followed by the React
plugin. The root import (`@module-federation/tanstack`) is the same Vite
adapter.

Defaults:

- `filename: "remoteEntry.js"`, `manifest: true`, and
  `hostInitInjectLocation: "entry"`.
- `react` and `react-dom` are shared singletons. When the config declares
  `remotes`, they are also `eager`, so the host's own React stays in the share
  scope and a remote built by another bundler cannot replace it. Remote-only
  builds stay lazy.
- Any entry you pass in `shared` replaces the default for that package.

A Vite host renders before lazy shared modules resolve, so mark any other shared
package the host imports from its entry or root route as `eager: true`, as the
wrapper does for React. Remotes can keep their shares lazy.

The wrapper omits the global Module Federation `target` option. TanStack
Start's client and SSR environments need `@module-federation/vite` to select
`web` and `node` independently.

The Vite adapter requires Vite 8, like TanStack Start's own examples and
`@vitejs/plugin-react` 6. It stops with an error on older versions, where
`@module-federation/vite` cannot load remotes on the server.

A Vite host renders Rsbuild remotes on the server when they are built with
`server: true` (see below). Declare such a remote by its manifest, so the
server can find the Node container:

```ts
remotes: {
  rsbuild_remote: {
    type: "global",
    name: "rsbuild_remote",
    entry: "https://example.test/mf-manifest.json",
  },
},
```

## Rsbuild

```ts
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/rsbuild";
import { tanstackStartModuleFederation } from "@module-federation/tanstack/rsbuild";

export default defineConfig({
  plugins: [
    pluginReact(),
    tanstackStart(),
    ...tanstackStartModuleFederation({
      federation: {
        name: "remote",
        exposes: { "./StatusCard": "./src/StatusCard.tsx" },
      },
    }),
  ],
});
```

The adapter returns an array of Rsbuild plugins; spread it into `plugins`, after
`tanstackStart()`. It emits script-compatible browser output, so the manifest
can be consumed by Vite and Rsbuild hosts.

Defaults:

- `react` and `react-dom` are shared singletons, `eager` for hosts (configs with
  `remotes`) and lazy for remote-only builds.
- `experiments.asyncStartup: true`, so entries wait for shared modules before
  running. Pass `experiments: { asyncStartup: false }` to opt out.
- A remote's browser build uses `publicPath: "auto"`, so hosts on other origins
  load its chunks from the remote. TanStack Start otherwise derives `/` from
  `server.base`. An absolute asset prefix, such as a CDN URL, is kept.

For hosts, set `shareStrategy: "loaded-first"`. With the default
`version-first` strategy, the host fetches every remote's manifest during
startup, and a single offline remote fails the whole page.

### SSR federation

Pass `server: true` (or an options object) to federate on the server:

- **Remotes** (`exposes`) build a Node container, `remoteEntry.ssr.cjs`, next to
  `remoteEntry.js` in `dist/client` (its chunks go in `dist/client/ssr/`), and
  advertise it in `mf-manifest.json` as `ssrRemoteEntry`. Deploy `dist/client`
  as usual; the container holds only the exposed modules, never the app's
  server code. The remote's own server output is unchanged. Vite and Rsbuild
  hosts can both render it.
- **Hosts** (`remotes`) load remotes on the server through the Module
  Federation Node runtime. TanStack Start's server output becomes async-node
  CommonJS (`dist/server/index.cjs`), with `dist/server/index.js` re-exporting
  it, so `rsbuild preview` and deployments that import `index.js` keep working.
  The dev server writes its server bundle to
  `node_modules/.cache/tanstack-start-federation/` instead, so a production
  build in `dist/server` survives development sessions. Rsbuild remotes need
  `server: true` too. Vite remotes need nothing extra on
  their side, but the host must have `@module-federation/vite` (and its `vite`
  peer) installed: their server entries are ES modules, loaded by that
  package's SSR loader.

When a remote's server entry cannot load, the host's runtime plugin throws a
`RemoteEntryError` whose `phase` is `fetch`, `evaluate`, or `loader` and whose
`cause` is the original error.

## Rendering remotes on the server

Hosts on either bundler render remotes the same way: load the remote in the
route `loader`, render it with `lazyRemote` inside a Suspense and error
boundary, and link its stylesheets from the route's `head`:

```tsx
import { getRemoteStylesheets, lazyRemote } from "@module-federation/tanstack/runtime";
import { createFileRoute } from "@tanstack/react-router";

const StatusCard = lazyRemote(() => import("remote/StatusCard"));

export const Route = createFileRoute("/")({
  // Loading the remote before rendering puts its markup in the server response.
  // A failed load must not fail the route: the boundary renders a fallback.
  loader: async () => {
    const [stylesheets] = await Promise.all([
      getRemoteStylesheets("https://remote.test/mf-manifest.json", "./StatusCard").catch(() => []),
      import("remote/StatusCard").catch(() => null),
    ]);
    return { stylesheets };
  },
  head: ({ loaderData }) => ({
    links: loaderData?.stylesheets.map((href) => ({ href, rel: "stylesheet" })),
  }),
  component: () => (
    <RemoteBoundary fallback="Loading…">
      <StatusCard />
    </RemoteBoundary>
  ),
});
```

`RemoteBoundary` stands for any error boundary around a `Suspense`; the
examples in `apps/` include one.

- **`lazyRemote(load, { retryAfterMs })`** is `React.lazy` for remotes. A
  `React.lazy` component that fails once stays failed, so a server that hit a
  remote outage would render the fallback until it restarts. `lazyRemote` loads
  again on the first render after `retryAfterMs` (5 seconds by default). The
  import itself loads again after a failure too: `@module-federation/vite`
  1.23.3+ retries failed server loads, and the Rsbuild adapter removes a failed
  remote module from Rspack's module cache.
- **`getRemoteStylesheets(manifestUrl, expose, { maxAgeMs })`** lists the
  stylesheets the remote's manifest declares for an expose, as absolute URLs. A
  remote's CSS otherwise loads with its JavaScript, after the HTML, so the
  server-rendered markup would be unstyled until then. It works in the browser
  and on the server, reuses a fetched manifest for 30 seconds (`maxAgeMs`), and
  rejects when the manifest is unreachable or does not list the expose.

## Known limitations

- In development, a Vite remote's server modules import React from the files
  its dev server resolves, so host and remote must resolve React to the same
  files, as they do in a monorepo. Production builds take React from the
  host's share scope.
- A Vite dev server injects CSS from JavaScript, so its manifest lists no
  stylesheets and `getRemoteStylesheets` returns none for it in development.

## Requirements

- Node 22.18+, 24.11+, or 26+.
- TanStack Start 1.167.43+ (the first release with the Rsbuild integration).
- React 19, which the tests use. TanStack Start also accepts React 18, but as
  of 1.168 its Rsbuild server build fails with it: TanStack Router imports
  React's `use`, which React 18 lacks. React 18 with Vite builds but is
  untested.
- Vite: `@module-federation/vite` 1.23.3+ and `vite` 8.
- Rsbuild: `@module-federation/rsbuild-plugin` and `@rsbuild/core`. An Rsbuild
  host that renders Vite remotes on the server also needs
  `@module-federation/vite` 1.23.3+ and `vite`.
