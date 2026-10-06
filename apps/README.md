# TanStack Start examples

Four TanStack Start applications: a host and a remote for each bundler. Each
host consumes both remotes, so every host/remote combination runs.

| App              | Port | Role                                                                   |
| ---------------- | ---- | ---------------------------------------------------------------------- |
| `vite-host`      | 3000 | Server-renders the Vite remote; loads the Rsbuild remote on the client |
| `vite-remote`    | 3001 | Exposes `./StatusCard`, rendered into the Vite host's initial HTML     |
| `rsbuild-remote` | 3002 | Exposes `./StatusCard` through a browser manifest                      |
| `rsbuild-host`   | 3003 | Loads both remotes with `loadRemote()` after hydration                 |

From the repository root:

```bash
pnpm start
```

Then open http://127.0.0.1:3000 or http://127.0.0.1:3003. Every remote card has
a counter button; clicking it proves the remote shares the host's React
instance.

## What each host shows

- **Vite host.** The route loader imports the Vite remote, so its card is in
  the server response ("Rendered on the server") and hydrates in place. The
  Rsbuild card mounts after hydration. Both remotes sit behind
  `RemoteBoundary`, an error boundary with a fallback card, so a failed remote
  never blanks the page.
- **Rsbuild host.** `RemoteCardSlot` calls `loadRemote()` in an effect and
  shows "Remote unavailable" when a remote fails. The host uses
  `shareStrategy: "loaded-first"`, so it does not fetch every remote's
  manifest at startup.

Stop the Rsbuild remote while both hosts are open and reload them: each host
keeps rendering and shows its fallback card.

## Notes

- The federation wrapper must come before `tanstackStart()` in the Vite
  configs.
- Each `start` script runs the bundler's development server. In Vite's CLI the
  bare `vite` command starts the dev server; `vite start` would treat `start`
  as a project directory.
- In development, opening the Vite remote directly (port 3001) server-renders
  the page but does not hydrate: `@module-federation/vite` waits for a host to
  initialize a container that has `exposes`. It hydrates when loaded through a
  host, and its production build hydrates standalone.
- Cross-bundler remotes render on the client only. Cross-bundler SSR is not
  supported yet.
