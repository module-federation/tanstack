# Federation TODO

This file tracks what `@module-federation/tanstack` proves today and the work
left after 0.1.0.

Assessment date: 2026-10-06.

## Support boundary

| Host    | Remote  | Browser federation | Federated SSR | Proof (development and production)                                   |
| ------- | ------- | ------------------ | ------------- | -------------------------------------------------------------------- |
| Vite    | Vite    | Supported          | Supported     | Remote markup in the host's initial HTML, hydration, outage/recovery |
| Vite    | Rsbuild | Supported          | Not supported | The Rsbuild remote loads in the browser after hydration              |
| Rsbuild | Vite    | Supported          | Not supported | The Vite remote loads through the browser runtime                    |
| Rsbuild | Rsbuild | Supported          | Supported     | `rsbuild-ssr-host` renders `rsbuild-ssr-remote` on the server        |

`test/example-runtime.test.mjs` (development servers) and
`test/example-production.test.mjs` (production builds) run the same scenarios
through `test/support/examples.mjs` on every supported Node line in CI.

## Done for 0.1.0

### Rsbuild-to-Rsbuild SSR

- [x] Default `experiments.asyncStartup: true` for browser and server
      federation, preserving an explicit `false`.
- [x] Share `react` and `react-dom` as singletons: eager for hosts, lazy for
      remotes and server containers, so remotes cannot replace a host's React.
- [x] Build a remote's Node container in a dedicated `mf-server` environment,
      emitted to `dist/client/ssr/` with the browser assets. It contains only
      the exposed modules; the app's server bundle is never published.
- [x] Advertise the container in the browser manifest as `ssrRemoteEntry`,
      which Module Federation otherwise only does for Rslib's `dual` target.
- [x] Give remotes `publicPath: "auto"`. TanStack Start derives `/` from
      `server.base`, which made production remotes request their chunks from
      the host's origin, and made Node hosts fail to fetch them.
- [x] Load remotes in a host's server bundle as async-node CommonJS, keep
      `dist/server/index.js` as an ES module that re-exports it, and write the
      server output to disk in development so async-node chunks match the
      in-memory entry.
- [x] Load CommonJS remote entries with `require`-based Node built-ins
      (`@module-federation/tanstack/node-entry-loader`). Rsbuild's development
      runner cannot evaluate Module Federation's `import("vm")`.
- [x] Dedicated fixtures: `apps/rsbuild-ssr-remote` and `apps/rsbuild-ssr-host`,
      importing the remote in a route loader.
- [x] Acceptance: initial HTML contains remote markup (not a placeholder), for
      eight concurrent first requests; hydration without warnings; the remote
      stays interactive; one React instance; no `RUNTIME-*` or chunk errors;
      the manifest declares a `commonjs-module` server entry; every
      manifest-referenced asset returns 200; the container has no
      build-machine paths.

### Hardening

- [x] Production builds (`vite preview`, `rsbuild preview`) run the same browser
      scenarios as development servers.
- [x] Hosts render a fallback, not a 500 or a blank page, while remotes are
      offline, and render remote markup again once they return.
- [x] `useState`, `useEffect`, Suspense, and error boundaries across the
      federation boundary (counter, hydration status, lazy remote components,
      `RemoteBoundary`).
- [x] Document `server: true`, the `ssr/` container, and the server entries.

## Open

### Upstream issues

Report these to `module-federation/vite`; they are documented as known
limitations.

- [ ] A Vite remote with `exposes` does not hydrate when opened directly in
      development: the plugin forces host-driven init for exposing containers
      (`forceClientInjected`), so the remote's own React shares never resolve.
      1.22 hangs; 1.23.2 throws `_jsxDEV is not a function`.
- [ ] Since 1.23.0, the same remote also fails standalone in production
      (`x is not a function` from the `react-dom/client` share). Bisected:
      1.22.0 and 1.22.1 hydrate; 1.23.0, 1.23.1, and 1.23.2 do not.
