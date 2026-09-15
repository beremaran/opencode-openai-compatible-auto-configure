# Contributing

Thanks for contributing to @beremaran/opencode-openai-compatible-auto-configure!

## Getting started

1. Fork the repository and clone your fork.
2. `npm ci`
3. `npm run check` (typecheck + tests)

The package has no runtime dependencies or build step. OpenCode 2 loads the
package-root TypeScript plugin with its runtime.

## Manual testing

Load the checkout in `opencode.json` with the OpenCode 2 `plugins` entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "/abs/path/to/repo",
    "options": {
      "providers": [{ "id": "local", "baseURL": "http://localhost:1234/v1" }]
    }
  }]
}
```

Run `opencode` from the repo root, then check:

1. The startup log reports `Configured provider "local" with N models`
   (run `opencode --print-logs run` or check the TUI logs).
2. `opencode models` lists the auto-discovered models.
3. OpenCode 2 exposes `/add-provider` and `/providers` as model-assisted
   helpers. Restart OpenCode after store/config changes.

The optional `bash test/e2e.sh` script exercises the flow end to end.

## Writing tests

- Tests live in `test/index.test.ts` (and any helpers the test suite adds). They
  use `node:test` and run via `npm test`, which invokes
  `node --experimental-strip-types --test "test/**/*.test.ts"`.
- Prefer asserting behavior over log text. When you do assert logs, filter by
  message content — never by positional index — so a new log line added earlier
  does not silently break the suite.
- Add a test for any behavior you change, and run `npm run check` (typecheck +
  tests) before pushing; CI enforces it.

## Pull requests

- Keep changes minimal and scoped.
- Run `npm run check` before pushing; CI enforces it.
- If you change an option, a command's shape, or a default, update the option
  reference table in `README.md` and add a `CHANGELOG.md` entry under
  `## [Unreleased]`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) style
  (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, …); releases use
  `chore: release vX.Y.Z` (see [RELEASING.md](RELEASING.md)).
- Update `package.json` `version` only when asked to prepare a release.

## Releases

Releases are tag-triggered from CI — see [RELEASING.md](RELEASING.md) for the
full flow (bump version, add a CHANGELOG entry, tag `vX.Y.Z`, push the tag).
