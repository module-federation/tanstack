# @module-federation/tanstack

TanStack Start integration for Module Federation. It delegates to
`@module-federation/vite` and supplies defaults needed by TanStack's client and
SSR environments.

```ts
import { tanstackStartModuleFederation } from "@module-federation/tanstack";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
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
  ],
});
```

Place the federation wrapper before `tanstackStart()`, followed by React and
Nitro plugins. Defaults: `filename: "remoteEntry.js"`, `manifest: true`,
`hostInitInjectLocation: "entry"`, and singleton `react`/`react-dom` shared
entries. User-provided `shared` entries override those defaults.

The wrapper intentionally omits the global Module Federation `target` option.
TanStack Start's client and SSR environments need `@module-federation/vite` to
select `web` and `node` independently.

Production builds support Vite 7 and 8. Vite 8 is required for SSR remote
loading during development.

Supported Node releases are 22.18+, 24.11+, and 26+.
