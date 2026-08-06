import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger, ProviderSource, StoreFile } from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Light guard for a single provider entry: requires string `id` and string
 * `baseURL`. Used by both `loadStore` and option normalization.
 */
export function validateProviderSource(value: unknown): value is ProviderSource {
  if (!isRecord(value)) return false;
  const id = value.id;
  const baseURL = value.baseURL;
  return (
    typeof id === "string" && id.trim() !== "" &&
    typeof baseURL === "string" && baseURL.trim() !== ""
  );
}

/**
 * Reads the store file. A missing file, unparseable JSON, or a wrong top-level
 * shape all yield an empty provider list (logging a warning) — never throws.
 */
export function loadStore(path: string, logger: Logger): { providers: ProviderSource[] } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logger("warn", `Failed to read provider store "${path}": ${String(error)}`);
    }
    return { providers: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    logger("warn", `Provider store "${path}" is not valid JSON: ${String(error)}`);
    return { providers: [] };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.providers)) {
    logger("warn", `Provider store "${path}" has an unexpected shape; ignoring it`);
    return { providers: [] };
  }

  const providers: ProviderSource[] = [];
  const skipped: string[] = [];
  for (const entry of parsed.providers) {
    if (validateProviderSource(entry)) {
      providers.push(entry);
    } else {
      const label = isRecord(entry) && typeof entry.id === "string" ? entry.id : "(unnamed)";
      skipped.push(label);
    }
  }
  if (skipped.length > 0) {
    logger("warn", `Skipped ${skipped.length} malformed provider entry/entries in "${path}"`, {
      skipped,
    });
  }
  return { providers };
}

/**
 * Persists the store atomically (tmp file + rename) under a directory created
 * on demand. Never throws; failures are logged.
 */
export function saveStore(path: string, store: StoreFile, logger: Logger): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    renameSync(tmp, path);
  } catch (error) {
    logger("error", `Failed to write provider store "${path}": ${String(error)}`);
  }
}
