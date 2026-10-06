# TanStack Start examples

Six TanStack Start applications: a browser-federation host and remote for each
bundler, plus an Rsbuild pair that federates on the server.

| App                  | Port | Role                                                                   |
| -------------------- | ---- | ---------------------------------------------------------------------- |
| `vite-host`          | 3000 | Server-renders the Vite remote; loads the Rsbuild remote on the client |
| `vite-remote`        | 3001 | Exposes `./StatusCard`, rendered into the Vite host's initial HTML     |
| `rsbuild-remote`     | 3002 | Exposes `./StatusCard` through a browser manifest                      |
| `rsbuild-host`       | 3003 | Loads both remotes with `loadRemote()` after hydration                 |
| `rsbuild-ssr-remote` | 3004 | Exposes `./StatusCard` with a Node container (`server: true`)          |
| `rsbuild-ssr-host`   | 3005 | Server-renders the Rsbuild SSR remote (`server: true`)                 |

From the repository root:

```bash
pnpm start    # development servers
pnpm preview  # production builds (`vite preview` / `rsbuild preview`)
```

Then open http://127.0.0.1:3000, http://127.0.0.1:3003, or
http://127.0.0.1:3005. Every remote card has a counter button; clicking it
proves the remote shares the host's React instance. Cards rendered on the
server show "Rendered on the server" until they hydrate.

## What each host shows

- **Vite host.** The route loader imports the Vite remote, so its card is in
  the server response and hydrates in place. The Rsbuild card mounts after
  hydration. Both remotes sit behind `RemoteBoundary`, an error boundary with a
  fallback card, and the loader ignores a failed import, so an offline remote
  never fails the route.
- **Rsbuild host.** `RemoteCardSlot` calls `loadRemote()` in an effect and
  shows "Remote unavailable" when a remote fails. The host uses
  `shareStrategy: "loaded-first"`, so it does not fetch every remote's
  manifest at startup.
- **Rsbuild SSR host.** Same pattern as the Vite host, on Rsbuild: the loader
  imports the remote on the server through the Module Federation Node runtime,
  which fetches the container from the remote's `ssr/` directory.

Stop a remote while the hosts are open and reload them: each host keeps
rendering and shows its fallback, then renders the remote again once it is
back.

## Notes

- The federation wrapper must come before `tanstackStart()` in the Vite
  configs, and after it in the Rsbuild configs.
- Each `start` script runs the bundler's development server. In Vite's CLI the
  bare `vite` command starts the dev server; `vite start` would treat `start`
  as a project directory.
- Opening the Vite remote directly (port 3001) server-renders the page but does
  not hydrate it: `@module-federation/vite` waits for a host to initialize a
  container with `exposes`. It hydrates when loaded through a host.
- Cross-bundler remotes render on the client only.
