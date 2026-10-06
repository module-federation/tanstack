---
title: Releasing
summary: Release and trusted npm publishing for @module-federation/tanstack.
read_when:
  - Preparing a release
  - Updating release automation
updated_at: 2026-10-06
---

# Releasing

Add a Changeset to every user-visible package change:

```bash
pnpm changeset
```

Run the complete local gate before merging:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm pack:tanstack
```

The `Release Pull Request` workflow versions the package and updates its
changelog. After merging that PR, publish from `main` with a GitHub Release
whose tag exactly matches `packages/tanstack/package.json` (without a `v`), or
dispatch `Release` with `version=latest`. Preview dispatches use `version=next`
and publish to npm's `next` dist-tag.

GitHub prerelease tags must match the prerelease version already committed in
`packages/tanstack/package.json`. The workflow publishes that exact version to
the `next` dist-tag.

The publish workflow reruns the gate, checks that the source is reachable from
`main`, uses npm provenance, and refuses to republish an existing version under
a different dist-tag. Configure npm trusted publishing for repository
`module-federation/tanstack`, workflow `release.yml`, environment `Publish`.

The release gate builds the Vite and Rsbuild example pairs and checks their
manifests and server bundles. It then starts all four apps and drives both hosts
in headless Chromium: Vite-to-Vite SSR markup, hydration, remote interactivity,
one shared React instance, no console errors, and the fallback when a remote is
offline. Package tests cover the opt-in Rsbuild async-node CommonJS SSR
configuration.

The test suite needs Chromium. Locally, run `pnpm exec playwright install
chromium` once; the workflows install it before `pnpm test`.
