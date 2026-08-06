# Security Policy

## Supported versions

Only the latest published version of
`@beremaran/opencode-openai-compatible-auto-configure` is supported with
security updates. Older releases are not patched; if you are on an earlier
release, upgrade to the latest version and confirm the issue is resolved before
reporting it.

## Reporting a vulnerability

Please report security vulnerabilities by emailing
[berke@beremaran.com](mailto:berke@beremaran.com) rather than opening a public
issue.

Include in your report:

- The plugin version (from `package.json`) and the opencode version you are
  running.
- A description of the vulnerability and, if possible, a minimal reproduction.
- Any impact assessment you can provide.

You can expect an acknowledgement within a few business days and a fix or
mitigation plan as soon as one can be produced. Please do not disclose the
issue publicly until it has been addressed.

## Known security considerations

- **`apiKey` is stored in plaintext** in the store file
  (`~/.config/opencode/openai-compatible-providers.json`) and/or `opencode.json`.
  Prefer `{env:VAR}` / `${VAR}` references so the secret never sits in a file.
- **Config is trusted input.** The plugin fetches whatever `baseURL` you
  configure — only point it at endpoints you control.
- **The plugin only reads `GET {baseURL}/models`** (or `modelsURL`) at startup
  and from `/providers`. It makes no other outbound calls and sends no prompts,
  messages, or transcript data to those endpoints.
- **Keys are never logged.** Log lines carry provider ids, model counts, and
  base URLs only.

The README's Security section describes these same considerations in prose.
