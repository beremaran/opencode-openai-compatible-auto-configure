# Releasing

Releases are tag-triggered from CI. There is no local build step; pushing a
`vX.Y.Z` tag runs `.github/workflows/release.yml`, which verifies the tag, runs
checks, inspects the packed files, smoke-tests the OpenCode 2 root entrypoint
from a clean consumer install, and creates the GitHub Release.

## Steps

1. **Bump the version** in `package.json` (keep `0.x` semver; update
   `package-lock.json` with `npm install` or `npm version`).

2. **Add a CHANGELOG entry.** Create a new `## [X.Y.Z] - YYYY-MM-DD` heading at
   the top of `CHANGELOG.md` above `## [Unreleased]` (or move the Unreleased
   content into it). Group changes under `### Added`, `### Fixed`, and
   `### Changed`. For breaking 0.x changes, use `### Changed (Breaking)`.

3. **Commit and push the version change:**

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

5. **Watch the release workflow.** It verifies that the tag matches
   `package.json`, that `CHANGELOG.md` contains the version, runs
   `npm run check`, inspects the packed files, smoke-tests the plugin
   entrypoint, and creates a GitHub Release whose body is the matching
   CHANGELOG section.

## Validation

The workflow uses `npm pack --dry-run --json` to verify the file list and then
smoke-tests the packed entrypoint. This validates the GitHub-installed package;
the documented user installation path remains the direct GitHub plugin spec in
`README.md`.

## Notes

- The tag must be exactly `v` plus the `package.json` version (for example,
  version `0.1.0` uses tag `v0.1.0`).
- `Unreleased` entries are never tagged; move their content into the dated
  release section before tagging.
