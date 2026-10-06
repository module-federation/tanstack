# SSR completion TODO

This file tracks the work required before `@module-federation/tanstack` can
claim SSR support across both Vite and Rsbuild/Rspack.

Assessment date: 2026-09-18. Updated 2026-10-06: the Rsbuild server adapter is now
opt-in (`server: true`), and browser tests cover hydration, shared React
identity, and remote outages for every host/remote pair.

## Current support boundary

| Host    | Remote  | Federated SSR status | Current proof                                                                   |
| ------- | ------- | -------------------- | ------------------------------------------------------------------------------- |
| Vite    | Vite    | Supported            | The Vite host response contains remote markup before hydration.                 |
| Vite    | Rsbuild | Not supported        | The Rsbuild remote loads in the browser after hydration.                        |
| Rsbuild | Vite    | Not supported        | The Vite remote loads through the browser runtime after hydration.              |
| Rsbuild | Rsbuild | Experimental         | `server: true` builds a server container, but no end-to-end SSR fixture exists. |

The Rsbuild examples are TanStack Start SSR applications, so their local route
shells render on the server. Their Module Federation configuration uses the
default browser-only mode; federated components are client-only. Do not describe that as
federated SSR.

The supported claim today is:

> Vite-to-Vite federated SSR, plus Vite/Rsbuild browser interoperability.

## Evidence behind this boundary

### Vite-to-Vite SSR works

- [`packages/tanstack/src/vite.ts`](packages/tanstack/src/vite.ts) registers one
  Vite federation plugin for TanStack Start's client and server environments.
- The wrapper leaves `target` unset so `@module-federation/vite` selects `web`
  for the client and `node` for SSR.
- `hostInitInjectLocation: "entry"` initializes federation before TanStack
  hydrates an application without an `index.html` entry.
- `module-federation/vite` enables its SSR entry loader for every production
  build and for Vite 8 development. Vite 7 development does not have the
  ModuleRunner support required by this path.
- Vite remotes emit a separate ESM `remoteEntry.ssr.js` and include it in
  `mf-manifest.json` as `metaData.ssrRemoteEntry`.
- The Vite SSR loader resolves the manifest entry, links shared packages to the
  host, and evaluates the remote through Vite ModuleRunner, `vm.SourceTextModule`,
  or a temporary ESM graph.
- [`test/example-runtime.test.mjs`](test/example-runtime.test.mjs) verifies that
  the Vite host's initial HTML contains `Owned by the remote app` and
  `Rendered on the server`.

Reference implementation paths:

- `module-federation/vite/src/utils/ssrCapabilities.ts`
- `module-federation/vite/src/plugins/pluginSSRRemoteEntry.ts`
- `module-federation/vite/src/utils/ssrEntryLoader.ts`
- `module-federation/vite/src/plugins/pluginAddEntry.ts`
- `module-federation/vite/src/virtualModules/virtualRuntimeInitStatus.ts`

### Rsbuild has the required pieces, but not the proof

- [`packages/tanstack/src/rsbuild.ts`](packages/tanstack/src/rsbuild.ts) installs
  separate `web` and `node` federation plugins for TanStack Start's `client`
  and `ssr` environments.
- The browser compiler emits script/JSONP-compatible output.
- The server compiler can emit async-node CommonJS output with
  `serverRemoteEntry.cjs` and `dist/server/index.cjs`.
- React and React DOM default to eager singletons for Rsbuild. TanStack's server
  bundle imports React synchronously, and Core reports `RUNTIME-006` when those
  shares are lazy.
- Core's `target: "node"` path changes the compiler target to `async-node`,
  creates a CommonJS server container, and injects
  `@module-federation/node/runtimePlugin`.
- Core only installs its startup dependency handling when
  `experiments.asyncStartup` is enabled. The TanStack adapter does not default
  this option today.
- Both committed Rsbuild examples use the default browser-only mode, so the
  server adapter is covered by compiler-contract tests, not by a running host/remote pair.

Reference implementation paths:

- `module-federation/core/packages/rsbuild-plugin/src/cli/index.ts`
- `module-federation/core/packages/rsbuild-plugin/src/utils/ssr.ts`
- `module-federation/core/packages/node/src/runtimePlugin.ts`
- `module-federation/core/packages/enhanced/src/lib/container/ModuleFederationPlugin.ts`
- `module-federation/core/packages/webpack-bundler-runtime/src/installInitialConsumes.ts`

### Cross-bundler SSR needs an explicit transport contract

The two server entry formats differ:

- Vite emits an ESM SSR entry and an ESM dependency graph.
- The current Rsbuild adapter emits a CommonJS container and async-node chunks.

