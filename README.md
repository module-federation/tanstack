# @module-federation/tanstack

Module Federation support for TanStack Start on Vite and Rsbuild. Rsbuild uses
Rspack under the hood.

## Install

```bash
pnpm add @module-federation/tanstack @tanstack/react-start
```

Install the adapter for the bundler you use. They are optional peers so an
Rsbuild-only application does not install or resolve the Vite adapter, and a
Vite-only application does not install or resolve the Rsbuild adapter.

```bash
pnpm add @module-federation/vite vite               # Vite
pnpm add @module-federation/rsbuild-plugin @rsbuild/core # Rsbuild
```

## Configure

The federation wrapper must come before `tanstackStart()` so Module Federation
can normalize TanStack's client and SSR entrypoints:

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

Defaults are `remoteEntry.js`, `manifest: true`, and
`hostInitInjectLocation: "entry"`. React and `react-dom` are shared
singletons; when the config declares `remotes`, they are also eager so the
host's own React stays in the share scope. Explicit entries in `shared` take
precedence.

Do not set a global Module Federation `target`. TanStack Start builds client
and SSR environments from one Vite configuration, so the wrapper leaves target
selection to `@module-federation/vite` for each environment.

The package supports Node 22.18+, 24.11+, and 26+, plus Vite 7/8 and TanStack
Start 1.167.43+. Use Vite 8 when developing SSR hosts that load remotes; Vite 7
remains supported for production builds.

The package root remains a Vite compatibility export. New Vite projects can
import `/vite` explicitly. Rsbuild projects must import `/rsbuild`:

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
        name: "host",
        shareStrategy: "loaded-first",
        remotes: { remote: "remote@https://example.test/mf-manifest.json" },
      },
    }),
  ],
});
```

The Rsbuild adapter emits script-compatible browser output, so its manifest can
be consumed by Vite and Rsbuild hosts. It adds eager, singleton `react` and
`react-dom` entries without changing the caller's config object. Hosts should
use `shareStrategy: "loaded-first"` so one offline remote cannot fail startup.

SSR federation for Rsbuild is experimental and opt-in: `server: true` adds an
async-node CommonJS server container and changes the server entry to
`dist/server/index.cjs`.

## Support status

| Host    | Remote  | Browser federation | Federated SSR                 |
| ------- | ------- | ------------------ | ----------------------------- |
| Vite    | Vite    | Supported          | Supported                     |
| Vite    | Rsbuild | Supported          | Not supported                 |
| Rsbuild | Vite    | Supported          | Not supported                 |
| Rsbuild | Rsbuild | Supported          | Experimental (`server: true`) |

[`TODO.md`](TODO.md) tracks the remaining SSR work.

## Examples

The workspace has four TanStack Start apps; see [`apps/README.md`](apps/README.md).

```bash
pnpm install
pnpm start
```

Open the Vite host at http://127.0.0.1:3000 or the Rsbuild host at
http://127.0.0.1:3003. Each host renders a card from both remotes.

`pnpm test` builds everything, starts all four apps, and drives both hosts in
headless Chromium. It checks hydration, remote interactivity, console errors,
and the fallback when a remote is offline. Run
`pnpm exec playwright install chromium` once before the first local test run.
