# @module-federation/tanstack

TanStack Start integration for Module Federation on Vite and Rsbuild. The
adapter packages are optional peers, so importing one adapter does not resolve
the other.

## Support status

| Host    | Remote  | Browser federation | Federated SSR                 |
| ------- | ------- | ------------------ | ----------------------------- |
| Vite    | Vite    | Supported          | Supported                     |
| Vite    | Rsbuild | Supported          | Not supported                 |
| Rsbuild | Vite    | Supported          | Not supported                 |
| Rsbuild | Rsbuild | Supported          | Experimental (`server: true`) |

"Federated SSR" means the remote component is rendered into the host's initial
HTML. Every supported row is covered by a browser test that hydrates the remote,
clicks it, and checks for console errors.

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

The wrapper omits the global Module Federation `target` option. TanStack
Start's client and SSR environments need `@module-federation/vite` to select
`web` and `node` independently.

Production builds support Vite 7 and 8. Vite 8 is required for SSR remote
loading during development.

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

The adapter returns an array of Rsbuild plugins; spread it into `plugins`. It
emits script-compatible browser output, so the manifest can be consumed by Vite
and Rsbuild hosts. `react` and `react-dom` default to eager singletons because
TanStack Start imports React synchronously.

For hosts, set `shareStrategy: "loaded-first"`. With the default
`version-first` strategy, the host fetches every remote's manifest during
startup, and a single offline remote fails the whole page.

### Experimental SSR federation

Pass `server: true` (or an options object) to add an async-node CommonJS server
container. This changes TanStack Start's server output to
`dist/server/index.cjs`; start it with `node dist/server/index.cjs`. No
end-to-end SSR test covers this mode yet, and Vite hosts cannot load the
CommonJS server container.

## Known limitations

- In development, a Vite remote with `exposes` does not hydrate when opened
  directly in the browser: `@module-federation/vite` waits for a host to
  initialize it. Open it through a host, or use a production build.
- Cross-bundler SSR is not supported. Cross-bundler remotes render after
  hydration.

## Requirements

- Node 22.18+, 24.11+, or 26+.
- TanStack Start 1.167.43+ (the first release with the Rsbuild integration).
- Vite: `@module-federation/vite` and `vite`.
- Rsbuild: `@module-federation/rsbuild-plugin` and `@rsbuild/core`.
