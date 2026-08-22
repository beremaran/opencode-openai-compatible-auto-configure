# Releasing

Releases are **tag-triggered from CI**. There is no local build or publish step —
pushing a `vX.Y.Z` tag runs `.github/workflows/publish.yml`, which verifies the
tag, runs checks, inspects the packed tarball, smoke-tests both the OpenCode 2
root entrypoint and the OpenCode 1 `./server` entrypoint from a clean consumer
install, publishes to npm (when trusted publishing or the `NPM_TOKEN` secret is
configured), and creates the GitHub Release.

## Steps

1. **Bump the version** in `package.json` (keep `0.x` semver; the version in
   `package-lock.json` is updated by `npm install` or `npm version`).

2. **Add a CHANGELOG entry.** Create a new `## [X.Y.Z] - YYYY-MM-DD` heading at
   the top of `CHANGELOG.md` (above `## [Unreleased]`, or move the Unreleased
   content into it). Group changes under `### Added`, `### Fixed`, and
   `### Changed`. For **breaking** changes in 0.x — anything that changes
   default behavior for existing users — use `### Changed (Breaking)`.

3. **Commit** the changes on `main`:

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore: release vX.Y.Z"
   git push origin main
   ```

4. **Tag and push the tag:**

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

5. **Watch the publish workflow.** It verifies the tag matches `package.json`
   and that `CHANGELOG.md` contains the version, runs `npm run check`,
   inspects the packed tarball, smoke-tests both plugin entrypoints from a
   clean consumer install, publishes to npm with provenance when trusted
   publishing or `NPM_TOKEN` is configured, and creates a GitHub Release whose
   body is the CHANGELOG section for the version. Before npm authentication is
   configured, an E401/E403/E404 publish response is skipped with a notice.

## GitHub Release tarball (no-npm installs)

The release tarball is what the "install from a GitHub Release tarball"
instructions in the README point at. It is produced with `npm pack` and attached
to the GitHub Release:

```bash
npm pack                 # produces beremaran-opencode-openai-compatible-auto-configure-<version>.tgz
gh release create vX.Y.Z ./beremaran-opencode-openai-compatible-auto-configure-*.tgz \
  --title "vX.Y.Z" \
  --notes "See CHANGELOG.md for vX.Y.Z"
```

The publish workflow attaches this tarball automatically; the manual `npm pack` +
`gh release create` flow is for publishing the first release before CI secrets
are configured.

## Enabling npm publishing

The workflow attempts `npm publish --provenance` on every release. An
authentication rejection is treated as a graceful skip so the GitHub Release
can still be created. To enable npm publishing, either:

- Add an **`NPM_TOKEN`** repository secret containing an npm automation token
  (npm → *Access Tokens* → *Generate New Token* → *Automation*), or
- Configure **trusted publishing** for the repo on npm. The workflow already
  grants the required `id-token: write` permission and uses the `npm-publish`
  environment.

Until then, tag pushes still produce the GitHub Release (with tarball) and all
checks still run — only the npm publish step is skipped after its auth error.

## Notes

- The tag must be exactly `v` + the `package.json` version (e.g. version
  `0.1.0` → tag `v0.1.0`); the workflow fails otherwise.
- A local `npm publish` is not the supported flow and will not produce npm
  provenance. `prepublishOnly` runs `npm run check` if you ever do, but prefer
  the tag flow.
- "Unreleased" entries are never tagged; move their content into the dated
  release section before tagging.
