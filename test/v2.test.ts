import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import v2Plugin from "../src/v2.ts";

test("OpenCode 2 setup transforms providers, models, commands, and default model", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ocp-v2-"));
  try {
    let provider: Record<string, unknown> = {};
    let models: Record<string, Record<string, unknown>> = {};
    let defaultModel: string | undefined;
    const commands: Record<string, Record<string, unknown>> = {};

    await v2Plugin.setup({
      options: {
        configFile: join(directory, "providers.json"),
        model: "mock/m1",
        providers: [
          {
            id: "mock",
            baseURL: "http://127.0.0.1:1/v1",
            fetchModels: false,
            staticModels: { m1: { name: "Mock One", limit: { context: 4096, output: 1024 } } },
          },
        ],
      },
      provider: {
        transform: async (callback) =>
          callback({
            get: () => undefined,
            add: (input) => {
              provider = input.info as Record<string, unknown>;
              models = Object.fromEntries(
                input.models.map((model) => [model.id, model as Record<string, unknown>]),
              );
            },
          }),
      },
      model: {
        transform: async (callback) =>
          callback({
            default: { set: (providerID, modelID) => (defaultModel = `${providerID}/${modelID}`) },
          }),
      },
      command: {
        transform: async (callback) =>
          callback({
            add: (command) => {
              commands[command.name] = command as unknown as Record<string, unknown>;
            },
          }),
      },
      session: { prompt: async () => undefined },
    });

    assert.equal(provider.package, "@opencode-ai/ai/providers/openai-compatible");
    assert.deepEqual(provider.settings, { baseURL: "http://127.0.0.1:1/v1" });
    assert.equal(provider.name, "mock");
    assert.equal(models.m1?.modelID, "m1");
    assert.equal(models.m1?.name, "Mock One");
    assert.deepEqual(models.m1?.limit, { context: 4096, output: 1024 });
    assert.deepEqual(models.m1?.capabilities, { tools: true, input: ["text"], output: ["text"] });
    assert.equal(defaultModel, "mock/m1");
    assert.equal(typeof commands["add-provider"]?.execute, "function");
    assert.equal(typeof commands.providers?.execute, "function");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
