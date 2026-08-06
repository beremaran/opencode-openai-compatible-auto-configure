import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import {
  buildModelEntries,
  detectLimit,
  fetchModels,
  globMatch,
  parseModelResponse,
} from "../src/models.ts";
import type { DiscoveredModel, Logger, ResolvedProvider } from "../src/types.ts";

const noopLogger: Logger = () => undefined;

function provider(overrides: Partial<ResolvedProvider> = {}): ResolvedProvider {
  return {
    id: "p",
    baseURL: "http://127.0.0.1:1/v1",
    fetchModels: true,
    timeoutMs: 5000,
    ...overrides,
  } as ResolvedProvider;
}

type MockServer = { port: number; close: () => Promise<void> };

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<MockServer> {
  const server = createServer(handler);
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function assertLimitInvariant(entries: Record<string, object>): void {
  for (const [id, entry] of Object.entries(entries)) {
    const record = entry as Record<string, unknown>;
    if (record.limit !== undefined) {
      const limit = record.limit as { context?: number; output?: number };
      assert.ok(
        Number.isSafeInteger(limit.context) && (limit.context ?? 0) > 0,
        `limit.context must be a positive integer for ${id}`,
      );
      assert.ok(
        Number.isSafeInteger(limit.output) && (limit.output ?? 0) > 0,
        `limit.output must be a positive integer for ${id}`,
      );
    }
  }
}

// --- fetchModels against a real local HTTP server ---------------------------

test("fetchModels parses {data:[...]} and detects context/output limits", async () => {
  const server = await startServer((req, res) => {
    assert.equal(req.url, "/v1/models");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "alpha-1" },
          { id: "beta-2", context_length: 32000, max_output_tokens: 4096 },
        ],
      }),
    );
  });
  try {
    const models = await fetchModels(
      provider({ baseURL: `http://127.0.0.1:${server.port}/v1` }),
      noopLogger,
    );
    assert.ok(models);
    assert.equal(models.length, 2);
    assert.equal(models[0]?.id, "alpha-1");
    assert.equal(models[1]?.id, "beta-2");
    assert.equal(models[1]?.limit?.context, 32000);
    assert.equal(models[1]?.limit?.output, 4096);
  } finally {
    await server.close();
  }
});

test("fetchModels accepts the {models:[...]} shape", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ id: "m1" }, { id: "m2" }] }));
  });
  try {
    const models = await fetchModels(
      provider({ baseURL: `http://127.0.0.1:${server.port}/v1` }),
      noopLogger,
    );
    assert.ok(models);
    assert.deepEqual(
      models.map((m) => m.id),
      ["m1", "m2"],
    );
  } finally {
    await server.close();
  }
});

test("fetchModels returns null on non-2xx without throwing", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nope");
  });
  try {
    const models = await fetchModels(
      provider({ baseURL: `http://127.0.0.1:${server.port}/v1` }),
      noopLogger,
    );
    assert.equal(models, null);
  } finally {
    await server.close();
  }
});

test("fetchModels returns null quickly on timeout (server never responds)", async () => {
  const server = await startServer((_req, _res) => {
    // Intentionally never respond.
  });
  try {
    const started = Date.now();
    const models = await fetchModels(
      provider({
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        timeoutMs: 200,
      }),
      noopLogger,
    );
    const elapsed = Date.now() - started;
    assert.equal(models, null);
    assert.ok(elapsed < 5000, `expected a quick timeout, took ${elapsed}ms`);
  } finally {
    await server.close();
  }
});

test("fetchModels honors modelsURL override", async () => {
  const server = await startServer((req, res) => {
    assert.equal(req.url, "/custom/models");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "only" }] }));
  });
  try {
    const models = await fetchModels(
      provider({
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        modelsURL: `http://127.0.0.1:${server.port}/custom/models`,
      }),
      noopLogger,
    );
    assert.ok(models);
    assert.deepEqual(
      models.map((m) => m.id),
      ["only"],
    );
  } finally {
    await server.close();
  }
});

test("fetchModels returns null on unparseable body", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("definitely not json");
  });
  try {
    const models = await fetchModels(
      provider({ baseURL: `http://127.0.0.1:${server.port}/v1` }),
      noopLogger,
    );
    assert.equal(models, null);
  } finally {
    await server.close();
  }
});

