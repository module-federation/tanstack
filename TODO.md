# Federation TODO

This file tracks what `@module-federation/tanstack` proves today and the work
left after 0.1.0.

Assessment date: 2026-10-06.

## Support boundary

| Host    | Remote  | Browser federation | Federated SSR | Proof (development and production)                                    |
| ------- | ------- | ------------------ | ------------- | --------------------------------------------------------------------- |
| Vite    | Vite    | Supported          | Supported     | `vite-host` renders `vite-remote` on the server                       |
| Vite    | Rsbuild | Supported          | Supported     | `vite-host` renders `rsbuild-ssr-remote` on the server                |
| Rsbuild | Vite    | Supported          | Supported     | `rsbuild-ssr-host` renders `vite-remote` on the server                |
| Rsbuild | Rsbuild | Supported          | Supported     | `rsbuild-ssr-host` renders `rsbuild-ssr-remote` on the server         |
| Any     | Any     | Supported          | —             | `rsbuild-host` and `vite-host` load browser-only remotes on hydration |

`test/example-runtime.test.mjs` (development servers) and
`test/example-production.test.mjs` (production builds) run the same scenarios
through `test/support/examples.mjs` on every supported Node line in CI: remote
markup in the initial HTML for eight concurrent first requests, remote
stylesheets in the response (builds), hydration without console errors, remote
interactivity, one React instance and shared context, fallback and recovery
while every remote is offline, and hosts that start during an outage rendering
the remotes once they return.

## Done for 0.1.0

### Rsbuild remotes on the server

- [x] Default `experiments.asyncStartup: true` for browser and server
      federation, preserving an explicit `false`.
- [x] Share `react` and `react-dom` as singletons: eager for hosts, lazy for
      remotes and server containers, so remotes cannot replace a host's React.
- [x] Build a remote's Node container in a dedicated `mf-server` environment:
      `remoteEntry.ssr.cjs` next to `remoteEntry.js`, chunks in `ssr/`. It
      contains only the exposed modules; the app's server bundle is never
      published.
- [x] Advertise the container in the browser manifest as a `commonjs-module`
      `ssrRemoteEntry`, which Module Federation otherwise only does for
      Rslib's `dual` target.
- [x] Give remotes `publicPath: "auto"`. TanStack Start derives `/` from
      `server.base`, which made production remotes request their chunks from
      the host's origin, and made Node hosts fail to fetch them.
- [x] Keep the container next to the manifest, so its chunks resolve the same
      way from the container URL (Module Federation's Node runtime) and from
      the manifest URL (`@module-federation/vite`).

### Rsbuild hosts on the server

- [x] Load remotes in a host's server bundle as async-node CommonJS, keep
      `dist/server/index.js` as an ES module that re-exports it, and write the
      server output to disk in development so async-node chunks match the
      in-memory entry. The dev bundle goes to
      `node_modules/.cache/tanstack-start-federation/`, so it never replaces a
      production build in `dist/server`.
- [x] `@module-federation/tanstack/node-entry-loader` compiles CommonJS
      containers as CommonJS modules, so their `import()` calls work in
      Rsbuild's development runner without experimental Node flags or
      warnings.
- [x] Vite remotes: the loader hands ES module entries to
      `@module-federation/vite`'s SSR loader, loaded with Node's `require` so
      its imports bypass Rsbuild's runner. It registers the host's loaded
      shared modules under their node_modules paths, so React imported from
      node_modules by a Vite dev server's module runner is the host's React.
- [x] Failures throw `RemoteEntryError` with `phase` (`fetch`, `evaluate`,
      `loader`), the remote, the URL, and the original `cause`, instead of
      falling through to Module Federation's Node loader, which cannot load
      ES modules without Node flags.

### Vite hosts

- [x] Support Vite 8 only, like TanStack Start's examples (Vite ^8.0.14 with
      `@vitejs/plugin-react` 6, which requires Vite 8). The `vite` peer range
      is `^8.0.0`, and the adapter stops with an error on older versions: on
      Vite 7, `@module-federation/vite` hangs server-side remote loads in
      development and emits an unresolved `virtual:` import in production.
- [x] Require `@module-federation/vite` 1.23.3, which ships the fixes for the
      problems found here (see "Fixed upstream" below), so the adapter needs
      no workarounds for it.

### SSR quality and hardening

- [x] `getRemoteStylesheets` (`@module-federation/tanstack/runtime`) reads an
      expose's stylesheets from the remote manifest for the route `head`, so
      server-rendered remote markup is styled before JavaScript loads. The
      production suite checks it with JavaScript disabled.
- [x] Production builds (`vite preview`, `rsbuild preview`) run the same browser
      scenarios as development servers.
