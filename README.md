# @beremaran/opencode-openai-compatible-auto-configure

[![CI](https://github.com/beremaran/opencode-openai-compatible-auto-configure/actions/workflows/ci.yml/badge.svg)](https://github.com/beremaran/opencode-openai-compatible-auto-configure/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/beremaran/opencode-openai-compatible-auto-configure)](LICENSE)

An [OpenCode 2](https://opencode.ai) plugin that registers multiple
OpenAI-compatible API endpoints and **auto-discovers their models**. At startup
it fetches each endpoint's `GET {baseURL}/models`, turns the response into
provider models, and injects them into the host catalog — so you never
hand-write a model list again.

- Register any number of providers (baseURL + optional apiKey + headers) in plugin options or the provider store.
- Models are discovered automatically from each endpoint's `/models` response; `include`/`exclude` globs keep the list manageable.
- A per-user JSON store file (`~/.config/opencode/openai-compatible-providers.json`) is read at startup; OpenCode 2 also exposes model-assisted `/add-provider` and `/providers` commands.
- No build step: OpenCode loads the package's raw TypeScript entrypoint through its plugin runtime.

## Why

OpenAI-compatible servers (LM Studio, llama.cpp, vLLM, Ollama's OpenAI proxy, Mistral, Groq, OpenRouter, …) change their model lineups constantly. Hand-writing a `models` block means chasing ids, context windows, and token limits every time a server updates. This plugin discovers the models for you at startup — including per-model context/output limits where the server advertises them — and lets you trim the list with globs instead of maintaining it by hand.

## Install

OpenCode can install the plugin directly from GitHub:

```bash
opencode plugin add github:beremaran/opencode-openai-compatible-auto-configure
```

For a project-local configuration with provider options, add it to
`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:beremaran/opencode-openai-compatible-auto-configure",
      "options": {
        "providers": [
          { "id": "local", "baseURL": "http://localhost:1234/v1" }
        ]
      }
    }
  ]
}
```

For a local checkout, replace the GitHub spec with the absolute repository
path. OpenCode loads the root `index.ts` V2 entrypoint:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "/abs/path/to/opencode-openai-compatible-auto-configure",
    "options": {
      "providers": [{ "id": "local", "baseURL": "http://localhost:1234/v1" }]
    }
  }]
}
```

This repository is an OpenCode plugin, not a Pi package; it has no Pi manifest,
extension, or theme entrypoint.

> **Runtime:** this package ships **raw TypeScript** with no build step. It runs
> under OpenCode's plugin runtime. It is **not** importable from plain Node.js;
> the documented root entrypoint targets OpenCode 2.0+, while Node `>=22.6` in
> `engines` is for the repository's tooling and tests only.

> Config is read at startup. **Restart OpenCode** after adding the plugin or
> adding a provider.

## Quick start

Point the plugin at a local OpenAI-compatible server, e.g. LM Studio on its default port:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "github:beremaran/opencode-openai-compatible-auto-configure",
    "options": {
      "providers": [
        { "id": "local", "baseURL": "http://localhost:1234/v1" }
      ]
    }
  }]
}
```

Restart OpenCode. At startup the plugin fetches `http://localhost:1234/v1/models`, discovers every model the server advertises, and registers them under the `local` provider. Check them with:

```bash
opencode models
```

You should see one entry per discovered model. Use them by id:

```
local/llama-3.1-8b-instruct
```

or set a default model:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "local/llama-3.1-8b-instruct",
  "plugins": [{
    "package": "github:beremaran/opencode-openai-compatible-auto-configure",
    "options": {
      "providers": [{ "id": "local", "baseURL": "http://localhost:1234/v1" }]
    }
  }]
}
```

## Configuration

There are two ways to define providers, and both feed the same merge step:

1. **In-plugin options** — the `providers` array in the OpenCode 2 plugin entry.
2. **The store file** — `~/.config/opencode/openai-compatible-providers.json`, editable by hand.

Store entries **override** option entries with the same `id` (the store wins on collision). Everything else — `model`, `smallModel`, `fetchTimeoutMs`, `env` — is a plugin-level option.

### Option 1: in-plugin options

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
      "package": "github:beremaran/opencode-openai-compatible-auto-configure",
      "options": {
        "model": "local/llama-3.1-8b-instruct",
        "smallModel": "local/llama-3.1-8b-instruct",
        "fetchTimeoutMs": 10000,
        "env": true,
        "providers": [
          {
            "id": "local",
            "name": "LM Studio",
            "baseURL": "http://localhost:1234/v1",
            "apiKey": "{env:LOCAL_API_KEY}",
            "headers": { "X-Tenant": "acme" },
            "modelsURL": "http://localhost:1234/v1/models",
            "fetchModels": true,
            "include": ["llama-*", "qwen-*"],
            "exclude": ["*-4bit"],
            "defaultLimit": { "context": 8192, "output": 4096 },
            "overrides": {
              "llama-3.1-8b-instruct": { "reasoning": false, "temperature": true }
            },
            "staticModels": {
              "my-hand-written-model": { "limit": { "context": 16384, "output": 4096 } }
            }
          }
        ]
      }
  }]
}
```

