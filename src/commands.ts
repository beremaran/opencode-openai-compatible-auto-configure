import { fetchModels } from "./models.ts";
import { loadStore, saveStore } from "./store.ts";
import type { Logger, ProviderSource, ResolvedProvider } from "./types.ts";

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const USAGE =
  'Usage: /add-provider <id> <baseURL> [apiKey] [--name "Display Name"] [--context N] [--output N] [--no-fetch]';

type ParseResult = { ok: true; source: ProviderSource } | { ok: false; error: string };

/** Splits a command line into tokens, honoring double-quoted segments. */
function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const quoted = match[1];
    tokens.push(quoted !== undefined ? quoted.replace(/\\(.)/g, "$1") : (match[2] as string));
  }
  return tokens;
}

/**
 * Parses `/add-provider` arguments. Positional: `<id> <baseURL> [apiKey]`;
 * then flags `--name`, `--context N`, `--output N`, `--no-fetch`.
 */
export function parseAddProviderArgs(raw: string): ParseResult {
  const tokens = tokenize(raw.trim());
  if (tokens.length < 2) {
    return { ok: false, error: `Missing id or baseURL.\n${USAGE}` };
  }

  const id = tokens[0] as string;
  if (!ID_PATTERN.test(id)) {
    return {
      ok: false,
      error: `Provider id must match ${ID_PATTERN} (got "${id}").`,
    };
  }

  const baseURL = tokens[1] as string;
  if (!/^https?:\/\//.test(baseURL)) {
    return { ok: false, error: `baseURL must start with http:// or https:// (got "${baseURL}").` };
  }

  const source: ProviderSource = { id, baseURL };
  let index = 2;
  if (index < tokens.length && !(tokens[index] as string).startsWith("--")) {
    source.apiKey = tokens[index] as string;
    index += 1;
  }

  const defaultLimit: { context?: number; output?: number } = {};
  for (; index < tokens.length; index += 1) {
    const flag = tokens[index] as string;
    switch (flag) {
      case "--name": {
        const value = tokens[index + 1];
        if (value === undefined) return { ok: false, error: `--name requires a value.\n${USAGE}` };
        source.name = value;
        index += 1;
        break;
      }
      case "--context": {
        const value = Number(tokens[index + 1]);
        if (!Number.isSafeInteger(value) || value <= 0) {
          return { ok: false, error: "--context must be a positive integer." };
        }
        defaultLimit.context = value;
        index += 1;
        break;
      }
      case "--output": {
        const value = Number(tokens[index + 1]);
        if (!Number.isSafeInteger(value) || value <= 0) {
          return { ok: false, error: "--output must be a positive integer." };
        }
        defaultLimit.output = value;
        index += 1;
        break;
      }
      case "--no-fetch":
        source.fetchModels = false;
        break;
      default:
        return { ok: false, error: `Unknown option: ${flag}\n${USAGE}` };
    }
  }

  if (Object.keys(defaultLimit).length > 0) source.defaultLimit = defaultLimit;
  return { ok: true, source };
}

/** Implements the `/add-provider` slash command: upsert into the store. */
export function addProviderCommand(args: string, storePath: string, logger: Logger): string {
  const parsed = parseAddProviderArgs(args);
  if (!parsed.ok) {
    return `⚠️ ${parsed.error}`;
  }

  const { providers } = loadStore(storePath, logger);
  const next = providers.filter((entry) => entry.id !== parsed.source.id);
  next.push(parsed.source);

  saveStore(storePath, { version: 1, providers: next }, logger);

  const details = parsed.source.fetchModels === false ? " (static models only)" : "";
  return [
    `Added provider "${parsed.source.id}"${details}: ${parsed.source.baseURL}`,
    `Store: ${storePath}`,
    "Restart opencode for changes to take effect.",
  ].join("\n");
}

/**
 * Implements the `/providers` slash command: lists configured providers with a
 * live model count (short timeout) when fetch-on is enabled.
 */
export async function providersCommand(storePath: string, logger: Logger): Promise<string> {
  const { providers } = loadStore(storePath, logger);
  if (providers.length === 0) {
    return "No OpenAI-compatible providers configured yet. Use /add-provider to add one.";
  }

  const rows = await Promise.all(
    providers.map(async (provider, index) => {
      const name = provider.name ? ` (${provider.name})` : "";
      const head = `${index + 1}. ${provider.id}${name} — ${provider.baseURL}`;
      if (provider.fetchModels === false) {
        const count = Object.keys(provider.staticModels ?? {}).length;
        return `${head} — fetch: off — models: ${count} (static)`;
      }
      const resolved = {
        ...provider,
        fetchModels: true,
        timeoutMs: 3_000,
      } as ResolvedProvider;
      const models = await fetchModels(resolved, logger);
      const count = models === null ? "error" : String(models.length);
      return `${head} — fetch: on — models: ${count}`;
    }),
  );

  return [
    "Configured OpenAI-compatible providers:",
    ...rows,
    "",
    `Store: ${storePath}`,
    "Restart opencode for changes to take effect.",
  ].join("\n");
}