// --- parseModelResponse ------------------------------------------------------

test("parseModelResponse tolerates all documented shapes", () => {
  assert.deepEqual(parseModelResponse('{"data":[{"id":"a"}]}')?.map((m) => m.id), [
    "a",
  ]);
  assert.deepEqual(parseModelResponse('{"models":[{"id":"b"}]}')?.map((m) => m.id), [
    "b",
  ]);
  assert.deepEqual(parseModelResponse('{"x":{},"y":{"name":"Y"}}')?.map((m) => m.id), [
    "x",
    "y",
  ]);
  assert.deepEqual(parseModelResponse('{"data":[{"no_id":true}]}'), []);
  assert.equal(parseModelResponse("not json"), null);
  assert.equal(parseModelResponse("[1,2,3]"), null);
  assert.equal(parseModelResponse('"a bare string"'), null);
});

test("parseModelResponse reads limits from bare map entries", () => {
  const models = parseModelResponse('{"m": {"context_length": 1000, "max_output_tokens": 500}}');
  assert.ok(models);
  assert.equal(models[0]?.id, "m");
  assert.equal(models[0]?.limit?.context, 1000);
  assert.equal(models[0]?.limit?.output, 500);
});

// --- detectLimit ---------------------------------------------------------------

test("detectLimit recognizes known keys and a nested limit object", () => {
  assert.deepEqual(detectLimit({ context_length: 1000, max_output_tokens: 500 }), {
    context: 1000,
    output: 500,
  });
  assert.deepEqual(detectLimit({ max_context: 2000, max_tokens: 1000 }), {
    context: 2000,
    output: 1000,
  });
  assert.deepEqual(detectLimit({ limit: { context: 3000, output: 1500 } }), {
    context: 3000,
    output: 1500,
  });
  assert.deepEqual(
    detectLimit({ limit: { context: 3000, output: 1500 }, context_length: 9999 }),
    { context: 9999, output: 1500 },
  );
  assert.deepEqual(detectLimit({}), {});
  assert.deepEqual(detectLimit({ context_length: 0 }), {});
  assert.deepEqual(detectLimit({ context_length: -5 }), {});
  assert.deepEqual(detectLimit({ context_length: "32000" }), { context: 32000 });
  assert.deepEqual(detectLimit({ context_length: 1.5 }), {});
});

// --- buildModelEntries ----------------------------------------------------------

test("buildModelEntries defaults temperature and tool_call, name defaults to id", () => {
  const entries = buildModelEntries([{ id: "alpha-1" }], provider());
  assert.deepEqual(entries["alpha-1"], { temperature: true, tool_call: true });
  assert.equal(Array.isArray(entries), false);
});

test("buildModelEntries uses the discovered name when present", () => {
  const entries = buildModelEntries([{ id: "beta-2", name: "Beta Two" }], provider());
  const entry = entries["beta-2"] as Record<string, unknown>;
  assert.equal(entry.name, "Beta Two");
});

test("buildModelEntries merges staticModels for ids the server did not list", () => {
  const entries = buildModelEntries(
    [{ id: "a" }],
    provider({ staticModels: { s1: { name: "S1" } } }),
  );
  assert.deepEqual(Object.keys(entries).sort(), ["a", "s1"]);
  const s1 = entries["s1"] as Record<string, unknown>;
  assert.equal(s1.name, "S1");
  assert.equal(s1.temperature, true);
  assert.equal(s1.tool_call, true);
});

test("buildModelEntries honors staticModels when discovery is null", () => {
  const entries = buildModelEntries(
    null,
    provider({ staticModels: { only: { name: "Only" } } }),
  );
  assert.deepEqual(Object.keys(entries), ["only"]);
});

test("buildModelEntries applies the include glob filter", () => {
  const models: DiscoveredModel[] = [
    { id: "alpha-1" },
    { id: "alpha-2" },
    { id: "beta-1" },
  ];
  const entries = buildModelEntries(models, provider({ include: ["alpha-*"] }));
  assert.deepEqual(Object.keys(entries).sort(), ["alpha-1", "alpha-2"]);
});

