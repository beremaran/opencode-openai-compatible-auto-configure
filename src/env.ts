const ENV_PATTERN = /\{env:([A-Za-z0-9_]+)\}|\$\{([A-Za-z0-9_]+)\}/g;

/**
 * Replaces `{env:VAR}` and `${VAR}` tokens with the value of
 * `process.env[VAR]`. Tokens for unset variables (and all tokens when
 * `enabled` is false) are left untouched.
 */
export function interpolate(value: string, enabled: boolean): string {
  if (!enabled || !value.includes("{") && !value.includes("$")) return value;
  return value.replace(ENV_PATTERN, (match, braceName, dollarName) => {
    const name = (braceName ?? dollarName) as string;
    const resolved = process.env[name];
    if (resolved !== undefined) return resolved;
    if (braceName !== undefined) return match;
    return `\${${dollarName}}`;
  });
}

/**
 * Applies `interpolate` to every header value. Returns `undefined` when the
 * input is `undefined` or empty after interpolation.
 */
export function interpolateHeaders(
  headers: Record<string, string> | undefined,
  enabled: boolean,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const resolved = interpolate(value, enabled);
    if (resolved.length > 0) out[key] = resolved;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
