import { join } from "node:path";
import { homedir } from "node:os";
import { interpolate, interpolateHeaders } from "./env.ts";
import { validateProviderSource } from "./store.ts";
import type { Logger, ProviderSource, ResolvedProvider } from "./types.ts";

const DEFAULT_NPM = "@ai-sdk/openai-compatible";
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Default location of the provider store file. */
export function defaultStorePath(): string {
  const root = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(root, "opencode", "openai-compatible-providers.json");
}

/** Resolves the store path from the raw `configFile` option (string only). */
export function storePathFromRaw(raw: unknown, fallback: string): string {
  if (isRecord(raw)) {
    const configFile = raw.configFile;
    if (typeof configFile === "string" && configFile.trim() !== "") {
      return configFile.trim();
    }
  }
  return fallback;
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;

const stringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") out.push(entry.trim());
  }
  return out.length > 0 ? out : undefined;
};

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const recordOfRecords = (value: unknown): Record<string, Record<string, unknown>> | undefined => {
  if (!isRecord(value)) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isRecord(entry)) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/**
 * Defensively cleans a raw provider entry after it passed
 * `validateProviderSource` (string id + baseURL). Malformed optional fields
 * are dropped rather than propagated. Never throws.
 */
function sanitizeSource(value: ProviderSource): ProviderSource {
  const clean: ProviderSource = { id: value.id, baseURL: value.baseURL };
  const raw = value as unknown as Record<string, unknown>;

  const name = optionalString(raw.name);
  if (name) clean.name = name;

  const apiKey = optionalString(raw.apiKey);
  if (apiKey) clean.apiKey = apiKey;

  const headers = stringRecord(raw.headers);
  if (headers) clean.headers = headers;

  const npm = optionalString(raw.npm);
  if (npm) clean.npm = npm;

  const modelsURL = optionalString(raw.modelsURL);
  if (modelsURL) clean.modelsURL = modelsURL;

  const fetchModels = raw.fetchModels;
  if (typeof fetchModels === "boolean") clean.fetchModels = fetchModels;

  const include = stringArray(raw.include);
  if (include) clean.include = include;

  const exclude = stringArray(raw.exclude);
  if (exclude) clean.exclude = exclude;

  const defaultLimitRaw = raw.defaultLimit;
  if (isRecord(defaultLimitRaw)) {
    const defaultLimit: NonNullable<ProviderSource["defaultLimit"]> = {};
    const context = positiveInteger(defaultLimitRaw.context);
    const output = positiveInteger(defaultLimitRaw.output);
    if (context) defaultLimit.context = context;
    if (output) defaultLimit.output = output;
    if (Object.keys(defaultLimit).length > 0) clean.defaultLimit = defaultLimit;
  }

  const overrides = recordOfRecords(raw.overrides);
  if (overrides) clean.overrides = overrides as ProviderSource["overrides"];

  const staticModels = recordOfRecords(raw.staticModels);
  if (staticModels) clean.staticModels = staticModels as ProviderSource["staticModels"];

  return clean;
}

function normalizeSource(source: ProviderSource, env: boolean, fetchTimeoutMs: number): ResolvedProvider {
  const apiKey = source.apiKey !== undefined ? interpolate(source.apiKey, env) : undefined;
  const headers = interpolateHeaders(source.headers, env);
  const resolved: ResolvedProvider = {
    ...source,
    baseURL: interpolate(source.baseURL, env),
    ...(apiKey && apiKey.trim() !== "" ? { apiKey } : {}),
    ...(headers ? { headers } : {}),
    npm: source.npm ?? DEFAULT_NPM,
    fetchModels: source.fetchModels !== false,
    timeoutMs: fetchTimeoutMs,
  };
  return resolved;
}

export type NormalizedOptions = {
  sources: ResolvedProvider[];
  storePath: string;
  model?: string;
  smallModel?: string;
  fetchTimeoutMs: number;
  env: boolean;
};

/**
 * Merges plugin-option providers with store providers (store wins on id
 * collisions), interpolates env tokens, and applies defaults. Malformed input
 * is tolerated: invalid entries are skipped and logged, never thrown.
 */
export function normalizeOptions(
  raw: unknown,
  storeProviders: ProviderSource[],
  defaultStorePath: string,
  logger: Logger,
): NormalizedOptions {
  const input = isRecord(raw) ? raw : {};
  const storePath = storePathFromRaw(raw, defaultStorePath);
  const env = input.env !== false;
  const fetchTimeoutMs = positiveInteger(input.fetchTimeoutMs) ?? DEFAULT_FETCH_TIMEOUT_MS;

  const byId = new Map<string, ProviderSource>();
  const skipped: string[] = [];

  const optionProviders = Array.isArray(input.providers) ? input.providers : [];
  for (const [index, entry] of optionProviders.entries()) {
    if (validateProviderSource(entry)) {
      byId.set(entry.id, sanitizeSource(entry));
    } else {
      skipped.push(`options.providers[${index}]`);
    }
  }
  for (const entry of storeProviders) {
    if (validateProviderSource(entry)) {
      byId.set(entry.id, sanitizeSource(entry));
    } else {
      const id = (entry as unknown as Record<string, unknown>).id;
      skipped.push(`store:${typeof id === "string" ? id : "?"}`);
    }
  }

  if (skipped.length > 0) {
    logger("warn", `Skipped ${skipped.length} malformed provider entries`, { skipped });
  }

  const sources = [...byId.values()].map((source) =>
    normalizeSource(source, env, fetchTimeoutMs),
  );

  const model = optionalString(input.model);
  const smallModel = optionalString(input.smallModel);

  return {
    sources,
    storePath,
    ...(model ? { model } : {}),
    ...(smallModel ? { smallModel } : {}),
    fetchTimeoutMs,
    env,
  };
}