test("buildModelEntries applies the exclude filter", () => {
  const models: DiscoveredModel[] = [
    { id: "alpha-1" },
    { id: "alpha-2" },
    { id: "beta-1" },
  ];
  const entries = buildModelEntries(models, provider({ exclude: ["alpha-2"] }));
  assert.deepEqual(Object.keys(entries).sort(), ["alpha-1", "beta-1"]);
});

test("buildModelEntries deep-merges override options and applies shallow booleans", () => {
  const source = provider({
    staticModels: { "alpha-1": { options: { a: 1, nested: { x: 1 } } } },
    overrides: {
      "alpha-1": { options: { b: 2, nested: { y: 2 } }, temperature: false },
    },
  });
  const entries = buildModelEntries([{ id: "alpha-1" }], source);
  const entry = entries["alpha-1"] as Record<string, unknown>;
  assert.equal(entry.temperature, false);
  assert.deepEqual(entry.options, { a: 1, nested: { x: 1, y: 2 }, b: 2 });
});

test("buildModelEntries emits a full limit combining detected context with default output", () => {
  const source = provider({ defaultLimit: { output: 500 } });
  const entries = buildModelEntries([{ id: "m", vendor: { context_length: 1000 } }], source);
  const entry = entries["m"] as Record<string, unknown>;
  assert.deepEqual(entry.limit, { context: 1000, output: 500 });
});

test("buildModelEntries omits the limit key when nothing is known", () => {
  const entries = buildModelEntries([{ id: "m", vendor: {} }], provider());
  const entry = entries["m"] as Record<string, unknown>;
  assert.equal("limit" in entry, false);
});

test("buildModelEntries emits a limit from both vendor keys", () => {
  const entries = buildModelEntries(
    [{ id: "m", vendor: { context_length: 32000, max_output_tokens: 4096 } }],
    provider(),
  );
  const entry = entries["m"] as Record<string, unknown>;
  assert.deepEqual(entry.limit, { context: 32000, output: 4096 });
});

test("buildModelEntries lets an override limit replace the computed limit", () => {
  const source = provider({ overrides: { m: { limit: { context: 100, output: 50 } } } });
  const entries = buildModelEntries(
    [{ id: "m", vendor: { context_length: 32000, max_output_tokens: 4096 } }],
    source,
  );
  const entry = entries["m"] as Record<string, unknown>;
  assert.deepEqual(entry.limit, { context: 100, output: 50 });
});

test("buildModelEntries never emits more than 500 entries", () => {
  const many: DiscoveredModel[] = Array.from({ length: 600 }, (_, i) => ({ id: `m-${i}` }));
  const entries = buildModelEntries(many, provider());
  assert.ok(Object.keys(entries).length <= 500);
  assert.equal(Object.keys(entries).length, 500);
});

test("buildModelEntries keeps the limit schema invariant across varied inputs", () => {
  const entries = buildModelEntries(
    [
      { id: "no-limit", vendor: {} },
      { id: "both", vendor: { context_length: 100, max_output_tokens: 50 } },
      { id: "ctx-only", vendor: { context_length: 1000 } },
    ],
    provider({
      defaultLimit: { output: 500 },
      staticModels: { "no-limit": {}, "both": { name: "B" }, "ctx-only": {} },
      overrides: {
        "both": { limit: { context: 64, output: 32 } },
        "ctx-only": { temperature: false },
      },
    }),
  );
  assertLimitInvariant(entries);
});

// --- globMatch -------------------------------------------------------------------

test("globMatch handles star, literal, anchors, and regex-escaping", () => {
  assert.equal(globMatch("*", "anything"), true);
  assert.equal(globMatch("alpha-*", "alpha-1"), true);
  assert.equal(globMatch("alpha-*", "beta-1"), false);
  assert.equal(globMatch("*mini", "ultra-mini"), true);
  assert.equal(globMatch("a*b*c", "aXbYc"), true);
  assert.equal(globMatch("a.b", "a.b"), true);
  assert.equal(globMatch("a.b", "axb"), false);
  assert.equal(globMatch("", ""), true);
  assert.equal(globMatch("", "x"), false);
  assert.equal(globMatch("m[0-9]", "m[0-9]"), true);
  assert.equal(globMatch("m[0-9]", "m0"), false);
});
