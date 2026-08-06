import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStore, saveStore } from "../src/store.ts";
import type { Logger } from "../src/types.ts";

const logs: string[] = [];
const logger: Logger = (_level, message) => {
  logs.push(message);
};

const dirs: string[] = [];

test.beforeEach(() => {
  logs.length = 0;
});

test.afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ocp-store-"));
  dirs.push(dir);
  return dir;
}

test("loadStore: missing file yields empty providers without warnings", () => {
  const dir = tempDir();
  const result = loadStore(join(dir, "nope.json"), logger);
  assert.deepEqual(result.providers, []);
  assert.deepEqual(logs, []);
});

test("loadStore: corrupt JSON warns and yields empty providers (never throws)", () => {
  const dir = tempDir();
  const path = join(dir, "store.json");
  writeFileSync(path, "{not valid json", "utf8");
  const result = loadStore(path, logger);
  assert.deepEqual(result.providers, []);
  assert.ok(logs.some((message) => /not valid JSON/i.test(message)));
});

test("loadStore: wrong top-level shapes yield empty providers", () => {
  const dir = tempDir();
  const cases: Array<[string, string]> = [
    ["object.json", JSON.stringify({ foo: 1 })],
    ["providers-string.json", JSON.stringify({ providers: "nope" })],
    ["array.json", JSON.stringify([1, 2, 3])],
  ];
  for (const [name, content] of cases) {
    const path = join(dir, name);
    writeFileSync(path, content, "utf8");
    const result = loadStore(path, logger);
    assert.deepEqual(result.providers, [], `shape ${name} should be ignored`);
  }
  assert.ok(logs.some((message) => /unexpected shape/i.test(message)));
});

test("loadStore: valid file round-trips", () => {
  const dir = tempDir();
  const path = join(dir, "store.json");
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      providers: [{ id: "p", baseURL: "http://x/v1" }],
    }),
    "utf8",
  );
  const result = loadStore(path, logger);
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0]?.id, "p");
  assert.equal(result.providers[0]?.baseURL, "http://x/v1");
});

test("loadStore: skips malformed entries inside a valid file", () => {
  const dir = tempDir();
  const path = join(dir, "store.json");
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      providers: [
        { id: "ok", baseURL: "http://x/v1" },
        { id: "no-baseurl" },
        "junk",
      ],
    }),
    "utf8",
  );
  const result = loadStore(path, logger);
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0]?.id, "ok");
  assert.ok(logs.some((message) => /malformed/i.test(message)));
});

test("saveStore: writes the file atomically (tmp + rename)", () => {
  const dir = tempDir();
  const path = join(dir, "providers.json");
  saveStore(
    path,
    { version: 1, providers: [{ id: "p", baseURL: "http://x/v1" }] },
    logger,
  );
  assert.ok(existsSync(path));
  assert.equal(existsSync(`${path}.tmp`), false);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    version: number;
    providers: Array<{ id: string }>;
  };
  assert.equal(parsed.version, 1);
  assert.equal(parsed.providers.length, 1);
  assert.equal(parsed.providers[0]?.id, "p");
});

test("saveStore: creates nested directories (mkdir -p)", () => {
  const dir = tempDir();
  const path = join(dir, "a", "b", "providers.json");
  saveStore(path, { version: 1, providers: [] }, logger);
  assert.ok(existsSync(path));
});

test("saveStore: never throws on an unwritable path and logs the failure", () => {
  const dir = tempDir();
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "i am a file", "utf8");
  const path = join(blocker, "providers.json");
  assert.doesNotThrow(() => saveStore(path, { version: 1, providers: [] }, logger));
  assert.ok(logs.some((message) => /Failed to write provider store/.test(message)));
});
