# Changelog

## 0.1.0

Initial release: Module Federation for TanStack Start on Vite and Rsbuild.

- `@module-federation/tanstack/vite` (also the package root) wraps
  `@module-federation/vite` with TanStack Start defaults: `remoteEntry.js`, a
  manifest, entry-level host init, and environment-specific build targets.
  Hosts share eager singleton `react` and `react-dom`, so a remote built by
  another bundler cannot replace the host's React instance.
- `@module-federation/tanstack/rsbuild` wraps
  `@module-federation/rsbuild-plugin` with script-compatible browser output,
  async startup, role-aware React sharing, and `publicPath: "auto"` for
  remotes, so production remotes load from their own origin.
- Rsbuild SSR federation with `server: true`: remotes ship a Node container in
  `dist/client/ssr/` and advertise it in their manifest; hosts load remotes on
  the server from an async-node CommonJS build that keeps `dist/server/index.js`
  as its entry.
- `@module-federation/tanstack/node-entry-loader`: the runtime plugin Rsbuild
  hosts use to load CommonJS remote entries on the server.
- Supported: federated SSR for Vite to Vite and Rsbuild to Rsbuild, and browser
  federation for every Vite/Rsbuild host and remote combination.
- Tested in development and production builds on Node 22.18, 24, and 26, with
  Vite 8.3, Rsbuild 2.2, TanStack Start 1.168, and React 19.3.
