# TanStack Start examples

Six TanStack Start applications: a host and a remote for each bundler, plus an
Rsbuild pair that federates on the server. Both SSR hosts render a Vite remote
and an Rsbuild remote into their initial HTML.

`host-context` is a small shared package: each host provides its name through a
React context, and every remote card shows "Host: …". It is shared as a
singleton, so the right name only appears when host and remote resolve one
module instance.

| App                  | Port | Role                                                                             |
| -------------------- | ---- | -------------------------------------------------------------------------------- |
| `vite-host`          | 3000 | Server-renders the Vite and Rsbuild SSR remotes; loads `rsbuild-remote` later    |
| `vite-remote`        | 3001 | Exposes `./StatusCard`, rendered into both SSR hosts' initial HTML               |
| `rsbuild-remote`     | 3002 | Exposes `./StatusCard` through a browser manifest                                |
| `rsbuild-host`       | 3003 | Loads both browser remotes with `loadRemote()` after hydration                   |
| `rsbuild-ssr-remote` | 3004 | Exposes `./StatusCard` with a Node container (`server: true`) for both SSR hosts |
| `rsbuild-ssr-host`   | 3005 | Server-renders the Rsbuild SSR and Vite remotes (`server: true`)                 |

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

- **Vite host.** The route loader imports the Vite remote and the Rsbuild SSR
  remote, so both cards are in the server response and hydrate in place. The
  loader also reads each remote's stylesheets with `getRemoteStylesheets`, and
  the route's `head` links them, so the cards are styled before JavaScript
  runs. The `rsbuild-remote` card mounts after hydration. The cards are
  `lazyRemote` components, which load again after a failure. Every remote sits
  behind `RemoteBoundary`, an error boundary with a fallback card, and the
  loader ignores failed imports, so an offline remote never fails the route.
- **Rsbuild host.** `RemoteCardSlot` calls `loadRemote()` in an effect and
  shows "Remote unavailable" when a remote fails. The host uses
  `shareStrategy: "loaded-first"`, so it does not fetch every remote's
  manifest at startup.
- **Rsbuild SSR host.** Same pattern as the Vite host, on Rsbuild. The
  Module Federation Node runtime loads the Rsbuild remote's
  `remoteEntry.ssr.cjs` container, and hands the Vite remote's ES module entry
  to `@module-federation/vite`'s SSR loader, which is why this app depends on
  `@module-federation/vite` and `vite`.

Stop a remote while the hosts are open and reload them: each host keeps
rendering and shows its fallback, then renders the remote again once it is
back. The same holds for a host started before its remotes.

## Notes

- The federation wrapper must come before `tanstackStart()` in the Vite
  configs, and after it in the Rsbuild configs.
- Each `start` script runs the bundler's development server. In Vite's CLI the
  bare `vite` command starts the dev server; `vite start` would treat `start`
  as a project directory.
- Every remote also works as a standalone TanStack Start app: open port 3001,
  3002, or 3004 directly, and its card shows "Host: standalone".
