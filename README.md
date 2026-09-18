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
`hostInitInjectLocation: "entry"`. React and `react-dom` are shared singleton
defaults; any explicit entries in `shared` take precedence.

Do not set a global Module Federation `target`. TanStack Start builds client
and SSR environments from one Vite configuration, so the wrapper leaves target
selection to `@module-federation/vite` for each environment.

The package supports Node 22.18+, 24.11+, and 26+, plus Vite 7/8 and TanStack
Start 1.x. Use Vite 8 when developing SSR hosts that load remotes; Vite 7
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
        remotes: { remote: "remote@https://example.test/mf-manifest.json" },
      },
    }),
  ],
});
```

The Rsbuild adapter registers browser and SSR federation plugins by default. It
emits script-compatible browser output and async-node CommonJS SSR output so
its manifest can be consumed by Vite and Rsbuild hosts. The wrapper adds eager,
singleton `react` and `react-dom` entries without changing the caller's config
object. Set `server: false` for browser-only remotes.

Server federation mode emits `dist/server/index.cjs`; browser-only mode keeps
TanStack Start's standard `dist/server/index.js` entry.

## Example

The workspace includes Vite and Rsbuild pairs. `apps/remote` exposes a
stateful React card to `apps/host`. `apps/rsbuild-remote` exposes a second card
to the Vite host, while `apps/rsbuild-host` consumes the Vite remote. Both
cross-bundler links use manifest URLs. They render after hydration, so this is
browser interop coverage, not an unverified SSR interoperability claim.

```bash
pnpm install
pnpm start
```

This starts all four applications so both same-bundler and cross-bundler paths
are available. Open the Vite host at http://localhost:3000 or the Rsbuild host
at http://localhost:3003.
