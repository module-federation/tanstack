# @module-federation/tanstack

TanStack Start integration for Module Federation on Vite and Rsbuild. The
adapter packages are optional peers, so importing one adapter does not resolve
the other.

The root import remains compatible with existing Vite configurations. New Vite
projects can use `/vite` explicitly:

```ts
import { tanstackStartModuleFederation } from "@module-federation/tanstack/vite";
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

Place the federation wrapper before `tanstackStart()`, followed by the React
plugin. Defaults: `filename: "remoteEntry.js"`, `manifest: true`,
`hostInitInjectLocation: "entry"`, and singleton `react`/`react-dom` shared
entries. User-provided `shared` entries override those defaults.

The wrapper intentionally omits the global Module Federation `target` option.
TanStack Start's client and SSR environments need `@module-federation/vite` to
select `web` and `node` independently.

Production builds support Vite 7 and 8. Vite 8 is required for SSR remote
loading during development.

For TanStack Start's Rsbuild integration, use the dedicated adapter. It adds
separate browser and SSR Module Federation plugins so Rspack emits a browser
script remote and async-node CommonJS SSR remote. For a browser-only remote,
pass `server: false`:

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

Install `@module-federation/vite` with Vite projects, or
`@module-federation/rsbuild-plugin` and `@rsbuild/core` with Rsbuild projects.
Those packages, plus `@tanstack/react-start`, are optional peers because each
adapter is loaded only by its matching subpath.

The default Rsbuild server adapter changes TanStack Start's server output to
async-node CommonJS. Start that build with `node dist/server/index.cjs`. Passing
`server: false` keeps TanStack Start's standard `dist/server/index.js` output
for browser-only federation.

Supported Node releases are 22.18+, 24.11+, and 26+.
