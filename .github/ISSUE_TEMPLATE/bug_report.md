---
name: Bug report
about: Report a problem with the opencode-openai-compatible-auto-configure plugin
title: ""
labels: bug
assignees: ""
---

**Describe the bug**
A clear and concise description of what is broken and what you expected.

**Environment**
- opencode version: (e.g. `opencode --version`)
- Plugin version: (e.g. `@beremaran/opencode-openai-compatible-auto-configure@0.1.0`, or local path commit)
- Node/Bun runtime if relevant:

**Config**
Paste the relevant part of your `opencode.json` (plugin entry and options; redact secrets):

```json
{
  "plugin": [
    [
      "@beremaran/opencode-openai-compatible-auto-configure",
      { "providers": [{ "id": "local", "baseURL": "http://localhost:1234/v1" }] }
    ]
  ]
}
```

**Logs**
Paste the relevant startup/run logs, especially any `opencode-openai-compatible-auto-configure`
lines (e.g. from `opencode run --print-logs`).

**To reproduce**
Steps to reproduce the behavior.

**Expected behavior**
What you expected to happen.

**Additional context**
Anything else that might help (OS, TUI vs CLI vs web, endpoint type, `/models`
response shape, etc.).