The Vite loader can `require()` a local CommonJS entry. For an HTTP CommonJS
entry, `createRequire()` cannot load the URL, and the loader falls through to
paths designed around ESM source. That is not a reliable Rsbuild remote loader.

In the other direction, Core's Node runtime has ESM loading support, but this
repository does not prove that an Rsbuild host can load Vite's manifest-declared
ESM SSR entry, preserve the host React instance, and hydrate the result.

## Phase 1: finish Rsbuild-to-Rsbuild SSR

### Adapter defaults

- [ ] Merge `experiments.asyncStartup: true` into the Rsbuild browser and server
      federation options.
- [ ] Preserve an explicit `experiments.asyncStartup: false` override.
- [ ] Keep `react` and `react-dom` eager singletons by default.
- [ ] Cover React subpaths used by the compiled application, including
      `react/jsx-runtime` and `react-dom/client`, without creating a second React
      instance.
- [ ] Assert that Core's node target injects the Node runtime plugin exactly
      once.
- [ ] Confirm that two environment-scoped Rsbuild plugins continue to install
      one browser container and one server container.

### Server-enabled fixtures

- [ ] Add a dedicated Rsbuild remote with the server adapter enabled.
- [ ] Expose a stateful component from both `remoteEntry.js` and
      `serverRemoteEntry.cjs`.
- [ ] Add a dedicated Rsbuild host with the server adapter enabled.
- [ ] Import the remote through a route loader or another real async boundary.
- [ ] Start the production remote from `dist/server/index.cjs`.
- [ ] Serve the client manifest, server entry, server chunks, JavaScript, CSS,
      and federated type archive from stable URLs.
- [ ] Start the production host from `dist/server/index.cjs`.
- [ ] Ensure development and production use the same remote naming and share
      scope.

### Rsbuild SSR acceptance criteria

- [ ] The host's initial HTML contains remote component markup.
- [ ] The initial HTML does not contain only a loading placeholder.
- [ ] Hydration completes without warnings or subtree replacement.
- [ ] A remote button remains interactive after hydration.
- [ ] Host context and hooks work inside the remote component.
- [ ] React and React DOM resolve to one physical host-owned instance.
- [ ] No `RUNTIME-006`, `RUNTIME-001`, or missing chunk error appears.
- [ ] The remote manifest declares a `commonjs-module` server entry.
- [ ] Every server entry import and async chunk is reachable in production.
- [ ] The built server output contains no build-machine absolute paths.

## Phase 2: support a Vite host with an Rsbuild SSR remote

Choose and document one server-entry strategy before implementing this path.

### Option A: emit an ESM SSR entry from Rsbuild

This aligns the remote with the existing Vite SSR loader.

- [ ] Determine whether the Rsbuild server compiler can emit a second ESM
      container without changing the CommonJS entry used by Rsbuild hosts.
- [ ] Decide how the manifest identifies both server formats. The current
      manifest has one `ssrRemoteEntry` slot.
- [ ] Keep server chunks portable and reachable over HTTP.
- [ ] Verify that Vite's temporary-file and VM strategies can link the emitted
      graph.

### Option B: teach the Vite loader to evaluate HTTP CommonJS containers

This aligns the host with the existing Rsbuild server output.

- [ ] Add a bounded HTTP CommonJS loader rather than passing an HTTP URL to
      `createRequire()`.
- [ ] Reuse Core's Node chunk-loading behavior where possible.
- [ ] Resolve relative async chunks from the remote public path.
- [ ] Preserve Node module-cache identity for React and other singletons.
- [ ] Apply the same fetch timeout and maximum-body limits used by the ESM
      loader.
- [ ] Avoid unrestricted `eval` or unbounded code fetching.

### Vite-host acceptance criteria

- [ ] Vite 8 development renders the Rsbuild remote into initial HTML.
- [ ] Vite 8 production renders and hydrates the same remote.
- [ ] Vite 7 production works, or the package documents a narrower requirement.
- [ ] Remote CSS appears before or during hydration without a layout flash.
- [ ] Manifest revalidation replaces a changed remote without restarting the
      host process.

## Phase 3: support an Rsbuild host with a Vite SSR remote

- [ ] Confirm that Core's Node runtime selects `metaData.ssrRemoteEntry` instead
      of the browser entry in a Vite manifest.
- [ ] Confirm support for a manifest entry whose type is `module`.
- [ ] Load Vite's transitive ESM chunks without Node network-import flags.
- [ ] Map shared package imports to the Rsbuild host share scope.
- [ ] Remove any dependency on `--experimental-vm-modules` from the supported
      default path.
