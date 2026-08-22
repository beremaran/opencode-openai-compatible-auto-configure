import type { Config, Plugin } from "@opencode-ai/plugin";
import { addProviderCommand, providersCommand } from "./commands.ts";
import { createLogger } from "./log.ts";
import { buildModelEntries, fetchModels } from "./models.ts";
import { defaultStorePath, normalizeOptions, storePathFromRaw } from "./options.ts";
import { loadStore } from "./store.ts";
import type { Logger, ResolvedProvider } from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Replaces the text of the first text part produced by a command template.
 * Falls back to appending a minimal text part when none exists.
 */
function replaceTextPart(
  parts: Array<{ type: string; text?: string }>,
  text: string,
): void {
  const part = parts.find((candidate) => candidate.type === "text");
  if (part) {
    part.text = text;
    return;
  }
  parts.push({ type: "text", text });
}

/**
 * Builds the `cfg.provider[id]` entry for one source.
 *
 * Merge rule with an existing user-configured provider: the user's `name`,
 * `npm`, and `options` are kept when set (their options win per-key), and the
 * user's manually-written `models` map is used as the base. Our computed
 * `models` (from `/models` discovery plus static models) override the user's
 * map key-by-key, so a server-listed model always reflects discovery while
 * hand-written models that the server did not list are preserved.
 */
function providerConfig(
  source: ResolvedProvider,
  models: Record<string, object>,
  existing: unknown,
): Record<string, unknown> {
  const existingConfig = isRecord(existing) ? existing : {};

  const npm =
    (typeof existingConfig.npm === "string" ? existingConfig.npm : undefined) ??
    source.npm ??
    "@ai-sdk/openai-compatible";
  const name =
    (typeof existingConfig.name === "string" ? existingConfig.name : undefined) ??
    source.name;

  const userModels = (
    isRecord(existingConfig.models) ? existingConfig.models : {}
  ) as Record<string, object>;
  const mergedModels: Record<string, object> = { ...userModels, ...models };

  const baseOptions: Record<string, unknown> = { baseURL: source.baseURL };
  if (source.apiKey) baseOptions.apiKey = source.apiKey;
  if (source.headers) baseOptions.headers = source.headers;
  const userOptions = isRecord(existingConfig.options) ? existingConfig.options : {};
  const mergedOptions = { ...baseOptions, ...userOptions };

  const entry: Record<string, unknown> = { npm, options: mergedOptions, models: mergedModels };
  if (name) entry.name = name;
  return entry;
}

export const AutoProvidersPlugin: Plugin = async (input, rawOptions) => {
  const logger: Logger = createLogger(input.client);
  const storePath = storePathFromRaw(rawOptions, defaultStorePath());
  const { providers: storedProviders } = loadStore(storePath, logger);
  const options = normalizeOptions(rawOptions, storedProviders, storePath, logger);
  const sources = options.sources;

  return {
    config: async (cfg: Config) => {
      try {
        cfg.provider ??= {};
        cfg.command ??= {};

        cfg.command["add-provider"] = {
          description:
            "Add or update an OpenAI-compatible provider (baseURL, optional apiKey) and auto-configure its models",
          template: "<add-provider-command>$ARGUMENTS</add-provider-command>",
        };
        cfg.command.providers = {
          description:
            "List configured OpenAI-compatible providers with live model counts",
          template: "<providers-command>$ARGUMENTS</providers-command>",
        };

        // Fetch every provider's model list in parallel. One failing fetch
        // never blocks the others.
        const results = await Promise.allSettled(
          sources.map(async (source) => {
            const fetched = source.fetchModels ? await fetchModels(source, logger) : null;
            return { source, fetched };
          }),
        );

        const providers = cfg.provider as Record<string, Record<string, unknown>>;

        for (const result of results) {
          if (result.status === "rejected") {
            logger(
              "error",
              `Failed to configure provider "${String(
                (result.reason as { source?: { id?: string } })?.source?.id ??
                  (result.reason as { provider?: string })?.provider ??
                  "",
              )}": ${String(result.reason)}`,
              { reason: result.reason },
            );
            continue;
          }

          const { source, fetched } = result.value;
          const models = buildModelEntries(fetched, source);

          if (Object.keys(models).length === 0) {
            logger(
              "error",
              `Skipping provider "${source.id}": no models could be determined (model fetch failed and no static models are configured)`,
              { provider: source.id },
            );
            continue;
          }

          providers[source.id] = providerConfig(source, models, providers[source.id]);
          logger("info", `Configured provider "${source.id}" with ${Object.keys(models).length} models`, {
            provider: source.id,
            modelCount: Object.keys(models).length,
            baseURL: source.baseURL,
          });
        }

        if (options.model) cfg.model = options.model;
        if (options.smallModel) cfg.small_model = options.smallModel;
      } catch (error) {
        logger(
          "error",
          `Unexpected error in opencode-openai-compatible-auto-configure config hook: ${String(error)}`,
          { error },
        );
      }
    },

    "command.execute.before": async ({ command, arguments: args }, output) => {
      try {
        if (command === "add-provider") {
          replaceTextPart(output.parts, addProviderCommand(args, storePath, logger));
          return;
        }
        if (command === "providers") {
          replaceTextPart(output.parts, await providersCommand(storePath, logger));
        }
      } catch (error) {
        logger("error", `Unexpected error handling "/${command}": ${String(error)}`, {
          command,
          error,
        });
      }
    },
  };
};