### Option 2: the store file

The same shape as one entry of `providers`, persisted at
`~/.config/opencode/openai-compatible-providers.json` (or
`$XDG_CONFIG_HOME/opencode/openai-compatible-providers.json` when
`XDG_CONFIG_HOME` is set):

```json
{
  "version": 1,
  "providers": [
    {
      "id": "local",
      "name": "LM Studio",
      "baseURL": "http://localhost:1234/v1",
      "apiKey": "{env:LOCAL_API_KEY}",
      "headers": { "X-Tenant": "acme" },
      "include": ["llama-*"],
      "exclude": ["*-4bit"],
      "defaultLimit": { "context": 8192, "output": 4096 },
      "staticModels": {
        "my-hand-written-model": { "limit": { "context": 16384, "output": 4096 } }
      }
    }
  ]
}
```

Set `configFile` in the plugin options to point at a different file. Malformed
entries, unparseable JSON, or a wrong top-level shape are tolerated: the plugin
logs a warning and skips them rather than crashing.

### Option reference

#### Plugin-level options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `providers` | `ProviderSource[]` | `[]` | Inline provider sources. A store entry with the same `id` overrides the inline one. |
| `configFile` | `string` | `~/.config/opencode/openai-compatible-providers.json` | Path to the JSON store file. |
| `model` | `string` | — | `providerID/modelID` to set as OpenCode's default model. |
| `smallModel` | `string` | — | Not used by OpenCode 2; the plugin logs a warning and ignores it. |
| `fetchTimeoutMs` | `number` | `10000` | Timeout in ms for each `/models` fetch at startup. |
| `env` | `boolean` | `true` | Interpolate `{env:VAR}` and `${VAR}` tokens in `baseURL`, `apiKey`, and header values. When `false`, tokens are left untouched. |

#### `providers[]` (a `ProviderSource`)

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `id` | `string` | **required** | Provider id used in OpenCode; models are referenced as `providerID/modelID`. The id must match `^[A-Za-z0-9._-]+$`. |
| `name` | `string` | — | Display name shown in the model picker. |
| `baseURL` | `string` | **required** | Base URL of the OpenAI-compatible API. |
| `apiKey` | `string` | — | Sent as `Authorization: Bearer <apiKey>`. Supports `{env:VAR}` / `${VAR}`. A configured apiKey wins over any `Authorization` header you set in `headers`. |
| `headers` | `Record<string, string>` | — | Extra headers sent with every request to this endpoint. Values support `{env:VAR}` / `${VAR}`. |
| `npm` | `string` | `"@ai-sdk/openai-compatible"` | Provider package identifier. OpenCode 2 maps the default to `@opencode-ai/ai/providers/openai-compatible`; custom package names are passed through. |
| `modelsURL` | `string` | `{baseURL}/models` | Override the model listing URL. |
| `fetchModels` | `boolean` | `true` | Fetch models from `{baseURL}/models` at startup. When `false`, only `staticModels` are used. |
| `include` | `string[]` | — | Exact model ids or `*` glob patterns to keep. An empty/absent list keeps everything. |
| `exclude` | `string[]` | — | Exact model ids or `*` glob patterns to drop. Applied after `include`. |
| `defaultLimit` | `{ context?, output? }` | — | Fallback context/output token limits for models that do not advertise limits in the `/models` response. |
| `overrides` | `Record<string, ModelOverride>` | — | Per-model overrides keyed by model id, applied on top of discovery. Only ids that survive the filters can be overridden. |
| `staticModels` | `Record<string, ModelOverride>` | — | Static model entries keyed by model id. Used verbatim when `fetchModels` is `false` or discovery fails, and merged in for ids the server did not list. |

