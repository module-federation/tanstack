# @module-federation/tanstack

TanStack Start integration for Module Federation on Vite and Rsbuild. The
adapter packages are optional peers, so importing one adapter does not resolve
the other.

## Support status

| Host    | Remote  | Browser federation | Federated SSR              |
| ------- | ------- | ------------------ | -------------------------- |
| Vite    | Vite    | Supported          | Supported                  |
| Vite    | Rsbuild | Supported          | Not supported              |
| Rsbuild | Vite    | Supported          | Not supported              |
| Rsbuild | Rsbuild | Supported          | Supported (`server: true`) |

"Federated SSR" means the remote component is rendered into the host's initial
HTML. Every supported row is covered by browser tests against both development
servers and production builds: the remote hydrates, responds to clicks, logs no
errors, and the host falls back and recovers when the remote goes offline.

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

Vite 8 is required for SSR remote loading during development.

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

Pass `server: true` (or an options object) to federate on the server. Enable it
on both sides:

- **Remotes** (`exposes`) build a Node container into `dist/client/ssr/`, next
  to the browser assets, and advertise it in `mf-manifest.json` as
  `ssrRemoteEntry`. Deploy `dist/client` as usual; the container holds only the
  exposed modules, never the app's server code. The remote's own server output
  is unchanged.
- **Hosts** (`remotes`) load remotes on the server through the Module
  Federation Node runtime. TanStack Start's server output becomes async-node
  CommonJS (`dist/server/index.cjs`), with `dist/server/index.js` re-exporting
  it, so `rsbuild preview` and deployments that import `index.js` keep working.

Import the remote in the route `loader` and render it inside a Suspense or
error boundary; see `apps/rsbuild-ssr-host` in the repository.

## Known limitations

- Server-rendered remotes arrive without their stylesheets: the remote's CSS
  loads with its JavaScript, after the HTML. Expect a short unstyled flash for
  remote markup in SSR responses.
- A Vite remote with `exposes` does not hydrate when opened directly as an app:
  `@module-federation/vite` waits for a host to initialize it. Production builds
  worked standalone up to `@module-federation/vite` 1.22.1; 1.23.0 broke them.
  Loading the remote through a host is unaffected.
- In development, a Vite host's dev server exits when a Vite remote it has
  server-rendered goes offline (an unhandled rejection in
  `@module-federation/vite`'s dev SSR transport). Production hosts fall back and
  recover.
- Cross-bundler SSR is not supported. Cross-bundler remotes render after
  hydration.

## Requirements

- Node 22.18+, 24.11+, or 26+.
- TanStack Start 1.167.43+ (the first release with the Rsbuild integration).
- Vite: `@module-federation/vite` and `vite`.
- Rsbuild: `@module-federation/rsbuild-plugin` and `@rsbuild/core`.
