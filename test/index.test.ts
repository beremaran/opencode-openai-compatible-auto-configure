import test from "node:test";
import assert from "node:assert/strict";
import AutoProvidersPlugin, { AutoProvidersPlugin as Named } from "../src/index.ts";

test("plugin entry exports the factory as both the default and named export", () => {
  assert.equal(typeof AutoProvidersPlugin, "function");
  assert.equal(typeof Named, "function");
  assert.equal(AutoProvidersPlugin, Named);
});
