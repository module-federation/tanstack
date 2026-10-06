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

The package supports Node 22.18+, 24.11+, and 26+, plus TanStack Start
1.167.43+. It is tested with Vite 8, which federated SSR requires; Vite 7 supports browser federation only.

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
be consumed by Vite and Rsbuild hosts. It shares singleton `react` and
`react-dom` (eager for hosts, lazy for remotes), enables async startup, and
gives remotes `publicPath: "auto"` so other origins load their chunks from the
remote. Hosts should use `shareStrategy: "loaded-first"` so one offline remote
cannot fail startup.

SSR federation is opt-in with `server: true` on both sides. A remote builds a
Node container into `dist/client/ssr/` and advertises it in its manifest; a host
loads remotes on the server from an async-node CommonJS server build. See the
[package README](packages/tanstack/README.md#ssr-federation).

## Support status

| Host    | Remote  | Browser federation | Federated SSR              |
| ------- | ------- | ------------------ | -------------------------- |
| Vite    | Vite    | Supported          | Supported                  |
| Vite    | Rsbuild | Supported          | Not supported              |
| Rsbuild | Vite    | Supported          | Not supported              |
| Rsbuild | Rsbuild | Supported          | Supported (`server: true`) |

Known limitations are listed in the
[package README](packages/tanstack/README.md#known-limitations), and
[`TODO.md`](TODO.md) tracks the remaining work.

## Examples

The workspace has six TanStack Start apps; see [`apps/README.md`](apps/README.md).

The repository uses pnpm 12 (pinned in `packageManager`). pnpm 12 ships as a
native binary, so an older global pnpm cannot switch to it automatically;
install pnpm 12 itself (see https://pnpm.io/installation) before running these
commands.

```bash
pnpm install
pnpm start    # development servers
pnpm preview  # production builds
```

Open the Vite host at http://127.0.0.1:3000, the Rsbuild host at
http://127.0.0.1:3003, or the Rsbuild SSR host at http://127.0.0.1:3005.

`pnpm test` builds everything, then runs the six apps twice, as development
servers and as production builds, and drives every host in headless Chromium.
It checks server-rendered remote markup (including concurrent first requests),
hydration, remote interactivity, console errors, manifest asset reachability,
and the fallback and recovery when remotes go offline. Run
`pnpm exec playwright install chromium` once before the first local test run.
