# Changelog

## 0.1.0

Initial release: Module Federation for TanStack Start on Vite and Rsbuild.

- `@module-federation/tanstack/vite` (also the package root) wraps
  `@module-federation/vite` with TanStack Start defaults: `remoteEntry.js`, a
  manifest, entry-level host init, and environment-specific build targets.
- Vite hosts share eager singleton `react` and `react-dom`, so a remote built
  by another bundler cannot replace the host's React instance.
- `@module-federation/tanstack/rsbuild` wraps
  `@module-federation/rsbuild-plugin` with script-compatible browser output and
  eager singleton React shares. SSR federation is experimental and opt-in
  through `server: true`.
- Supported: Vite-to-Vite federated SSR, plus browser federation for every
  Vite/Rsbuild host and remote combination.
- Tested with Node 22.18, 24, and 26; Vite 8.3; Rsbuild 2.2; TanStack Start
  1.168; React 19.3.
