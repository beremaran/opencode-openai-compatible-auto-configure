import test from "node:test";
import assert from "node:assert/strict";
import AutoProvidersPlugin, { AutoProvidersPlugin as Named } from "../src/index.ts";
import v2Plugin from "../src/v2.ts";

test("plugin entry exports the factory as both the default and named export", () => {
  assert.equal(typeof AutoProvidersPlugin, "function");
  assert.equal(typeof Named, "function");
  assert.equal(AutoProvidersPlugin, Named);
});

test("OpenCode 2 entry exports an id and setup function", () => {
  assert.equal(v2Plugin.id, "@beremaran/opencode-openai-compatible-auto-configure");
  assert.equal(typeof v2Plugin.setup, "function");
});
