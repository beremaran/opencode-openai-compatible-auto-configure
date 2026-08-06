import test from "node:test";
import assert from "node:assert/strict";
import { interpolate, interpolateHeaders } from "../src/env.ts";

const SET_KEY = "OCP_ENV_TEST_SET";
const UNSET_KEY = "OCP_ENV_TEST_UNSET";

test("interpolate replaces {env:VAR} when set", () => {
  process.env[SET_KEY] = "secret-token";
  try {
    assert.equal(interpolate(`http://{env:${SET_KEY}}/v1`, true), "http://secret-token/v1");
  } finally {
    delete process.env[SET_KEY];
  }
});

test("interpolate replaces ${VAR} when set", () => {
  process.env[SET_KEY] = "secret-token";
  try {
    assert.equal(interpolate(`api-${"$"}{${SET_KEY}}`, true), "api-secret-token");
  } finally {
    delete process.env[SET_KEY];
  }
});

test("interpolate replaces both forms in one string", () => {
  process.env[SET_KEY] = "tok";
  try {
    assert.equal(interpolate(`a{env:${SET_KEY}}b${"$"}{${SET_KEY}}c`, true), "atokbtokc");
  } finally {
    delete process.env[SET_KEY];
  }
});

test("interpolate leaves {env:VAR} literal when unset", () => {
  delete process.env[UNSET_KEY];
  assert.equal(interpolate(`http://{env:${UNSET_KEY}}/v1`, true), `http://{env:${UNSET_KEY}}/v1`);
});

test("interpolate leaves ${VAR} literal when unset", () => {
  delete process.env[UNSET_KEY];
  assert.equal(interpolate(`${"$"}{${UNSET_KEY}}`, true), `${"$"}{${UNSET_KEY}}`);
});

test("interpolate keeps set values and leaves unset literals", () => {
  process.env[SET_KEY] = "x";
  try {
    assert.equal(
      interpolate(`a{env:${SET_KEY}}b${"$"}{${UNSET_KEY}}c`, true),
      `axb${"$"}{${UNSET_KEY}}c`,
    );
  } finally {
    delete process.env[SET_KEY];
  }
});

test("interpolate is disabled when env:false", () => {
  process.env[SET_KEY] = "x";
  try {
    assert.equal(interpolate(`{env:${SET_KEY}}`, false), `{env:${SET_KEY}}`);
    assert.equal(interpolate(`${"$"}{${SET_KEY}}`, false), `${"$"}{${SET_KEY}}`);
  } finally {
    delete process.env[SET_KEY];
  }
});

test("interpolate passes through strings with no tokens", () => {
  assert.equal(interpolate("http://plain/v1", true), "http://plain/v1");
  assert.equal(interpolate("", true), "");
});

test("interpolateHeaders interpolates every value", () => {
  process.env[SET_KEY] = "tok";
  try {
    assert.deepEqual(
      interpolateHeaders(
        { "x-api-key": `{env:${SET_KEY}}`, "x-static": "yes" },
        true,
      ),
      { "x-api-key": "tok", "x-static": "yes" },
    );
  } finally {
    delete process.env[SET_KEY];
  }
});

test("interpolateHeaders keeps unset tokens literal and drops empty values", () => {
  delete process.env[UNSET_KEY];
  assert.deepEqual(interpolateHeaders({ "x-api-key": `{env:${UNSET_KEY}}` }, true), {
    "x-api-key": `{env:${UNSET_KEY}}`,
  });
});

test("interpolateHeaders returns undefined for undefined, empty, or all-empty input", () => {
  assert.equal(interpolateHeaders(undefined, true), undefined);
  assert.equal(interpolateHeaders({}, true), undefined);
  assert.equal(interpolateHeaders({ "x-api-key": "" }, true), undefined);
});
