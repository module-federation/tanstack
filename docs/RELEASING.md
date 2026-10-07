---
title: Releasing
summary: Release and trusted npm publishing for @module-federation/tanstack.
read_when:
  - Preparing a release
  - Updating release automation
updated_at: 2026-10-07
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
a different dist-tag. It publishes through npm trusted publishing for
repository `module-federation/tanstack`, workflow `release.yml`, environment
`Publish`, so the repository needs a `Publish` environment.

## First publish

npm only lets a package that already exists name a trusted publisher, so the
workflow cannot publish `@module-federation/tanstack` the first time. Bootstrap
it once, as a maintainer with publish rights in the `@module-federation` npm
organization:

1. Publish a placeholder from an empty directory: a `package.json` with
   `"name": "@module-federation/tanstack"` and `"version": "0.0.0"`, then
   `npm publish --access public`.
2. Add the trusted publisher on npmjs.com (package settings, "Trusted
   Publisher", GitHub Actions) or with npm 11.10+:
   `npm trust github @module-federation/tanstack --file release.yml --repo module-federation/tanstack --env Publish --allow-publish`.
3. Release `0.1.0` through the workflow within two days: npm discards a trusted
   publisher configuration that has not published by then.
4. Deprecate the placeholder:
   `npm deprecate @module-federation/tanstack@0.0.0 "Placeholder; use 0.1.0 or later."`

Trusted publishing needs npm 11.5.1+ on Node 22.14+; the workflow's Node 24
includes it. Releases after `0.1.0` need no manual step.

The release gate builds the six example apps and checks their manifests and
server bundles. It then runs the apps twice, as development servers and as
production builds, and drives every host in headless Chromium: server-rendered
remote markup for every Vite and Rsbuild host and remote pair (including
concurrent first requests), remote stylesheets in the server response,
hydration, remote interactivity, one shared React instance and context, no
console errors, reachable manifest assets, the fallback and recovery when
remotes go offline, and hosts that start during an outage rendering the remotes
once they return.

The test suite needs Chromium. Locally, run `pnpm exec playwright install
chromium` once; the workflows install it before `pnpm test`.
