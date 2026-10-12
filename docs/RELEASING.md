---
title: Releasing
summary: Release and trusted npm publishing for @module-federation/tanstack.
read_when:
  - Preparing a release
  - Updating release automation
updated_at: 2026-10-12
---

# Releasing

Releases are cut by [release-please](https://github.com/googleapis/release-please)
from Conventional Commits on `main`. PRs are squash-merged with the PR title as
the commit message, and `Validate PR title` enforces the format, so the PR title
decides the release:

- `fix:` (and `perf:`) releases a patch.
- `feat:` releases a minor.
- `feat!:` or a `BREAKING CHANGE:` footer releases a minor while the package is
  below 1.0 (`bump-minor-pre-major`), then a major.
- `chore:`, `docs:`, `test:`, `ci:`, `refactor:`, and `build:` release nothing
  and stay out of the changelog.

Run the complete local gate before merging:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm pack:tanstack
```

On every push to `main`, the `Release Please` workflow opens or updates a
`chore: release <version>` PR that bumps `packages/tanstack/package.json`,
`.release-please-manifest.json`, and `packages/tanstack/CHANGELOG.md`. Edit the
PR's changelog entry before merging if the commit titles need context. To force
a version, add a `Release-As: x.y.z` footer to a commit on `main`.

Merging the release PR makes release-please tag the merge commit and publish a
GitHub Release named after the version, without a `v` (`0.1.1`, not `v0.1.1`).
That release triggers `Release`, which publishes to npm under `latest`.
release-please authenticates with `REPO_SCOPED_TOKEN`, a token with contents and
pull-request write access: releases created with the default `GITHUB_TOKEN`
would not trigger the publish workflow.

Preview dispatches of `Release` with `version=next` publish the next patch
version with a `-next.<run id>` suffix to npm's `next` dist-tag. Dispatching with
`version=latest` republishes the committed version and is only needed when a
release-triggered publish failed.

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
