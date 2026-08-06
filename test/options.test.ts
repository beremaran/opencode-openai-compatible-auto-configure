import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOptions } from "../src/options.ts";
import type { Logger, ProviderSource } from "../src/types.ts";

const logs: Array<[string, string]> = [];
const logger: Logger = (level, message) => {
  logs.push([level, message]);
};

test.beforeEach(() => {
  logs.length = 0;
});

test("merges option providers then store providers (store wins on id)", () => {
  const opts = normalizeOptions(
    {
      providers: [
        { id: "a", baseURL: "http://opt-a/v1" },
        { id: "b", baseURL: "http://opt-b/v1" },
      ],
    },
    [
      { id: "b", baseURL: "http://store-b/v1" },
      { id: "c", baseURL: "http://store-c/v1" },
    ],
    "/tmp/fallback.json",
    logger,
  );
  assert.deepEqual(
    opts.sources.map((s) => s.id),
    ["a", "b", "c"],
  );
  const b = opts.sources.find((s) => s.id === "b");
  assert.ok(b);
  assert.equal(b.baseURL, "http://store-b/v1");
});

test("skips entries missing id or baseURL", () => {
  const opts = normalizeOptions(
    {
      providers: [
        { id: "good", baseURL: "http://g/v1" },
        { baseURL: "http://noid/v1" },
        { id: "nobase" },
        { id: "", baseURL: "http://emptyid/v1" },
        "not-an-object",
        42,
      ],
    },
    [{ id: "bad-store" } as ProviderSource],
    "/tmp/fallback.json",
    logger,
  );
  assert.deepEqual(
    opts.sources.map((s) => s.id),
    ["good"],
  );
  assert.ok(logs.some(([level, message]) => level === "warn" && /malformed/i.test(message)));
});

test("applies env interpolation to baseURL and apiKey", () => {
  process.env.OCP_OPTIONS_HOST = "envhost";
  try {
    const opts = normalizeOptions(
      {
        providers: [
          {
            id: "a",
            baseURL: "http://{env:OCP_OPTIONS_HOST}/v1",
            apiKey: "${OCP_OPTIONS_HOST}",
          },
        ],
      },
      [],
      "/tmp/fallback.json",
      logger,
    );
    assert.equal(opts.sources[0]?.baseURL, "http://envhost/v1");
    assert.equal(opts.sources[0]?.apiKey, "envhost");
  } finally {
    delete process.env.OCP_OPTIONS_HOST;
  }
});

test("env:false disables interpolation", () => {
  process.env.OCP_OPTIONS_HOST = "envhost";
  try {
    const opts = normalizeOptions(
      {
        env: false,
        providers: [{ id: "a", baseURL: "http://{env:OCP_OPTIONS_HOST}/v1" }],
      },
      [],
      "/tmp/fallback.json",
      logger,
    );
    assert.equal(opts.env, false);
    assert.equal(opts.sources[0]?.baseURL, "http://{env:OCP_OPTIONS_HOST}/v1");
  } finally {
    delete process.env.OCP_OPTIONS_HOST;
  }
});

test("applies npm default, fetchModels default true, fetchTimeoutMs default 10000", () => {
  const opts = normalizeOptions(
    { providers: [{ id: "a", baseURL: "http://x/v1" }] },
    [],
    "/tmp/fallback.json",
    logger,
  );
  assert.equal(opts.sources[0]?.npm, "@ai-sdk/openai-compatible");
  assert.equal(opts.sources[0]?.fetchModels, true);
  assert.equal(opts.sources[0]?.timeoutMs, 10000);
  assert.equal(opts.fetchTimeoutMs, 10000);
  assert.equal(opts.env, true);
});

test("respects explicit fetchModels false and fetchTimeoutMs", () => {
  const opts = normalizeOptions(
    {
      providers: [{ id: "a", baseURL: "http://x/v1", fetchModels: false }],
      fetchTimeoutMs: 500,
    },
    [],
    "/tmp/fallback.json",
    logger,
  );
  assert.equal(opts.sources[0]?.fetchModels, false);
  assert.equal(opts.fetchTimeoutMs, 500);
  assert.equal(opts.sources[0]?.timeoutMs, 500);
});

test("dedupes by id last-wins within option providers", () => {
  const opts = normalizeOptions(
    {
      providers: [
        { id: "dup", baseURL: "http://one/v1" },
        { id: "dup", baseURL: "http://two/v1" },
      ],
    },
    [],
    "/tmp/fallback.json",
    logger,
  );
  assert.equal(opts.sources.length, 1);
  assert.equal(opts.sources[0]?.baseURL, "http://two/v1");
});

test("exposes model and smallModel options", () => {
  const opts = normalizeOptions(
    { model: "p/m", smallModel: "p/s" },
    [],
    "/tmp/fallback.json",
    logger,
  );
  assert.equal(opts.model, "p/m");
  assert.equal(opts.smallModel, "p/s");
});

test("resolves storePath from configFile and falls back otherwise", () => {
  const opts = normalizeOptions(
    { configFile: "/tmp/custom.json" },
    [],
    "/tmp/fallback.json",
    logger,
  );
  assert.equal(opts.storePath, "/tmp/custom.json");

  const fallback = normalizeOptions({}, [], "/tmp/fallback.json", logger);
  assert.equal(fallback.storePath, "/tmp/fallback.json");
});

test("tolerates non-object raw options", () => {
  const opts = normalizeOptions("not an object", [], "/tmp/fallback.json", logger);
  assert.deepEqual(opts.sources, []);
  assert.equal(opts.storePath, "/tmp/fallback.json");
});
