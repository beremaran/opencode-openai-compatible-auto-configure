import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import v2Plugin from "../src/v2.ts";

test("OpenCode 2 setup transforms providers, models, commands, and default model", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ocp-v2-"));
  try {
    let provider: Record<string, unknown> = { settings: {}, headers: {} };
    let model: Record<string, unknown> = {
      capabilities: { tools: false, input: ["text"], output: ["text"] },
    };
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
      catalog: {
        transform: async (callback) =>
          callback({
            provider: {
              update: (_id, update) => update(provider as never),
            },
            model: {
              update: (_providerID, _modelID, update) => update(model as never),
              default: { set: (providerID, modelID) => (defaultModel = `${providerID}/${modelID}`) },
            },
          }),
      },
      command: {
        transform: async (callback) =>
          callback({
            update: (name, update) => {
              const command: Record<string, unknown> = {};
              update(command);
              commands[name] = command;
            },
          }),
      },
    });

    assert.equal(provider.package, "@opencode-ai/ai/providers/openai-compatible");
    assert.deepEqual(provider.settings, { baseURL: "http://127.0.0.1:1/v1" });
    assert.equal(provider.name, undefined);
    assert.equal(model.modelID, "m1");
    assert.equal(model.name, "Mock One");
    assert.deepEqual(model.limit, { context: 4096, output: 1024 });
    assert.deepEqual(model.capabilities, { tools: true, input: ["text"], output: ["text"] });
    assert.equal(defaultModel, "mock/m1");
    assert.equal(typeof commands["add-provider"]?.template, "string");
    assert.equal(typeof commands.providers?.template, "string");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
