# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-08-22

### Added

- OpenCode 2 plugin entrypoint with catalog transforms for discovered
  OpenAI-compatible providers and models, including V2 default-model support.
- Dual package entrypoints: the package root serves OpenCode 2, while
  `./server` and `main` preserve the OpenCode 1 factory.
- CI and release smoke tests for both OpenCode plugin contracts, plus npm
  trusted-publishing support in the tag-triggered workflow.

### Fixed

- Static model `limit` overrides now flow into the generated model entries.

### Changed (Breaking)

- OpenCode 2 uses the `plugins` object configuration and the package root;
  OpenCode 1 users should use the `plugin` configuration with the `./server`
  entrypoint when their loader does not fall back to `main`.

## [0.1.0] - 2026-08-06

### Added

- Plugin factory (`AutoProvidersPlugin`) that registers an opencode provider per
  configured OpenAI-compatible endpoint by fetching `GET {baseURL}/models` at
  startup and injecting the discovered models into `cfg.provider`.
- `providers` option: register one or more endpoints inline, each with `id`,
  `name`, `baseURL`, `apiKey`, `headers`, `npm`, `modelsURL`, `fetchModels`,
  `include`, `exclude`, `defaultLimit`, `overrides`, and `staticModels`.
- Tolerant `/models` parsing that accepts `{ data: [...] }`, `{ models: [...] }`,
  and bare object maps; items without a string `id` are skipped and listings are
  capped at 500 models.
- Automatic context/output limit detection from common vendor keys
  (`context_length`, `max_context_length`, `context_window`, `n_ctx`,
  `input_token_limit`, `max_input_tokens`, `max_output_tokens`, `max_tokens`,
  and more) plus a nested `limit` object, with a `defaultLimit` fallback.
- `include`/`exclude` model filtering with `*` glob patterns.
- Per-model overrides (`overrides`) and static model entries (`staticModels`)
  that merge on top of discovery.
- `/add-provider` slash command that upserts a provider into the JSON store
  (`<id> <baseURL> [apiKey] [--name ...] [--context N] [--output N]
  [--no-fetch]`).
- `/providers` slash command that lists configured providers with live model
  counts.
- JSON store file (`~/.config/opencode/openai-compatible-providers.json`) with
  atomic writes, tolerant reads, and a `version: 1` schema; store providers
  override option providers with the same id.
- `configFile`, `model`, `smallModel`, `fetchTimeoutMs`, and `env` plugin
  options; `{env:VAR}` / `${VAR}` token interpolation in `baseURL`, `apiKey`,
  and header values.
- Env-safe defaults on every discovered model entry: `temperature: true` and
  `tool_call: true`.
- Merge rule for pre-existing provider config: the user's `name`, `npm`, and
  `options` are kept when set, and discovered models override a user-written
  `models` map key-by-key.
- Structured logging through opencode's `app.log` endpoint (service name
  `opencode-openai-compatible-auto-configure`); logging can never throw.
- Release engineering: CI workflow (node 22/24, Bun smoke test, peer-drift),
  tag-triggered publish workflow, keep-a-changelog `CHANGELOG.md`, and docs.
