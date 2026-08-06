#!/usr/bin/env bash
# End-to-end test: loads the plugin into the REAL opencode binary and asserts
# that `opencode models` lists the models discovered from the mock server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"

if [ ! -x "$BIN" ]; then
  echo "FAIL: opencode binary not found at $BIN (set OPENCODE_BIN to override)" >&2
  exit 1
fi

if [ -n "${E2E_PORT:-}" ]; then
  PORT="$E2E_PORT"
else
  PORT=$((20000 + RANDOM % 10000))
fi

TMP="$(mktemp -d)"
MOCK_LOG="$TMP/mock.log"
MOCK_PID=""

cleanup() {
  if [ -n "$MOCK_PID" ] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

PORT="$PORT" node "$ROOT/test/mock-server.mjs" >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!

ready=0
for _ in $(seq 1 50); do
  if grep -q READY "$MOCK_LOG" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "FAIL: mock server did not become ready on port $PORT" >&2
  cat "$MOCK_LOG" >&2
  exit 1
fi

cat > "$TMP/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": [["file://$ROOT/src/index.ts", { "providers": [ { "id": "e2eprov", "name": "E2E Provider", "baseURL": "http://127.0.0.1:$PORT/v1", "fetchModels": true } ] }]]
}
EOF

echo "Running opencode models against e2eprov on port $PORT..."
cd "$TMP"
OUTPUT="$(OPENCODE_DISABLE_AUTOUPDATE=1 "$BIN" models 2>&1 || true)"

if ! printf '%s\n' "$OUTPUT" | grep -q "e2eprov/e2e-ultra"; then
  echo "FAIL: e2eprov/e2e-ultra not found in models output" >&2
  printf '%s\n' "$OUTPUT" | grep "e2eprov" || echo "(no e2eprov lines at all)" >&2
  exit 1
fi

if ! printf '%s\n' "$OUTPUT" | grep -q "e2eprov/e2e-mini"; then
  echo "FAIL: e2eprov/e2e-mini not found in models output" >&2
  printf '%s\n' "$OUTPUT" | grep "e2eprov" || echo "(no e2eprov lines at all)" >&2
  exit 1
fi

echo "PASS: opencode models listed e2eprov/e2e-ultra and e2eprov/e2e-mini"