#### `ModelOverride` (per-model entry fields)

Used by `overrides` and `staticModels`. Only the fields OpenCode's model-entry
schema allows are emitted.

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `id` | `string` | model id | Emitted model id when it differs from the map key. |
| `name` | `string` | model id | Display name. An empty string removes the name (falls back to the id). |
| `limit` | `{ context?, input?, output? }` | discovered/`defaultLimit` | Replaces the computed limit. Emitted only when both `context` and `output` resolve. |
| `temperature` | `boolean` | `true` | Whether the model supports temperature. |
| `tool_call` | `boolean` | `true` | Whether the model supports tool calls. |
| `reasoning` | `boolean` | — | Whether the model supports reasoning mode. |
| `attachment` | `boolean` | — | Whether the model supports attachments. |
| `options` | `Record<string, unknown>` | — | Provider options for this model; deep-merged into any discovered options. |
| `headers` | `Record<string, string>` | — | Per-model request headers; deep-merged into any discovered headers. |

## Commands

The OpenCode 2 entrypoint registers two model-assisted commands:

- **`/add-provider`** explains how to add a provider to the `plugins` options or
  provider store.
- **`/providers`** explains how to inspect the configured providers and models.

These OpenCode 2 commands do not write configuration themselves. Edit the
`plugins` options or store file, then restart OpenCode when the change must be
applied deterministically.

## How it works

