import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addProviderCommand,
  parseAddProviderArgs,
  providersCommand,
} from "../src/commands.ts";
import { loadStore, saveStore } from "../src/store.ts";
import type { Logger } from "../src/types.ts";

const noopLogger: Logger = () => undefined;

const dirs: string[] = [];

test.afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ocp-cmd-"));
  dirs.push(dir);
  return dir;
}

function parseOk(raw: string) {
  const parsed = parseAddProviderArgs(raw);
  if (!parsed.ok) throw new Error(`expected parse ok, got: ${parsed.error}`);
  return parsed.source;
}

function parseErr(raw: string): string {
  const parsed = parseAddProviderArgs(raw);
  if (parsed.ok) throw new Error("expected parse failure");
  return parsed.error;
}

// --- parseAddProviderArgs --------------------------------------------------------

test("parseAddProviderArgs: valid minimal invocation", () => {
  const source = parseOk("myprov http://x/v1");
  assert.equal(source.id, "myprov");
  assert.equal(source.baseURL, "http://x/v1");
  assert.equal(source.apiKey, undefined);
});

test("parseAddProviderArgs: optional positional apiKey", () => {
  const source = parseOk("myprov http://x/v1 my-key");
  assert.equal(source.apiKey, "my-key");
});

test("parseAddProviderArgs: missing baseURL", () => {
  assert.match(parseErr("myprov"), /Missing id or baseURL/);
});

test("parseAddProviderArgs: bad id characters", () => {
  assert.match(parseErr("bad/id http://x/v1"), /must match/);
});

test("parseAddProviderArgs: baseURL must be http(s)", () => {
  assert.match(parseErr("myprov not-a-url"), /must start with http/);
});

test("parseAddProviderArgs: quoted name with spaces", () => {
  const source = parseOk('myprov http://x/v1 --name "My Provider"');
  assert.equal(source.name, "My Provider");
});

test("parseAddProviderArgs: --context and --output integers", () => {
  const source = parseOk("myprov http://x/v1 --context 32000 --output 4096");
  assert.deepEqual(source.defaultLimit, { context: 32000, output: 4096 });
});

test("parseAddProviderArgs: --no-fetch disables fetching", () => {
  const source = parseOk("myprov http://x/v1 --no-fetch");
  assert.equal(source.fetchModels, false);
});

test("parseAddProviderArgs: rejects bad flags and values", () => {
  assert.match(parseErr("myprov http://x/v1 --context -5"), /positive integer/);
  assert.match(parseErr("myprov http://x/v1 --context nope"), /positive integer/);
  assert.match(parseErr("myprov http://x/v1 --output 0"), /positive integer/);
  assert.match(parseErr("myprov http://x/v1 --bogus"), /Unknown option/);
  assert.match(parseErr("myprov http://x/v1 --name"), /--name requires a value/);
});

// --- addProviderCommand -------------------------------------------------------------

test("addProviderCommand appends a new id and writes the store", () => {
  const dir = tempDir();
  const storePath = join(dir, "providers.json");
  const message = addProviderCommand("newprov http://x/v1", storePath, noopLogger);
  assert.match(message, /Added provider "newprov"/);
  assert.match(message, /Store: .*providers\.json/);
  assert.match(message, /Restart opencode/);

  const { providers } = loadStore(storePath, noopLogger);
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.id, "newprov");
  assert.equal(providers[0]?.baseURL, "http://x/v1");
});

test("addProviderCommand replaces an existing id", () => {
  const dir = tempDir();
  const storePath = join(dir, "providers.json");
  addProviderCommand("newprov http://x/v1", storePath, noopLogger);
  addProviderCommand("newprov http://y/v2", storePath, noopLogger);

  const { providers } = loadStore(storePath, noopLogger);
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.baseURL, "http://y/v2");
});

test("addProviderCommand leaves the store untouched on invalid arguments", () => {
  const dir = tempDir();
  const storePath = join(dir, "providers.json");
  addProviderCommand("newprov http://x/v1", storePath, noopLogger);

  const message = addProviderCommand("", storePath, noopLogger);
  assert.ok(message.startsWith("⚠️"));

  const { providers } = loadStore(storePath, noopLogger);
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.baseURL, "http://x/v1");
});

// --- providersCommand ---------------------------------------------------------------

test("providersCommand lists the provider and store path even when the live fetch fails", async () => {
  const dir = tempDir();
  const storePath = join(dir, "providers.json");
  saveStore(
    storePath,
    {
      version: 1,
      providers: [{ id: "myprov", baseURL: "http://127.0.0.1:1/v1" }],
    },
    noopLogger,
  );

  const out = await providersCommand(storePath, noopLogger);
  assert.ok(out.includes("myprov"));
  assert.ok(out.includes("http://127.0.0.1:1/v1"));
  assert.ok(out.includes(`Store: ${storePath}`));
  assert.ok(out.includes("Restart opencode"));
});

test("providersCommand reports a static model count when fetch is off", async () => {
  const dir = tempDir();
  const storePath = join(dir, "providers.json");
  saveStore(
    storePath,
    {
      version: 1,
      providers: [
        { id: "staticprov", baseURL: "http://x/v1", fetchModels: false, staticModels: { s1: {} } },
      ],
    },
    noopLogger,
  );

  const out = await providersCommand(storePath, noopLogger);
  assert.ok(out.includes("staticprov"));
  assert.ok(out.includes("models: 1 (static)"));
});

test("providersCommand handles an empty store", async () => {
  const dir = tempDir();
  const storePath = join(dir, "providers.json");
  const out = await providersCommand(storePath, noopLogger);
  assert.ok(out.includes("No OpenAI-compatible providers configured"));
});
