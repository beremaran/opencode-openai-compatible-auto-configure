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

export default AutoProvidersPlugin;
