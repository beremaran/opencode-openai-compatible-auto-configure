import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../index.ts";

test("package entry exports an OpenCode 2 plugin definition", () => {
  assert.equal(plugin.id, "@beremaran/opencode-openai-compatible-auto-configure");
  assert.equal(typeof plugin.setup, "function");
});