1. **Startup** — the plugin reads the store file, merges it with the `providers` option (store wins on id collision), interpolates `{env:VAR}` / `${VAR}` tokens, and resolves defaults (`npm`, `fetchTimeoutMs`, `fetchModels`).
2. **Host adapter** — OpenCode 2 registers provider, model, and command transforms.
3. **Parallel discovery** — every provider's model list is fetched with `GET {baseURL}/models` (or `modelsURL`) in parallel via `Promise.allSettled`. One failing fetch never blocks the others; a per-fetch timeout (`fetchTimeoutMs`, default 10s) aborts stragglers.
4. **Tolerant parsing** — each response is parsed leniently (see [Model discovery details](#model-discovery-details)); anything unrecognized yields an error log and skips only that provider.
5. **Capability defaults** — every discovered model entry is emitted with `temperature: true` and `tool_call: true` unless a `staticModels`/`overrides` entry says otherwise.
6. **Limit detection** — context/output token limits are read from known vendor keys in each model item (plus a nested `limit` object), falling back to the provider's `defaultLimit`. A `limit` is emitted only when both `context` and `output` resolve.
7. **Model registration** — the resulting models are registered through OpenCode 2's provider/model transforms.
8. **Provider registration** — the default provider package maps to `@opencode-ai/ai/providers/openai-compatible`; provider settings contain `baseURL` and `apiKey`.
9. **Defaults** — `model` sets the default model. `smallModel` is ignored because OpenCode 2 has no equivalent field.

**Merge rule with a pre-existing provider config.** If a provider with the same
id already exists in your `opencode.json` (or another plugin added one), the
plugin keeps the user's `name`, `npm`, and `options` when they are set (options
are merged per-key on top of `baseURL`/`apiKey`/`headers`). The user's
hand-written `models` map is used as the base, and the discovered/static models
override it **key-by-key** — so a model the server lists always reflects
discovery, while a hand-written model the server did not list is preserved.

Any error that escapes the config hook is logged at `error` level and swallowed —
the plugin can never crash OpenCode through the config hook.

## Model discovery details

- **Response shapes accepted** (from `GET {baseURL}/models`):
  - `{ "data": [ { "id": "...", ... }, ... ] }` (the OpenAI shape)
  - `{ "models": [ { "id": "...", ... }, ... ] }`
  - a bare object map of `id` → entry
- Items without a string `id` are skipped. Non-JSON bodies and unrecognized shapes log a warning and count as a failed fetch for that provider.
- **500-model cap**: endpoints advertising more than 500 models are truncated to the first 500 (a warning names the provider).
- **`include` / `exclude`**: exact ids or `*` glob patterns (single wildcard, any run of characters). `include` keeps only matching ids; `exclude` drops matching ids afterwards.
- **Limit detection**: the plugin scans each model item for known vendor keys, in precedence order:
  - context: `context_length`, `max_context_length`, `max_context`, `context_window`, `contextWindow`, `ctx_len`, `n_ctx`, `context_size`, `input_token_limit`, `max_input_tokens`, `max_input`, plus a nested `limit.context`
  - output: `max_output_tokens`, `output_token_limit`, `max_tokens`, `max_output`, plus a nested `limit.output`
  - If neither is advertised, the provider's `defaultLimit` fills in the missing side; both sides are required for the model entry to carry a `limit`.
- **`apiKey`** is sent as `Authorization: Bearer <apiKey>`, which overrides any user-supplied `Authorization` header. The request also always sends `Accept: application/json`.

## Security

- **`apiKey` is stored in plaintext** in the store file and/or `opencode.json`.
  Prefer `{env:VAR}` / `${VAR}` references so the secret itself never sits in a
  file on disk (see the `env` option).
- **The plugin only reads `GET {baseURL}/models`** (or `modelsURL`) at startup
  and from `/providers`. It makes no other outbound calls and sends no data to
  these endpoints — it never uploads prompts, messages, or transcript content.
- **Keys are never logged.** Log lines carry provider ids, model counts, and
  base URLs only; apiKey and header values are never included.
- Config is trusted input: the plugin fetches whatever `baseURL` you configure.
  Only point it at endpoints you control.

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## Limitations

- **Provider discovery is load-time only.** Providers and models are fetched
  during plugin setup. Store edits require a **restart of OpenCode** before the
  provider catalog changes.
- **Providers with zero discoverable models are skipped.** If the fetch fails
  *and* no `staticModels` are configured, the provider is not registered (an
  error log names it).
- Supported OpenCode range: `>=2 <3` (per `engines`). The package exposes only
  the OpenCode 2 root entrypoint.

## Troubleshooting

- **Provider not showing in `opencode models`** — OpenCode reads the merged
  config at startup, so any change requires a restart. Check the startup logs
  (below) for `Configured provider "<id>" with N models` or an error line
  `Skipping provider "<id>": no models could be determined`.
- **Fetch failures** — OpenCode can print logs with `opencode --print-logs run`,
  or open the TUI logs. Look for the plugin's log lines (service name
  `opencode-openai-compatible-auto-configure`): `Failed to fetch models from
  "<url>"`, `returned HTTP <status>`, or `Could not parse model list`. The
  timeout is `fetchTimeoutMs` (default 10s).
- **A whole model family is missing** — check your `include`/`exclude` globs.
  `include` acts as a keep-list; an id matching no pattern is dropped.
- **Port/URL mistakes** — `baseURL` must be reachable from where OpenCode runs
  and must serve the OpenAI-compatible API. A common miss is pointing at a web
  UI origin instead of the `/v1` API origin (e.g. LM Studio listens on
  `http://localhost:1234/v1`). A non-`http(s)://` baseURL is rejected by
  `/add-provider`.

## Local development

```bash
npm ci
npm run check     # typecheck + tests
npm test          # node:test, node --experimental-strip-types
npm run test:e2e   # optional; needs an OpenCode binary
```

To load the checkout directly, point `opencode.json` at it:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{"package": "/abs/path/to/opencode-openai-compatible-auto-configure"}]
}
```

OpenCode loads the package root's V2 `index.ts`; there is no build step because
the raw `.ts` source is the shipped artifact. `test:e2e` uses
`$OPENCODE_BIN` when set, otherwise `$HOME/.opencode/bin/opencode`.

## Releases

GitHub is the supported installation source. Releases are maintained as Git
tags and GitHub Releases. See [RELEASING.md](RELEASING.md) for maintainer steps.

## License

MIT — see [LICENSE](LICENSE).