- [x] Hosts render a fallback, not a 500 or a blank page, while remotes are
      offline, and render remote markup again once they return, in development
      and production.
- [x] Hosts recover from a remote that failed its first load, such as a host
      started during an outage. Three layers kept the failure:
      `@module-federation/vite`'s single load attempt (fixed in 1.23.3),
      Rspack's module cache (a failed remote module kept empty exports;
      Rspack's `strictModuleExceptionHandling` caches the error instead, so
      the adapter removes the module from the cache), and `React.lazy`
      (`lazyRemote`).
- [x] Every remote, including the Vite remote, works as a standalone TanStack
      Start app (`@module-federation/vite` 1.23.3).
- [x] `useState`, `useEffect`, Suspense, and error boundaries across the
      federation boundary (counter, hydration status, lazy remote components,
      `RemoteBoundary`).
- [x] React context created by each host and read by every remote, including
      across bundlers and in server-rendered HTML, through the singleton
      `example-host-context` package.

## Open

### Upstream issues

To report to `module-federation/core`:

- [ ] `@module-federation/webpack-bundler-runtime`: a remote module that
      failed stays in the module cache with empty exports, although the load
      itself is retried. Worked around by `remoteRetryPlugin`.
- [ ] `@module-federation/node`: a container without an absolute public path
      logs `Backup remote entry found` for every chunk it loads through a Vite
      host.

Fixed upstream in `@module-federation/vite` 1.23.3:

- [x] An unawaited `__mf_remote_pending` turned a remote outage into an
      unhandled rejection that exited a dev server
      ([vite#1421](https://github.com/module-federation/vite/pull/1421)).
- [x] A server wrapper made one load attempt, so a remote that failed its
      first load failed for the life of the process
      ([vite#1424](https://github.com/module-federation/vite/issues/1424),
      fixed by [vite#1426](https://github.com/module-federation/vite/pull/1426)).
- [x] The SSR loader could not load a CommonJS server container from a
      manifest ([vite#1423](https://github.com/module-federation/vite/issues/1423),
      fixed by [vite#1425](https://github.com/module-federation/vite/pull/1425)).
- [x] Rollup builds (Vite 5 to 7) kept an unresolved `virtual:mf-exposes-ssr:`
      import in the SSR entry outside Nuxt
      ([vite#1422](https://github.com/module-federation/vite/pull/1422)).
- [x] A Vite remote with `exposes` did not hydrate when opened directly
      ([vite#1413](https://github.com/module-federation/vite/issues/1413),
      fixed by [vite#1415](https://github.com/module-federation/vite/pull/1415)
      and [vite#1420](https://github.com/module-federation/vite/pull/1420)).

### SSR quality

- [ ] Revalidate a changed remote manifest and server entry without restarting
      the host, and prove no stale container or shared module is served.
      `@module-federation/vite` has `revalidate()` and `maxAgeMs` for its own
      loader; the Module Federation runtime caches containers for the life of
      the process. Server-entry revalidation is now available for Vite hosts
      through `ssrEntryLoader.maxAgeMs` and for Rsbuild hosts through
      `server.ssrEntryLoader.maxAgeMs`. For Vite's native loader, a manifest
      provides the version needed for automatic change detection; direct or
      convention-resolved server-entry URLs need an explicit `revalidate()` for
      forced refresh. Shared-singleton changes still require a host restart, so
      the shared-module portion remains open. Remote module-scope side effects
      are not automatically disposed during revalidation and remain the
      application's responsibility.
- [ ] Test cyclic imports across chunks in a server remote graph.
- [ ] In development, a Vite remote's server modules import React from the files
      its dev server resolves, so host and remote must resolve React to the
      same files (true in a monorepo). Production builds take React from the
      share scope.

### Shared dependencies

- [x] React range: React 19. TanStack Start 1.168 accepts React 18, but its
      Rsbuild server build fails with it: TanStack Router imports React's
      `use`, which React 18 lacks. Vite apps build with React 18; revisit when
      TanStack Start supports it on both bundlers.
- [ ] Validate version-mismatch warnings for incompatible React majors, and
      that `import: false` fails at startup when the host cannot provide a
      package. With mismatched React majors, the federation runtime already
      warns (`Version 18.3.1 ... does not satisfy the requirement ... 19.3.0`).

### Error reporting

- [ ] Distinguish manifest, chunk, and shared-dependency failures the way
      `RemoteEntryError` does for server entries.
- [ ] Add optional observability reports for raw runtime codes that do not
      contain enough context.

## Release work for each new SSR combination

- [ ] Update the support table only after the combination passes the
      development and production scenarios on every supported Node line.
- [ ] Add a Changeset and list the tested bundler and Node versions in the
      release notes.