/**
 * Structural OpenCode 2 types keep this package loadable with either the V1
 * plugin package or the V2 beta package. The implementation only uses the
 * public Promise API subset needed to transform the catalog.
 */
type V2Provider = {
  name?: string;
  package?: string;
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
};

type V2Model = {
  modelID?: string;
  name?: string;
  limit?: { context: number; output: number };
  capabilities?: {
    tools?: boolean;
    input?: string[];
    output?: string[];
  };
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

type V2CatalogDraft = {
  provider: {
    update: (id: string, update: (provider: V2Provider) => void) => void;
  };
  model: {
    update: (providerID: string, modelID: string, update: (model: V2Model) => void) => void;
    default: {
      set: (providerID: string, modelID: string) => void;
    };
  };
};

type V2Command = {
  description?: string;
  template?: string;
};

type V2Context = {
  options?: unknown;
  catalog: {
    transform: (
      callback: (draft: V2CatalogDraft) => void | Promise<void>,
    ) => Promise<unknown> | unknown;
  };
  command?: {
    transform: (
      callback: (draft: { update: (name: string, update: (command: V2Command) => void) => void }) =>
        void | Promise<void>,
    ) => Promise<unknown> | unknown;
  };
};

export type V2Plugin = {
  readonly id: string;
  readonly setup: (context: V2Context) => Promise<void>;
};

type V2CapablePlugin = typeof AutoProvidersPlugin & { readonly v2?: V2Plugin };

const V2_OPENAI_COMPATIBLE_PACKAGE = "@opencode-ai/ai/providers/openai-compatible";

const v2Logger = (level: "info" | "warn" | "error" | "debug", message: string, extra?: unknown): void => {
  try {
    const method = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    method(`[opencode-openai-compatible-auto-configure] ${message}`, extra ?? "");
  } catch {
    // Logging must never affect plugin setup.
  }
};

const v2PackageFor = (source: ResolvedProvider): string =>
  source.npm === "@ai-sdk/openai-compatible"
    ? V2_OPENAI_COMPATIBLE_PACKAGE
    : (source.npm ?? V2_OPENAI_COMPATIBLE_PACKAGE);

const v2ModelID = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() !== "" ? value : fallback;

const v2Record = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const applyV2Provider = (provider: V2Provider, source: ResolvedProvider): void => {
  if (!provider.name && source.name) provider.name = source.name;
  if (!provider.package) provider.package = v2PackageFor(source);

  const sourceSettings: Record<string, unknown> = { baseURL: source.baseURL };
  if (source.apiKey) sourceSettings.apiKey = source.apiKey;
  const existingSettings = v2Record(provider.settings);
  provider.settings = { ...sourceSettings, ...existingSettings };

  if (!provider.headers && source.headers) provider.headers = { ...source.headers };
};

const applyV2Model = (model: V2Model, modelID: string, entry: object): void => {
  const raw = entry as Record<string, unknown>;
  model.modelID = v2ModelID(raw.id, modelID);
  model.name = typeof raw.name === "string" ? raw.name : modelID;

  const limit = v2Record(raw.limit);
  if (limit && typeof limit.context === "number" && typeof limit.output === "number") {
    model.limit = { context: limit.context, output: limit.output };
  }

  const existingCapabilities = v2Record(model.capabilities);
  const input = Array.isArray(existingCapabilities?.input)
    ? existingCapabilities.input.filter((value): value is string => typeof value === "string")
    : [];
  const output = Array.isArray(existingCapabilities?.output)
    ? existingCapabilities.output.filter((value): value is string => typeof value === "string")
    : [];
  model.capabilities = {
    ...existingCapabilities,
    tools: raw.tool_call !== false,
    input: input.length > 0 ? input : ["text"],
    output: output.length > 0 ? output : ["text"],
  };

  // V1 model `options` are per-request provider options. V2 expresses those
  // as request-body fields; headers remain model-scoped headers.
  const options = v2Record(raw.options);
  if (options) model.body = { ...model.body, ...options };
  const headers = v2Record(raw.headers);
  if (headers) {
    model.headers = Object.fromEntries(
      Object.entries({ ...model.headers, ...headers }).filter(
        ([, value]) => typeof value === "string",
      ),
    ) as Record<string, string>;
  }
};

const splitModel = (value: string): { providerID: string; modelID: string } | undefined => {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
};

const V2_PLUGIN: V2Plugin = {
  id: "@beremaran/opencode-openai-compatible-auto-configure",
  setup: async (context) => {
    const rawOptions = context.options;
    const storePath = storePathFromRaw(rawOptions, defaultStorePath());
    const { providers: storedProviders } = loadStore(storePath, v2Logger);
    const options = normalizeOptions(rawOptions, storedProviders, storePath, v2Logger);

    const results = await Promise.allSettled(
      options.sources.map(async (source) => {
        const fetched = source.fetchModels ? await fetchModels(source, v2Logger) : null;
        return { source, fetched };
      }),
    );
    const configured: Array<{ source: ResolvedProvider; models: Record<string, object> }> = [];

    for (const result of results) {
      if (result.status === "rejected") {
        v2Logger("error", `Failed to configure a provider: ${String(result.reason)}`, {
          reason: result.reason,
        });
        continue;
      }

      const { source, fetched } = result.value;
      const models = buildModelEntries(fetched, source);
      if (Object.keys(models).length === 0) {
        v2Logger(
          "error",
          `Skipping provider "${source.id}": no models could be determined (model fetch failed and no static models are configured)`,
          { provider: source.id },
        );
        continue;
      }
      configured.push({ source, models });
    }

    await context.catalog.transform((catalog) => {
      for (const { source, models } of configured) {
        catalog.provider.update(source.id, (provider) => {
          applyV2Provider(provider, source);
        });
        for (const [modelID, entry] of Object.entries(models)) {
          catalog.model.update(source.id, modelID, (model) => {
            applyV2Model(model, modelID, entry);
          });
        }
      }

      if (options.model) {
        const model = splitModel(options.model);
        if (model) catalog.model.default.set(model.providerID, model.modelID);
        else v2Logger("warn", `Ignoring invalid V2 default model "${options.model}"`);
      }
    });

    if (options.smallModel) {
      v2Logger(
        "warn",
        `smallModel is not available in the OpenCode 2 catalog API; ignoring "${options.smallModel}"`,
      );
    }

    // V2 has command transforms but no V1 command execution hook. Keep the
    // commands visible as model-assisted helpers; mutations should use the
    // V2 config shape or the provider store directly.
    if (context.command) {
      await context.command.transform((commands) => {
        commands.update("add-provider", (command) => {
          command.description = "Explain how to add an OpenAI-compatible provider for OpenCode 2";
          command.template =
            "Explain how to add an OpenAI-compatible provider to the V2 plugins configuration or provider store, then remind the user to restart OpenCode.";
        });
        commands.update("providers", (command) => {
          command.description = "Explain the configured OpenAI-compatible providers for OpenCode 2";
          command.template =
            "Inspect the OpenAI-compatible provider configuration and summarize its configured providers and models.";
        });
      });
    }
  },
};

// Keep V1's enumerable exports function-only. OpenCode 2 receives the object
// through the package root entrypoint in src/v2.ts.
Object.defineProperty(AutoProvidersPlugin as V2CapablePlugin, "v2", {
  configurable: false,
  enumerable: false,
  value: V2_PLUGIN,
  writable: false,
});

export default AutoProvidersPlugin;
