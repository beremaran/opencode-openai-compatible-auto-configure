/**
 * Type-only module: the legacy opencode plugin loader iterates every module
 * export and throws on anything that is not a function, so this module must
 * never export runtime values.
 */

/**
 * A user-supplied override for a single model. This is a subset of opencode's
 * model entry shape; the opencode schema uses `additionalProperties: false`
 * at the top level of a model entry, so unknown fields are not emitted.
 */
export interface ModelOverride {
  id?: string;
  name?: string;
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  temperature?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  tool_call?: boolean;
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * A single OpenAI-compatible endpoint to register. Supplied either via the
 * plugin options `providers` array or via the JSON store file. Strings may
 * reference environment variables as `{env:VAR}` or `${VAR}` (interpolated
 * only when env interpolation is enabled).
 */
export interface ProviderSource {
  /** Provider id used in opencode (referenced as `providerID/modelID`). */
  id: string;
  /** Display name shown in the model picker. */
  name?: string;
  /** Base URL of the OpenAI-compatible API. */
  baseURL: string;
  apiKey?: string;
  /** Extra headers sent with every request to this endpoint. */
  headers?: Record<string, string>;
  /** npm package used to drive the provider. Defaults to `@ai-sdk/openai-compatible`. */
  npm?: string;
  /** Override the model listing URL. Defaults to `{baseURL}/models`. */
  modelsURL?: string;
  /** Fetch models from `{baseURL}/models` at startup. Default: true. */
  fetchModels?: boolean;
  /** Exact model ids or `*` glob patterns to keep. */
  include?: string[];
  /** Exact model ids or `*` glob patterns to drop. */
  exclude?: string[];
  /**
   * Fallback context/output token limits for models that do not advertise
   * limits in the `/models` response.
   */
  defaultLimit?: {
    context?: number;
    output?: number;
  };
  /** Per-model overrides, keyed by model id. Applied on top of discovery. */
  overrides?: Record<string, ModelOverride>;
  /**
   * Static model entries keyed by model id. Used verbatim when `fetchModels`
   * is false or discovery fails; merged in for ids the server did not list.
   */
  staticModels?: Record<string, ModelOverride>;
}

/** Plugin options accepted by the plugin factory. */
export interface PluginOptions {
  /** Inline provider sources; entries with the same id are overridden by the store. */
  providers?: ProviderSource[];
  /** Path to the JSON store file. Defaults to the per-user config path. */
  configFile?: string;
  /** `providerID/modelID` to use as the default model. */
  model?: string;
  /** `providerID/modelID` to use as the small model. */
  smallModel?: string;
  /** Timeout in ms for each `/models` fetch. Default: 10000. */
  fetchTimeoutMs?: number;
  /** Interpolate `{env:VAR}`/`${VAR}` tokens. Default: true. */
  env?: boolean;
}

/** A `ProviderSource` after option merging and env interpolation. */
export type ResolvedProvider = ProviderSource & {
  fetchModels: boolean;
  timeoutMs: number;
};

/** A model discovered from a `/models` response. */
export interface DiscoveredModel {
  id: string;
  name?: string;
  limit?: {
    context: number;
    output: number;
  };
  /** The raw item from the `/models` response, kept for limit detection. */
  vendor?: Record<string, unknown>;
}

/** Shape of the JSON store file. */
export interface StoreFile {
  version: 1;
  providers: ProviderSource[];
}

/** Minimal logger bound to the opencode `app.log` endpoint. */
export type Logger = (
  level: "info" | "warn" | "error" | "debug",
  message: string,
  extra?: unknown,
) => void;
