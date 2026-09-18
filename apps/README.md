# TanStack Start example

Both sides of this example are TanStack Start applications.

- `remote` exposes `./StatusCard` from its Module Federation container and also
  renders the component on its own `/` route.
- `host` loads `tanstack_remote/StatusCard` from the remote running on port 3001. Its own application runs on port 3000.

From the repository root:

```bash
pnpm start
```

The federation wrapper must precede `tanstackStart()` in both Vite configs.
React and React DOM use the wrapper's singleton defaults.

Each package's `start` script runs Vite's development server. In Vite's CLI,
the bare `vite` command means “start”; the literal `vite start` command would
treat `start` as a project directory.
