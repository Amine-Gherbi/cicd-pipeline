#!/usr/bin/env bash
# smoke.sh — five named assertions against the locally running service.
#
# Prints exactly one line per assertion (PASS/FAIL) and exits non-zero if any
# failed. It is the gate release-local.sh runs after `wait` proved health.
#
#   1. GET  /health                     -> 200 {status:"ok"}
#   2. GET  /ready                      -> 200, DB reachable + no pending migration
#   3. POST /invoices (bearer token)    -> 401 without the seeded token, 201 with it
#   4. GET  /invoices/<random-uuid>     -> 404 {error:{code:"not_found"}}, no stack
#   5. GET  /ready latency              -> p95 < 300 ms, 5 warm samples after one warm-up
#
# PORT: 8787 on this host (8080 is inside Windows' excluded TCP 8001-8300).
# The smoke token is read from .env.local; service.sh seeds it when the service
# starts. Override the endpoint host with SMOKE_HOST if needed.
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

load_env() {
  local file line
  for file in "$REPO_ROOT/.env" "$REPO_ROOT/.env.local"; do
    [ -f "$file" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      case "$line" in
        '' | '#'*) continue ;;
        *=*) export "$line" ;;
      esac
    done < "$file"
  done
}

load_env
PORT="${RELEASE_PORT:-8787}"
HOST="${SMOKE_HOST:-127.0.0.1}"
BASE="http://$HOST:$PORT"
CURRENT_LINK="$REPO_ROOT/current"
CURRENT_POINTER="$REPO_ROOT/current.txt"
TMP_DIR="$REPO_ROOT/.deploy"
mkdir -p "$TMP_DIR"
# Repo-relative: Windows Node misreads MSYS absolute paths (/p/... -> P:\p\...).
BODY=".deploy/smoke-body.$$"
trap 'rm -f "$BODY"' EXIT

FAILURES=0

pass() {
  printf 'PASS %s\n' "$1"
}

fail() {
  printf 'FAIL %s — %s\n' "$1" "$2"
  FAILURES=$((FAILURES + 1))
}

# http_code URL [curl args...]
# Curl's internal "-o /dev/null" fails with CURLE_WRITE_ERROR (23) in this Git
# Bash build even for a 200, so probe with a real file and trust the status code.
http_code() {
  local url="$1"
  shift
  local out probe="$TMP_DIR/.http-code.$$"
  out=$(curl -s -o "$probe" -w '%{http_code}' "$@" "$url" 2>/dev/null)
  rm -f "$probe"
  case "$out" in
    [0-9][0-9][0-9]) printf '%s' "$out" ;;
    *) printf '000' ;;
  esac
}

json_equals() {
  node -e '
const fs = require("node:fs");
const [file, path, expected] = process.argv.slice(1);
let value = JSON.parse(fs.readFileSync(file, "utf8"));
for (const key of path.split(".")) value = value?.[key];
process.exit(String(value) === expected ? 0 : 1);
' "$1" "$2" "$3"
}

body_summary() {
  node -e '
const fs = require("node:fs");
const text = fs.readFileSync(process.argv[1], "utf8").replace(/\s+/g, " ").trim();
process.stdout.write(text.slice(0, 160));
' "$1" 2>/dev/null
}

echo "smoke: $BASE (release $(cat "$CURRENT_LINK" 2>/dev/null || cat "$CURRENT_POINTER" 2>/dev/null || echo unknown))"

# 1. /health
code=$(http_code "$BASE/health")
if [ "$code" = "200" ] && curl -sS -o "$BODY" "$BASE/health" 2>/dev/null && json_equals "$BODY" status ok; then
  pass "1/5 /health 200 {status:ok}"
else
  fail "1/5 /health 200 {status:ok}" "status=$code body=$(body_summary "$BODY")"
fi

# 2. /ready — DB reachable and no pending migration
code=$(http_code "$BASE/ready")
if [ "$code" = "200" ] &&
  curl -sS -o "$BODY" "$BASE/ready" 2>/dev/null &&
  json_equals "$BODY" checks.database ok &&
  json_equals "$BODY" checks.migrations ok; then
  pass "2/5 /ready 200 database+ok migrations+ok"
