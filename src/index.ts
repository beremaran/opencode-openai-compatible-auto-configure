import type { Config, Plugin } from "@opencode-ai/plugin";
import { addProviderCommand, providersCommand } from "./commands.ts";
import { createLogger } from "./log.ts";
import { buildModelEntries, fetchModels } from "./models.ts";
import { defaultStorePath, normalizeOptions, storePathFromRaw } from "./options.ts";
import type { NormalizedOptions } from "./options.ts";
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
 * Structural OpenCode 2 types keep this package loadable with the legacy V1
 * plugin package and the V2 runtime. The implementation only uses the public
 * Promise API subset needed to transform provider and model registries.
 */
type V2Provider = {
  id?: string;
  name?: string;
  activation?: "auto" | "enabled" | "disabled";
  package?: string;
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
};

type V2Model = {
  id?: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  limit?: { context: number; input?: number; output: number };
  capabilities?: {
    tools?: boolean;
    input?: string[];
    output?: string[];
  };
  variants?: unknown[];
  time?: { released: number };
  cost?: unknown[];
  status?: "alpha" | "beta" | "deprecated" | "active";
  enabled?: boolean;
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

type V2CatalogDraft = {
  provider: {
    update?: (id: string, update: (provider: V2Provider) => void) => void;
    add?: (input: { info: V2Provider; models: V2Model[] }) => void;
  };
  model: {
    update?: (providerID: string, modelID: string, update: (model: V2Model) => void) => void;
    default: {
      set: (providerID: string, modelID: string) => void;
    };
  };
};

type V2ProviderEditor = {
  get?: (providerID: string) => { models?: ReadonlyMap<string, V2Model> } | undefined;
  add?: (input: { info: V2Provider; models: V2Model[] }) => void;
  update?: (providerID: string, update: (provider: V2Provider) => void) => void;
  models?: {
    set?: (providerID: string, models: V2Model[]) => void;
    update?: (providerID: string, modelID: string, update: (model: V2Model) => void) => void;
  };
};

type V2ModelEditor = {
  default: {
    set: (providerID: string, modelID: string) => void;
  };
};

type V2Command = {
  description?: string;
  template?: string;
};

type V2CommandInput = {
  sessionID: string;
  prompt: Record<string, unknown>;
  delivery: "steer" | "queue";
};

type V2CommandDefinition = {
  name: string;
  description?: string;
  execute: (input: V2CommandInput) => Promise<void>;
};

type V2CommandEditor = {
  add?: (command: V2CommandDefinition) => void;
  update?: (name: string, update: (command: V2Command) => void) => void;
};

type V2Context = {
  options?: unknown;
  provider?: {
    transform: (
      callback: (draft: V2ProviderEditor) => void | Promise<void>,
    ) => Promise<unknown> | unknown;
  };
  model?: {
    transform: (
      callback: (draft: V2ModelEditor) => void | Promise<void>,
    ) => Promise<unknown> | unknown;
  };
  catalog?: {
    transform: (
      callback: (draft: V2CatalogDraft) => void | Promise<void>,
    ) => Promise<unknown> | unknown;
  };
  command?: {
    transform: (
      callback: (draft: V2CommandEditor) => void | Promise<void>,
    ) => Promise<unknown> | unknown;
  };
  session?: {
    prompt: (input: Record<string, unknown>) => Promise<unknown> | unknown;
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

const v2ProviderInfo = (source: ResolvedProvider): V2Provider => {
  const info: V2Provider = {
    id: source.id,
    name: source.name ?? source.id,
    activation: "enabled",
    package: v2PackageFor(source),
    settings: { baseURL: source.baseURL },
  };
  if (source.apiKey) info.settings = { ...info.settings, apiKey: source.apiKey };
  if (source.headers) info.headers = { ...source.headers };
  return info;
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

const v2ModelInfo = (providerID: string, modelID: string, entry: object): V2Model => {
  const model: V2Model = {
    id: modelID,
    modelID,
    providerID,
    name: modelID,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 0, output: 0 },
  };
  applyV2Model(model, modelID, entry);
  return model;
};

const splitModel = (value: string): { providerID: string; modelID: string } | undefined => {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
};

const v2ModelsFor = (providerID: string, models: Record<string, object>): V2Model[] =>
  Object.entries(models).map(([modelID, entry]) => v2ModelInfo(providerID, modelID, entry));

const registerCurrentV2 = async (
  context: V2Context,
  configured: Array<{ source: ResolvedProvider; models: Record<string, object> }>,
  options: NormalizedOptions,
): Promise<boolean> => {
  if (!context.provider?.transform) return false;

  await context.provider.transform((providers) => {
    for (const { source, models } of configured) {
      const generated = v2ModelsFor(source.id, models);
      const existing = providers.get?.(source.id);
      if (existing) {
        providers.update?.(source.id, (provider) => applyV2Provider(provider, source));
        const preserved = existing.models
          ? [...existing.models.values()].filter(
              (model) => !generated.some((replacement) => replacement.id === model.id),
            )
          : [];
        providers.models?.set?.(source.id, [...preserved, ...generated]);
        continue;
      }

      providers.add?.({ info: v2ProviderInfo(source), models: generated });
    }
  });

  if (options.model) {
    const model = splitModel(options.model);
    if (!model) {
      v2Logger("warn", `Ignoring invalid V2 default model "${options.model}"`);
    } else if (context.model?.transform) {
      await context.model.transform((models) => models.default.set(model.providerID, model.modelID));
    } else {
      v2Logger("warn", "OpenCode 2 model transforms are unavailable; ignoring the default model");
    }
  }
  return true;
};

const registerLegacyV2 = async (
  context: V2Context,
  configured: Array<{ source: ResolvedProvider; models: Record<string, object> }>,
  options: NormalizedOptions,
): Promise<boolean> => {
  if (!context.catalog?.transform) return false;

  await context.catalog.transform((catalog) => {
    for (const { source, models } of configured) {
      const generated = v2ModelsFor(source.id, models);
      if (catalog.provider.add) {
        catalog.provider.add({ info: v2ProviderInfo(source), models: generated });
        continue;
      }

      catalog.provider.update?.(source.id, (provider) => {
        applyV2Provider(provider, source);
      });
      for (const [modelID, entry] of Object.entries(models)) {
        catalog.model.update?.(source.id, modelID, (model) => {
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
  return true;
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

    if (!(await registerCurrentV2(context, configured, options))) {
      await registerLegacyV2(context, configured, options);
    }

    if (options.smallModel) {
      v2Logger(
        "warn",
        `smallModel is not available in the OpenCode 2 model API; ignoring "${options.smallModel}"`,
      );
    }

    // V2 has no V1 command execution hook. Keep these as model-assisted
    // helpers; mutations should use the V2 config shape or provider store.
    if (context.command) {
      await context.command.transform((commands) => {
        const addProviderDescription =
          "Explain how to add an OpenAI-compatible provider for OpenCode 2";
        const addProviderTemplate =
          "Explain how to add an OpenAI-compatible provider to the V2 plugins configuration or provider store, then remind the user to restart OpenCode.";
        const providersDescription =
          "Explain the configured OpenAI-compatible providers for OpenCode 2";
        const providersTemplate =
          "Inspect the OpenAI-compatible provider configuration and summarize its configured providers and models.";

        if (commands.add && context.session) {
          const promptCommand = (text: string) => async (input: V2CommandInput): Promise<void> => {
            const original = typeof input.prompt.text === "string" ? input.prompt.text : "";
            await context.session?.prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: original ? `${text}\n\n${original}` : text,
              delivery: input.delivery,
            });
          };
          commands.add({
            name: "add-provider",
            description: addProviderDescription,
            execute: promptCommand(addProviderTemplate),
          });
          commands.add({
            name: "providers",
            description: providersDescription,
            execute: promptCommand(providersTemplate),
          });
          return;
        }

        commands.update?.("add-provider", (command) => {
          command.description = addProviderDescription;
          command.template = addProviderTemplate;
        });
        commands.update?.("providers", (command) => {
          command.description = providersDescription;
          command.template = providersTemplate;
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
