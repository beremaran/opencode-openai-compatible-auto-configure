import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config, Hooks, PluginInput } from "@opencode-ai/plugin";
import AutoProvidersPlugin from "../src/index.ts";

const logs: unknown[] = [];

function fakeInput(): PluginInput {
  return {
    client: {
      app: {
        log: (args: unknown) => {
          logs.push(args);
          return Promise.resolve();
        },
      },
    } as unknown as PluginInput["client"],
    directory: "/tmp/opencode-plugin-test",
    project: {} as PluginInput["project"],
    worktree: "/tmp/opencode-plugin-test",
    experimental_workspace: {} as PluginInput["experimental_workspace"],
    serverUrl: new URL("http://127.0.0.1:0"),
    $: {} as PluginInput["$"],
  };
}

type CfgShape = {
  provider: Record<string, Record<string, unknown>>;
  command: Record<string, { description?: string; template?: string }>;
  model?: string;
  small_model?: string;
};

test.beforeEach(() => {
  logs.length = 0;
});

test("config hook registers provider, models, and slash commands", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ocp-plugin-"));
  try {
    const hooks = await AutoProvidersPlugin(fakeInput(), {
      configFile: join(tmp, "providers.json"),
      providers: [
        {
          id: "mock",
          baseURL: "http://127.0.0.1:1/v1",
          fetchModels: false,
          staticModels: { m1: { name: "M1" } },
        },
      ],
      model: "mock/m1",
      smallModel: "mock/m1",
    });

    const cfg = { provider: {}, command: {} } as Config;
    await hooks.config?.(cfg);

    const typed = cfg as unknown as CfgShape;
    const mock = typed.provider["mock"];
    assert.ok(mock, "provider mock should be registered");
    assert.equal(mock.npm, "@ai-sdk/openai-compatible");

    const options = mock.options as Record<string, unknown>;
    assert.equal(options.baseURL, "http://127.0.0.1:1/v1");

    const models = mock.models as Record<string, Record<string, unknown>>;
    const m1 = models["m1"];
    assert.ok(m1, "model m1 should be registered");
    assert.equal(m1.temperature, true);
    assert.equal(m1.tool_call, true);
    assert.equal(m1.name, "M1");

    assert.ok(typed.command["add-provider"], "add-provider command should be registered");
    assert.ok(typed.command["providers"], "providers command should be registered");
    assert.ok(typed.command["add-provider"]?.description);
    assert.ok(typed.command["add-provider"]?.template);

    assert.equal(typed.model, "mock/m1");
    assert.equal(typed.small_model, "mock/m1");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("config hook survives a dead fetch endpoint and skips that provider", async () => {
  const hooks = await AutoProvidersPlugin(fakeInput(), {
    providers: [
      { id: "dead", baseURL: "http://127.0.0.1:1/v1", fetchModels: true },
    ],
    fetchTimeoutMs: 200,
  });

  const cfg = { provider: {}, command: {} } as Config;
  await hooks.config?.(cfg); // must not throw

  const typed = cfg as unknown as CfgShape;
  assert.equal(typed.provider["dead"], undefined);
});

test("config hook skips a provider whose fetch returns no models", async () => {
  const hooks = await AutoProvidersPlugin(fakeInput(), {
    providers: [
      { id: "empty", baseURL: "http://127.0.0.1:1/v1", fetchModels: true },
    ],
    fetchTimeoutMs: 200,
  });

  const cfg = { provider: {}, command: {} } as Config;
  await hooks.config?.(cfg);

  const typed = cfg as unknown as CfgShape;
  assert.equal(typed.provider["empty"], undefined);
});

test("command.execute.before handles add-provider and writes a text part", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ocp-plugin-"));
  try {
    const storePath = join(tmp, "providers.json");
    const hooks = await AutoProvidersPlugin(fakeInput(), { configFile: storePath });

    const before = hooks["command.execute.before"];
    assert.ok(before, "command.execute.before hook should be defined");

    type BeforeOutput = Parameters<NonNullable<Hooks["command.execute.before"]>>[1];
    const output: BeforeOutput = { parts: [] };
    await before(
      { command: "add-provider", arguments: "x http://127.0.0.1:1/v1", sessionID: "s" },
      output,
    );

    const textPart = output.parts.find((part) => part.type === "text");
    assert.ok(textPart, "expected a text part in output.parts");
    assert.ok(textPart.text?.includes("Restart opencode"));
    assert.ok(textPart.text?.includes("Added provider \"x\""));

    assert.ok(
      readFileSync(storePath, "utf8").includes("\"x\""),
      "the add-provider command should persist to the store file",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("command.execute.before handles providers", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ocp-plugin-"));
  try {
    const storePath = join(tmp, "providers.json");
    const hooks = await AutoProvidersPlugin(fakeInput(), { configFile: storePath });

    const before = hooks["command.execute.before"];
    assert.ok(before);

    type BeforeOutput = Parameters<NonNullable<Hooks["command.execute.before"]>>[1];
    const output: BeforeOutput = { parts: [] };
    await before(
      { command: "providers", arguments: "", sessionID: "s" },
      output,
    );

    const textPart = output.parts.find((part) => part.type === "text");
    assert.ok(textPart);
    assert.ok(textPart.text?.includes("No OpenAI-compatible providers configured"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
