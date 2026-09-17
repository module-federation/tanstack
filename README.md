# @module-federation/tanstack

Module Federation support for TanStack Start, built on the Vite integration.

## Install

```bash
pnpm add @module-federation/tanstack @tanstack/react-start
```

## Configure

The federation wrapper must come before `tanstackStart()` so Module Federation
can normalize TanStack's client and SSR entrypoints:

```ts
import { tanstackStartModuleFederation } from "@module-federation/tanstack";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
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
    nitro(),
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
