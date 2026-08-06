import type { PluginInput } from "@opencode-ai/plugin";
import type { Logger } from "./types.ts";

const SERVICE = "opencode-openai-compatible-auto-configure";

/**
 * Builds a `Logger` backed by opencode's `app.log` endpoint. The SDK expects
 * the payload under a `body` key; every failure is swallowed so logging can
 * never break startup or a command handler.
 */
export function createLogger(client: PluginInput["client"]): Logger {
  const app = (client as { app?: { log?: unknown } } | undefined)?.app;
  const log = app?.log;
  if (typeof log !== "function") {
    return () => undefined;
  }
  return (level, message, extra) => {
    try {
      (log as (args: object) => Promise<unknown>)({
        body: {
          service: SERVICE,
          level,
          message,
          ...(extra !== undefined ? { extra } : {}),
        },
      }).catch(() => undefined);
    } catch {
      // Never throw from logging.
    }
  };
}
