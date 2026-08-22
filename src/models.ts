import type { DiscoveredModel, Logger, ModelOverride, ResolvedProvider } from "./types.ts";

const MAX_MODELS = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const positiveInt = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return undefined;
};

/**
 * Known `/models` response keys that carry a context window or output token
 * limit. Order defines precedence when several are present.
 */
const CONTEXT_KEYS = [
  "context_length",
  "max_context_length",
  "max_context",
  "context_window",
  "contextWindow",
  "ctx_len",
  "n_ctx",
  "context_size",
  "input_token_limit",
  "max_input_tokens",
  "max_input",
] as const;

const OUTPUT_KEYS = [
  "max_output_tokens",
  "output_token_limit",
  "max_tokens",
  "max_output",
] as const;

function nestedLimit(item: Record<string, unknown>): { context?: number; output?: number } {
  const limit = item.limit;
  if (!isRecord(limit)) return {};
  return {
    ...(positiveInt(limit.context) !== undefined ? { context: positiveInt(limit.context) } : {}),
    ...(positiveInt(limit.output) !== undefined ? { output: positiveInt(limit.output) } : {}),
  };
}

function firstNumeric(rec: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = positiveInt(rec[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Scans a raw `/models` item for context/output token limits across known
 * vendor keys plus a nested `limit` object. Returns only defined positive
 * integers.
 */
export function detectLimit(
  item: Record<string, unknown>,
): { context?: number; output?: number } {
  const nested = nestedLimit(item);
  const context = firstNumeric(item, CONTEXT_KEYS) ?? nested.context;
  const output = firstNumeric(item, OUTPUT_KEYS) ?? nested.output;
  const result: { context?: number; output?: number } = {};
  if (context !== undefined) result.context = context;
  if (output !== undefined) result.output = output;
  return result;
}

function itemToModel(item: unknown): DiscoveredModel[] {
  if (!isRecord(item)) return [];
  const id = typeof item.id === "string" ? item.id.trim() : undefined;
  if (!id) return [];
  const model: DiscoveredModel = { id, vendor: item };
  const name = typeof item.name === "string" ? item.name : undefined;
  if (name) model.name = name;
  const limit = detectLimit(item);
  if (limit.context !== undefined && limit.output !== undefined) {
    model.limit = { context: limit.context, output: limit.output };
  }
  return [model];
}

/**
 * Tolerant parser for `/models` responses: accepts `{ data: [...] }`,
 * `{ models: [...] }`, and a bare object map of id -> entry. Items without a
 * string `id` are skipped. Returns `null` when the body is not JSON or has
 * none of the recognized shapes.
 */
export function parseModelResponse(text: string): DiscoveredModel[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;

  if (Array.isArray(json.data)) {
    return json.data.flatMap(itemToModel);
  }
  if (Array.isArray(json.models)) {
    return json.models.flatMap(itemToModel);
  }

  const out: DiscoveredModel[] = [];
  for (const [id, entry] of Object.entries(json)) {
    const model: DiscoveredModel = { id };
    if (isRecord(entry)) {
      model.vendor = entry;
      const name = typeof entry.name === "string" ? entry.name : undefined;
      if (name) model.name = name;
      const limit = detectLimit(entry);
      if (limit.context !== undefined && limit.output !== undefined) {
        model.limit = { context: limit.context, output: limit.output };
      }
    }
    out.push(model);
  }
  return out;
}

/**
 * Fetches the model list for a provider. Returns `null` on any failure
 * (non-2xx status, network error, timeout, unparseable body). The returned
 * list is capped at 500 entries.
 */
export async function fetchModels(
  source: ResolvedProvider,
  logger: Logger,
): Promise<DiscoveredModel[] | null> {
  const base = source.baseURL.replace(/\/+$/, "");
  const url = source.modelsURL ?? `${base}/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), source.timeoutMs);

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(source.headers ?? {}),
  };
  // A configured apiKey wins over any Authorization header the user supplied.
  if (source.apiKey && source.apiKey.trim() !== "") {
    headers.Authorization = `Bearer ${source.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  } catch (error) {
    logger("warn", `Failed to fetch models from "${url}" for provider "${source.id}": ${String(error)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    logger(
      "warn",
      `Model fetch for provider "${source.id}" returned HTTP ${response.status} from "${url}"`,
    );
    return null;
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    logger("warn", `Failed to read model response body from "${url}": ${String(error)}`);
    return null;
  }

  const models = parseModelResponse(text);
  if (models === null) {
    logger("warn", `Could not parse model list from "${url}" for provider "${source.id}"`);
    return null;
  }

  if (models.length > MAX_MODELS) {
    logger(
      "warn",
      `Provider "${source.id}" advertised ${models.length} models; keeping the first ${MAX_MODELS}`,
      { provider: source.id, total: models.length, kept: MAX_MODELS },
    );
    return models.slice(0, MAX_MODELS);
  }
  return models;
}

/**
 * Tiny glob matcher supporting `*` (any run of characters). Used by
 * `buildModelEntries` for the `include`/`exclude` filters.
 */
export function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`).test(value);
}

function matchesAny(patterns: string[] | undefined, id: string): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => globMatch(pattern, id));
}

function keptByFilters(source: ResolvedProvider, id: string): boolean {
  const include = source.include;
  if (include && include.length > 0 && !matchesAny(include, id)) return false;
  if (source.exclude && source.exclude.length > 0 && matchesAny(source.exclude, id)) return false;
  return true;
}

function mergeDeep(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(out[key])) {
      out[key] = mergeDeep(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function resolveLimit(
  detected: { context?: number; output?: number } | undefined,
  defaultLimit: ResolvedProvider["defaultLimit"],
): { context: number; output: number } | undefined {
  const context = detected?.context ?? defaultLimit?.context;
  const output = detected?.output ?? defaultLimit?.output;
  if (context === undefined || output === undefined) return undefined;
  return { context, output };
}

/**
 * Builds the opencode `models` map for a provider. Only the fields allowed by
 * opencode's model-entry schema are emitted (a `limit` always carries both
 * `context` and `output`).
 */
export function buildModelEntries(
  models: DiscoveredModel[] | null,
  source: ResolvedProvider,
): Record<string, object> {
  const staticModels = source.staticModels ?? {};
  const discoveredById = new Map<string, DiscoveredModel>();

  const ids: string[] = [];
  if (models !== null) {
    for (const model of models) {
      discoveredById.set(model.id, model);
      ids.push(model.id);
    }
    for (const id of Object.keys(staticModels)) {
      if (!discoveredById.has(id)) ids.push(id);
    }
  } else {
    for (const id of Object.keys(staticModels)) ids.push(id);
  }

  const kept = ids.filter((id) => keptByFilters(source, id)).slice(0, MAX_MODELS);
  const entries: Record<string, object> = {};

  for (const id of kept) {
    const staticOverride = staticModels[id];
    const discovered = discoveredById.get(id);
    const detected = discovered?.limit ?? detectLimit(discovered?.vendor ?? {});
    const discoveredLimit = resolveLimit(detected, source.defaultLimit);
    const limit =
      staticOverride?.limit !== undefined
        ? resolveLimit(
            {
              context: staticOverride.limit.context,
              output: staticOverride.limit.output,
            },
            source.defaultLimit ?? discoveredLimit,
          )
        : discoveredLimit;

    const entry: Record<string, unknown> = {
      temperature: staticOverride?.temperature ?? true,
      tool_call: staticOverride?.tool_call ?? true,
    };

    const name = staticOverride?.name ?? discovered?.name ?? id;
    if (name !== id) entry.name = name;
    if (staticOverride?.id && staticOverride.id !== id) entry.id = staticOverride.id;
    if (limit) entry.limit = limit;
    if (staticOverride?.reasoning !== undefined) entry.reasoning = staticOverride.reasoning;
    if (staticOverride?.attachment !== undefined) entry.attachment = staticOverride.attachment;
    if (staticOverride?.options) entry.options = staticOverride.options;
    if (staticOverride?.headers) entry.headers = staticOverride.headers;

    entries[id] = mergeOverride(entry, source.overrides?.[id], limit, defaultLimitOf(source));
  }

  return entries;
}

function defaultLimitOf(source: ResolvedProvider): ResolvedProvider["defaultLimit"] {
  return source.defaultLimit;
}

/**
 * Applies a per-model override on top of a discovered entry. Nested
 * `options`/`headers` are deep-merged; `limit` replaces the computed limit
 * (still normalized to emit both `context` and `output` when possible);
 * booleans and scalars replace shallowly. Overrides for ids that are not in
 * the kept list are never applied (the caller only passes kept ids).
 */
function mergeOverride(
  entry: Record<string, unknown>,
  override: ModelOverride | undefined,
  baseLimit: { context: number; output: number } | undefined,
  defaultLimit: ResolvedProvider["defaultLimit"],
): Record<string, unknown> {
  if (!override) return entry;
  const out: Record<string, unknown> = { ...entry };

  if (override.id) out.id = override.id;
  if (override.name !== undefined) {
    if (override.name !== "") out.name = override.name;
    else delete out.name;
  }
  if (override.temperature !== undefined) out.temperature = override.temperature;
  if (override.reasoning !== undefined) out.reasoning = override.reasoning;
  if (override.attachment !== undefined) out.attachment = override.attachment;
  if (override.tool_call !== undefined) out.tool_call = override.tool_call;

  if (override.limit !== undefined) {
    const replaced = resolveLimit(
      {
        context: override.limit.context,
        output: override.limit.output,
      },
      defaultLimit ?? baseLimit,
    );
    if (replaced) out.limit = replaced;
    else delete out.limit;
  }

  if (override.options !== undefined) {
    const merged = isRecord(out.options)
      ? mergeDeep(out.options as Record<string, unknown>, override.options)
      : { ...override.options };
    out.options = merged;
  }
  if (override.headers !== undefined) {
    const merged = isRecord(out.headers)
      ? mergeDeep(out.headers as Record<string, unknown>, override.headers)
      : { ...override.headers };
    out.headers = merged;
  }

  return out;
}