else
  fail "2/5 /ready 200 database+ok migrations+ok" "status=$code body=$(body_summary "$BODY")"
fi

# 3. authenticated POST /invoices (proves the token is required and accepted)
payload='{"customerId":"smoke-tenant","amountCents":1000,"currency":"USD","description":"release smoke"}'
if [ -z "${SMOKE_TOKEN:-}" ]; then
  fail "3/5 POST /invoices authenticated" "SMOKE_TOKEN is unset (start via service.sh to seed it)"
else
  anon=$(http_code "$BASE/invoices" -X POST -H 'content-type: application/json' -d "$payload")
  auth=$(http_code "$BASE/invoices" -X POST -H 'content-type: application/json' \
    -H "authorization: Bearer $SMOKE_TOKEN" -d "$payload")
  if [ "$anon" != "401" ]; then
    fail "3/5 POST /invoices authenticated" "unauthenticated request returned $anon, expected 401"
  elif [ "$auth" != "201" ]; then
    fail "3/5 POST /invoices authenticated" "authenticated request returned $auth, expected 201"
  elif ! curl -sS -o "$BODY" -X POST -H 'content-type: application/json' \
    -H "authorization: Bearer $SMOKE_TOKEN" -d "$payload" "$BASE/invoices" 2>/dev/null; then
    fail "3/5 POST /invoices authenticated" "could not read the 201 response"
  elif ! node -e '
const fs = require("node:fs");
const id = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).id ?? "";
process.exit(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? 0 : 1);
' "$BODY"; then
    fail "3/5 POST /invoices authenticated" "201 response has no uuid id: $(body_summary "$BODY")"
  else
    pass "3/5 POST /invoices 401 unauthenticated, 201 authenticated"
  fi
fi

# 4. random uuid -> 404 not_found with no stack trace
uuid=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
code=$(http_code "$BASE/invoices/$uuid")
if [ "$code" = "404" ] &&
  curl -sS -o "$BODY" "$BASE/invoices/$uuid" 2>/dev/null &&
  json_equals "$BODY" error.code not_found &&
  ! grep -qiE 'stack|\.ts:' "$BODY"; then
  pass "4/5 GET /invoices/<random-uuid> 404 not_found, no stack"
else
  fail "4/5 GET /invoices/<random-uuid> 404 not_found, no stack" "status=$code body=$(body_summary "$BODY")"
fi

# 5. p95 < 300 ms over 5 warm samples after one warm-up
latency_out="$TMP_DIR/.latency.$$"
curl -s -o "$latency_out" "$BASE/ready" 2>/dev/null
samples=""
latency_ok=1
for _ in 1 2 3 4 5; do
  t=$(curl -s -o "$latency_out" -w '%{time_total}' "$BASE/ready" 2>/dev/null)
  if [ -z "$t" ]; then
    latency_ok=0
    break
  fi
  samples="$samples $t"
done
rm -f "$latency_out"

if [ "$latency_ok" -eq 1 ]; then
  p95=$(node -e '
const values = process.argv.slice(1).map(Number).sort((a, b) => a - b);
process.stdout.write(String(values[Math.ceil(0.95 * values.length) - 1]));
' $samples)
  p95_ms=$(node -e 'process.stdout.write((Number(process.argv[1]) * 1000).toFixed(1))' "$p95")
  if node -e 'process.exit(Number(process.argv[1]) < 0.3 ? 0 : 1)' "$p95"; then
    pass "5/5 /ready p95 ${p95_ms}ms < 300ms (5 warm samples)"
  else
    fail "5/5 /ready p95 < 300ms" "p95=${p95_ms}ms"
  fi
else
  fail "5/5 /ready p95 < 300ms" "latency sample failed"
fi

if [ "$FAILURES" -gt 0 ]; then
  echo "smoke: FAIL ($FAILURES of 5 assertions)" >&2
  exit 1
fi

echo "smoke: ok (5 of 5 assertions)"
