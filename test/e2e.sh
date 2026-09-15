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

if [ -n "${E2E_SERVER_PORT:-}" ]; then
  SERVER_PORT="$E2E_SERVER_PORT"
else
  SERVER_PORT=$((30000 + RANDOM % 10000))
fi

SERVER_PASSWORD="${E2E_SERVER_PASSWORD:-e2e-test-password}"

TMP="$(mktemp -d)"
MOCK_LOG="$TMP/mock.log"
SERVER_LOG="$TMP/server.log"
MOCK_PID=""
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
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
  "plugins": [{
    "package": "$ROOT",
    "options": {
      "providers": [
        { "id": "e2eprov", "name": "E2E Provider", "baseURL": "http://127.0.0.1:$PORT/v1", "fetchModels": true }
      ]
    }
  }]
}
EOF

# OpenCode 2's standalone models command can return before async plugin
# activation settles; use an explicit server and poll the real CLI instead.
(
  cd "$TMP"
  OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_SERVER_PASSWORD="$SERVER_PASSWORD" \
    "$BIN" serve --hostname 127.0.0.1 --port "$SERVER_PORT" >"$SERVER_LOG" 2>&1
) &
SERVER_PID=$!

server_ready=0
for _ in $(seq 1 50); do
  if curl -fsS -u "opencode:$SERVER_PASSWORD" \
    "http://127.0.0.1:$SERVER_PORT/global/health" >/dev/null 2>&1; then
    server_ready=1
    break
  fi
  sleep 0.2
done
if [ "$server_ready" -ne 1 ]; then
  echo "FAIL: opencode server did not become ready on port $SERVER_PORT" >&2
  cat "$SERVER_LOG" >&2
  exit 1
fi

echo "Running opencode models against e2eprov on port $PORT..."
cd "$TMP"
OUTPUT=""
for _ in $(seq 1 50); do
  OUTPUT="$(OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_SERVER_PASSWORD="$SERVER_PASSWORD" \
    "$BIN" models --server "http://127.0.0.1:$SERVER_PORT" --print-logs 2>&1 || true)"
  if printf '%s\n' "$OUTPUT" | grep -q "e2eprov/e2e-ultra" && \
    printf '%s\n' "$OUTPUT" | grep -q "e2eprov/e2e-mini"; then
    break
  fi
  sleep 0.2
done

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