- [ ] In development, a Vite host's dev server exits with an unhandled
      `TypeError: fetch failed` (ECONNREFUSED) after a Vite remote it has
      server-rendered through the ModuleRunner transport (`/__mf_runner__`)
      goes offline. Production hosts are unaffected.

### SSR quality

- [ ] Include the remote's stylesheets in SSR responses. Neither SSR host emits
      the remote's CSS links, so remote markup is unstyled until its JavaScript
      loads. This likely needs a helper that reads `exposes[].assets.css` from
      the remote snapshot and feeds TanStack Start's route `head`.
- [ ] Revalidate a changed remote manifest and server entry without restarting
      the host, and prove no stale container or shared module is served.
- [ ] Test cyclic imports in a server remote graph.

### Shared dependencies

- [ ] Test React context created by the host and consumed by a remote, through
      a shared singleton package.
- [ ] Decide the React support range. TanStack Start allows React 18 and 19;
      only React 19 is tested.
- [ ] Validate version-mismatch warnings for incompatible React majors, and
      that `import: false` fails at startup when the host cannot provide a
      package.

### Versions

- [ ] Vite 7: `@vitejs/plugin-react` 6 requires Vite 8, so a Vite 7 run needs
      its own dependency set (`@vitejs/plugin-react` 5). Until then the docs
      claim Vite 8 only, while the peer range still allows Vite 7.

### Error reporting

- [ ] Preserve the original network or execution error, and distinguish
      manifest, entry, chunk, and shared-dependency failures.
- [ ] Add optional observability reports for raw runtime codes that do not
      contain enough context.

## Cross-bundler SSR (after 0.1.0)

The two server entry formats differ:

- Vite emits an ESM SSR entry and an ESM dependency graph.
- The Rsbuild adapter emits a CommonJS container (`ssr/remoteEntry.js`) with
  async-node chunks.

The Vite SSR loader can `require()` a local CommonJS entry. For an HTTP
CommonJS entry, `createRequire()` cannot load the URL, and the loader falls
through to paths designed around ESM source. In the other direction, Core's Node
runtime has ESM loading support, but nothing proves that an Rsbuild host can
load Vite's manifest-declared ESM SSR entry, preserve the host's React
instance, and hydrate the result. Both directions need changes in
`@module-federation/vite` or Core.

### Vite host with an Rsbuild SSR remote

Choose one server-entry strategy:

- Option A, emit an ESM SSR entry from Rsbuild: decide how the manifest
  identifies both server formats (it has one `ssrRemoteEntry` slot), keep the
  chunks reachable over HTTP, and verify Vite's temporary-file and VM
  strategies can link the graph.
- Option B, teach the Vite loader to evaluate HTTP CommonJS containers: a
  bounded loader that reuses Core's Node chunk loading, resolves async chunks
  from the remote public path, preserves module-cache identity for singletons,
  applies the ESM loader's fetch timeout and body limits, and avoids unbounded
  `eval`.

Acceptance: Vite 8 development and production render and hydrate the Rsbuild
remote, remote CSS arrives without a flash, and manifest revalidation replaces
a changed remote without restarting the host.

### Rsbuild host with a Vite SSR remote

- [ ] Confirm that Core's Node runtime selects `metaData.ssrRemoteEntry` with
      type `module`.
- [ ] Load Vite's transitive ESM chunks without Node network-import flags or
      `--experimental-vm-modules`.
- [ ] Map shared package imports to the Rsbuild host share scope.
- [ ] Verify development against Vite's `/__mf_ssr__/` and ModuleRunner
      endpoints, and production against the built `remoteEntry.ssr.js` graph.

Acceptance: the Rsbuild host's initial HTML contains the Vite remote, hydration
preserves it, and a remote outage returns a fallback instead of a 500.

## Release work for each new SSR combination

- [ ] Update the support table only after the combination passes the
      development and production scenarios on every supported Node line.
- [ ] Add a Changeset and list the tested bundler and Node versions in the
      release notes.