- [ ] Verify development against Vite's `/__mf_ssr__/` and ModuleRunner
      endpoints.
- [ ] Verify production against the built `remoteEntry.ssr.js` graph.

### Rsbuild-host acceptance criteria

- [ ] The Rsbuild host's initial HTML contains Vite remote markup.
- [ ] Hydration preserves that markup and remote state.
- [ ] The Node runtime reports no missing module, VM import, or chunk execution
      error.
- [ ] A remote outage returns a controlled fallback instead of a 500 response.

## Phase 4: shared identity and recovery hardening

### Shared dependencies

- [ ] Test React context created by the host and consumed by every remote.
- [ ] Test `useState`, `useEffect`, Suspense, and error boundaries across the
      federation boundary.
- [ ] Test React 18 and React 19 if both remain in the support range.
- [ ] Validate version mismatch warnings for incompatible React majors.
- [ ] Ensure `import: false` fails at startup when the host cannot provide the
      required package.

### Remote lifecycle

- [ ] Start the host while the remote is unavailable.
- [ ] Bring the remote online and prove that a later request recovers.
- [ ] Restart the remote with a new manifest and server entry.
- [ ] Revalidate without serving a stale container or stale shared module.
- [ ] Test concurrent first requests while the remote entry is loading.
- [ ] Test cyclic imports in the server remote graph.

### Error reporting

- [ ] Preserve the original network or execution error.
- [ ] Distinguish manifest failure, entry failure, chunk failure, and shared
      dependency failure.
- [ ] Add optional observability reports for raw runtime codes that do not
      contain enough context.

## Required test matrix

| Host      | Remote    | Development  | Production | Initial remote HTML | Hydration and interaction |
| --------- | --------- | ------------ | ---------- | ------------------- | ------------------------- |
| Vite 8    | Vite 8    | Existing     | Add        | Existing            | Existing (development)    |
| Vite 7    | Vite 7    | Not required | Add        | Add                 | Add                       |
| Rsbuild 2 | Rsbuild 2 | Add          | Add        | Add                 | Add                       |
| Vite 8    | Rsbuild 2 | Add          | Add        | Add                 | Add                       |
| Rsbuild 2 | Vite 8    | Add          | Add        | Add                 | Add                       |

Run the production matrix on every supported Node line:

- [ ] Node 22.18
- [ ] Node 24
- [ ] Node 26

Each matrix row must verify:

- [ ] manifest and remote entry return 200;
- [ ] every manifest-referenced asset returns 200;
- [ ] initial HTML contains the expected remote marker;
- [ ] hydration produces no console errors or mismatch warnings;
- [ ] remote interaction updates state;
- [ ] host and remote use one React dispatcher;
- [ ] shutting down the remote produces the documented fallback;
- [ ] restarting the remote allows recovery.

## Documentation and release work

- [ ] Update the root README only after a matrix row satisfies every acceptance
      criterion.
- [x] Document browser-only federation as the Rsbuild default and SSR as opt-in.
- [ ] Document `dist/server/index.cjs` when the CommonJS Rsbuild server adapter
      is enabled.
- [ ] Document the chosen cross-bundler server-entry format.
- [ ] Keep Vite 8 as the development SSR requirement unless Vite 7 gains an
      equivalent ModuleRunner path.
- [ ] Add a Changeset for any new supported SSR combination.
- [ ] Include the tested bundler and Node version matrix in the release notes.

## Definition of done

SSR support for a host/remote combination is complete only when:

- [ ] the remote is rendered into the host's initial HTML;
- [ ] the same markup hydrates without replacement;
- [ ] the remote remains interactive;
- [ ] shared React identity is proven;
- [ ] development and production both pass where claimed;
- [ ] remote outage and recovery behavior are tested;
- [ ] server entries and all chunks are deployable without local paths;
- [ ] the supported versions are documented;
- [ ] CI runs the proof on every supported Node line.

Until then, keep the package description precise: Vite-to-Vite SSR is supported;
Rsbuild and cross-bundler SSR are in progress.

## Example and development gaps

- [ ] Run the browser tests against production builds, not only development
      servers.
- [ ] A Vite remote with `exposes` does not hydrate when opened directly in
      development: `@module-federation/vite` 1.22 forces host-driven init for
      exposing containers (`forceClientInjected`). Report upstream, or add a
      standalone init path.
- [ ] Decide whether the Rsbuild adapter should default hosts to
      `shareStrategy: "loaded-first"`. With `version-first`, one offline remote
      fails host startup with `RUNTIME-003`; the example sets it explicitly.
