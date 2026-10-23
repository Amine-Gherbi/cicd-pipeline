#!/usr/bin/env bash
# release-local.sh — the local release lane: build -> swap -> wait -> smoke ->
# rollback. This is deliberately separate from the CI lane (build/scan/attest/
# push); see docs/ROLLBACK.md and docs/PIPELINE.md.
#
#   ./scripts/release-local.sh <sha> [label]   build and deploy
#   ./scripts/release-local.sh status          current, previous, deploy.log tail
#
# Release layout: .releases/<full-sha>[-label]/ holds dist/, prisma/,
# package.json and manifest.json (sha, build time, node version, injected fault).
#
# Pointer layout on this host: a native symlink requires the
# SeCreateSymbolicLinkPrivilege, and Git Bash's `ln -s` silently copies a
# directory rather than linking it. The script probes for real symlink support;
# when it is unavailable `current` is a plain `current.txt` file containing the
# release path relative to the repo root. `service.sh` reads either. We do not
# pretend a copy is a symlink.
#
# PREVIOUS_REF is read from the current pointer *before* the swap and written to
# .deploy/previous_ref. Rollback restores that ref and only then restarts, waits
# and re-runs smoke; a rollback that does not restart proves nothing.
#
# PORT: invoice-api documents 8080 as its default. Windows excludes TCP
# 8001-8300 on this host, so local runs use 8787 (override with RELEASE_PORT).
#
# Deliberate-fault demo: RELEASE_FAULT=invoices-500 makes the deployed build's
# POST /invoices throw (so /health and /ready stay healthy and the smoke gate is
# the thing that fires). RELEASE_FAULT=ready-500 breaks /ready instead, which the
# `wait` gate catches before smoke runs.
#
# Exit codes: 0 deployed and smoke passed; 1 the gate fired (deploy not live,
# rollback attempted); 2 usage error.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

RELEASES_DIR="$REPO_ROOT/.releases"
STATE_DIR="$REPO_ROOT/.deploy"
DEPLOY_LOG="$REPO_ROOT/deploy.log"
BUILD_LOG="$STATE_DIR/build.log"
PREVIOUS_FILE="$STATE_DIR/previous_ref"
CURRENT_LINK="$REPO_ROOT/current"
CURRENT_POINTER="$REPO_ROOT/current.txt"
BASE="http://127.0.0.1:${RELEASE_PORT:-8787}"

mkdir -p "$RELEASES_DIR" "$STATE_DIR"

timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

log_event() {
  local event="$1" detail="${2:-}"
  if [ -n "$detail" ]; then
    printf '%s %s %s\n' "$event" "$detail" "$(timestamp)" >>"$DEPLOY_LOG"
  else
    printf '%s %s\n' "$event" "$(timestamp)" >>"$DEPLOY_LOG"
  fi
}

http_code() {
  local url="$1" out probe="$STATE_DIR/.http-code.$$"
  # Curl's internal "-o /dev/null" fails with CURLE_WRITE_ERROR (23) in this
  # Git Bash build even when the request returned 200, so probe with a real file
  # and trust the printed status code rather than the exit code.
  out=$(curl -s -o "$probe" -w '%{http_code}' "$url" 2>/dev/null)
  rm -f "$probe"
  case "$out" in
    [0-9][0-9][0-9]) printf '%s' "$out" ;;
    *) printf '000' ;;
  esac
}

detect_symlink_mode() {
  local target="$RELEASES_DIR/.symlink-target"
  local probe="$RELEASES_DIR/.symlink-probe"
  printf 'probe\n' >"$target"
  rm -f "$probe"
  if ln -s ".symlink-target" "$probe" 2>/dev/null && [ -L "$probe" ]; then
    SYMLINK_MODE=1
  else
    SYMLINK_MODE=0
  fi
  rm -f "$probe" "$target"
}

resolve_current() {
  local target
  if [ -L "$CURRENT_LINK" ]; then
    target=$(readlink "$CURRENT_LINK")
    [ -n "$target" ] || return 1
    printf '%s\n' "$target"
    return 0
  fi
  if [ -f "$CURRENT_POINTER" ]; then
    IFS= read -r target <"$CURRENT_POINTER"
    [ -n "$target" ] || return 1
    printf '%s\n' "$target"
    return 0
  fi
  return 1
}

switch_current() {
  local rel="$1"
  if [ ! -d "$REPO_ROOT/$rel" ]; then
    echo "release directory missing: $rel" >&2
    return 1
  fi

  if [ "$SYMLINK_MODE" -eq 1 ]; then
    ln -sfn "$rel" "$CURRENT_LINK"
    return 0
  fi

  # Pointer mode. A leftover real symlink would take precedence in resolve_current,
  # so remove just the link (never the release it points at) before writing.
  if [ -L "$CURRENT_LINK" ]; then
    rm -f "$CURRENT_LINK"
  fi
  printf '%s\n' "$rel" >"$CURRENT_POINTER.next"
  mv -f "$CURRENT_POINTER.next" "$CURRENT_POINTER"
}

wait_healthy() {
  local deadline=$((SECONDS + 90))
  local ready_deadline code
  while [ "$SECONDS" -lt "$deadline" ]; do
    code=$(http_code "$BASE/health")
    if [ "$code" = "200" ]; then
      ready_deadline=$((SECONDS + 10))
      while [ "$SECONDS" -lt "$ready_deadline" ]; do
        code=$(http_code "$BASE/ready")
        if [ "$code" = "200" ]; then
          return 0
        fi
        sleep 0.5
      done
      echo "health is 200 but /ready did not reach 200 (last $code)" >&2
      return 1
    fi
    sleep 1
  done
  echo "/health did not reach 200 within 90s (last ${code:-none})" >&2
  return 1
}

inject_fault() {
  local fault="$1" release_dir="$2"
  case "$fault" in
    '')
      return 0
      ;;
    invoices-500)
      # Windows Node does not understand MSYS absolute paths (/p/...), so pass a
      # path relative to the repo root (both scripts cd there first).
      if ! node -e '
const fs = require("node:fs");
const file = process.argv[1];
const needle = "return reply.status(201).send(toResponse(invoice));";
const source = fs.readFileSync(file, "utf8");
if (!source.includes(needle)) {
  console.error("fault injection anchor not found in " + file);
  process.exit(1);
}
fs.writeFileSync(
  file,
  source.replace(needle, "throw new Error(\"deliberate fault: POST /invoices returns 500\");"),
);
' "${release_dir#"$REPO_ROOT/"}/dist/routes/invoices.js"; then
        return 1
      fi
      ;;
    ready-500)
      cat >"$release_dir/dist/routes/health.js" <<'EOF'
export function registerHealthRoutes(app) {
    app.get('/health', async () => ({ status: 'ok' }));
    app.get('/ready', async (_request, reply) =>
        reply.status(500).send({ status: 'error', reason: 'deliberate_fault' }));
}
EOF
      ;;
    *)
      echo "unknown RELEASE_FAULT: $fault (expected invoices-500 or ready-500)" >&2
      return 1
      ;;
  esac
  echo "==> injected deliberate fault: $fault"
}

rollback() {
  local previous
  log_event rollback.start
  previous=$(cat "$PREVIOUS_FILE" 2>/dev/null || printf '')

  if [ -z "$previous" ]; then
    log_event rollback.fail no-previous-ref
    echo "rollback impossible: no previous release was recorded" >&2
    return 1
  fi
  if [ ! -d "$REPO_ROOT/$previous" ]; then
    log_event rollback.fail "missing:$previous"
    echo "rollback impossible: previous release directory is missing ($previous)" >&2
    return 1
  fi

  echo "==> rollback to $previous"
  switch_current "$previous"

  if ! bash "$REPO_ROOT/scripts/service.sh" restart; then
    log_event rollback.fail restart
    echo "rollback restart failed" >&2
    return 1
  fi

  if ! wait_healthy; then
    log_event rollback.health.fail
    echo "rolled-back release did not become healthy" >&2
    return 1
  fi
  log_event rollback.health.ok

  if bash "$REPO_ROOT/scripts/smoke.sh"; then
    log_event rollback.smoke.ok
    echo "rollback complete: $previous is live and passes smoke"
    return 0
  fi

  log_event rollback.smoke.fail
  echo "rollback smoke failed: neither release is trustworthy" >&2
  return 1
}

deploy() {
  local sha_arg="$1" label="${2:-}" ref release_id dirty fault
  local rel rel_abs tmp previous

  if ! ref=$(git rev-parse --verify "${sha_arg}^{commit}" 2>/dev/null); then
    echo "not a commit: $sha_arg" >&2
    return 2
  fi

  case "$label" in
    *[!A-Za-z0-9._-]*) echo "label may only contain A-Z a-z 0-9 . _ -" >&2; return 2 ;;
  esac

  release_id="$ref"
  if [ -n "$label" ]; then
    release_id="$ref-$label"
  fi
  rel=".releases/$release_id"
  rel_abs="$REPO_ROOT/$rel"
  fault="${RELEASE_FAULT:-}"

  dirty=0
  if [ -n "$(git status --porcelain)" ]; then
    dirty=1
  fi

  detect_symlink_mode
  if [ "$SYMLINK_MODE" -eq 1 ]; then
    echo "==> current pointer: symlink"
  else
    echo "==> current pointer: current.txt (native symlinks unavailable on this host)"
  fi

  log_event deploy.start "$ref"
  echo "==> deploy.start $ref (release $release_id, dirty=$dirty)"

  tmp="$RELEASES_DIR/.build-$release_id-$$"
  mkdir -p "$tmp/dist" "$tmp/prisma"

  echo "==> build"
  if ! npm run build >"$BUILD_LOG" 2>&1; then
    log_event build.fail "$release_id"
    echo "build failed; see $BUILD_LOG" >&2
    return 1
  fi

  cp -R "$REPO_ROOT/dist/." "$tmp/dist/"
  cp "$REPO_ROOT/package.json" "$tmp/package.json"
  cp -R "$REPO_ROOT/prisma/." "$tmp/prisma/"

  if ! inject_fault "$fault" "$tmp"; then
    log_event build.fail "$release_id"
    return 1
  fi

  node -e '
const fs = require("node:fs");
const [file, sha, label, fault, builtAt, nodeVersion, dirty] = process.argv.slice(1);
fs.writeFileSync(
  file,
  JSON.stringify(
    { sha, label: label || null, fault: fault || null, builtAt, node: nodeVersion, dirty: dirty === "1" },
    null,
    2,
  ) + "\n",
);
' "${tmp#"$REPO_ROOT/"}/manifest.json" "$ref" "$label" "$fault" "$(timestamp)" "$(node --version)" "$dirty"

  # PREVIOUS_REF is captured before the swap; rollback has nowhere to go without it.
  if previous=$(resolve_current 2>/dev/null); then
    printf '%s\n' "$previous" >"$PREVIOUS_FILE"
    echo "==> PREVIOUS_REF=$previous"
  else
    : >"$PREVIOUS_FILE"
    previous=""
    echo "==> PREVIOUS_REF=(none, first deploy)"
  fi

  if [ -e "$rel_abs" ]; then
    local replaced fresh
    replaced="$RELEASES_DIR/.replaced-$release_id-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    if mv "$rel_abs" "$replaced" 2>/dev/null; then
      :
    else
      # A process still has this release directory as its cwd, so Windows
      # refuses the move with "Device or resource busy". Do not fail the lane:
      # build under a fresh release id instead.
      fresh="$release_id-$(date -u +%Y%m%dT%H%M%SZ)-$$"
      while [ -e "$RELEASES_DIR/$fresh" ]; do
        fresh="$fresh-1"
      done
      echo "==> $rel is busy (a process still holds it); building fresh release .releases/$fresh"
      release_id="$fresh"
      rel=".releases/$release_id"
      rel_abs="$REPO_ROOT/$rel"
    fi
  fi
  mv "$tmp" "$rel_abs"
  echo "==> built $rel"

  switch_current "$rel"
  echo "==> current -> $rel"

  if ! bash "$REPO_ROOT/scripts/service.sh" restart; then
    log_event deploy.fail "$release_id"
    echo "service restart failed" >&2
    if rollback; then
      echo "rolled back after a failed restart" >&2
    fi
    return 1
  fi

  if wait_healthy; then
    log_event health.ok
    echo "==> health.ok"
  else
    log_event health.fail
    echo "health gate failed" >&2
    if rollback; then
      echo "rolled back after a failed health gate" >&2
    fi
    return 1
  fi

  if bash "$REPO_ROOT/scripts/smoke.sh"; then
    log_event smoke.ok
    echo "==> smoke.ok"
    echo "release $release_id is live on ${BASE}"
    return 0
  fi

  log_event smoke.fail
  echo "smoke gate failed" >&2
  if rollback; then
    echo "rolled back to $previous after smoke.fail" >&2
  fi
  return 1
}

# service.pid holds the listener's Windows PID (netstat/taskkill agree with it
# and with the service's own log); `kill -0` only understands MSYS pids, so map
# the WINPID through `ps -W` before testing it.
pid_alive() {
  local pid="$1" msys
  [ -n "$pid" ] || return 1
  case "$(uname -s 2>/dev/null)" in
    MINGW* | MSYS* | CYGWIN*)
      msys=$(ps -W 2>/dev/null | awk -v win="$pid" '$4 == win { print $1; exit }')
      [ -n "$msys" ] || return 1
      kill -0 "$msys" 2>/dev/null
      return $?
      ;;
  esac
  kill -0 "$pid" 2>/dev/null
}

status() {
  local current previous pid

  if current=$(resolve_current 2>/dev/null); then
    echo "current:  $current"
  else
    echo "current:  (none)"
  fi

  previous=$(cat "$PREVIOUS_FILE" 2>/dev/null || printf '')
  echo "previous: ${previous:-(none)}"

  if [ -f "$STATE_DIR/service.pid" ]; then
    pid=$(cat "$STATE_DIR/service.pid" 2>/dev/null)
    if [ -n "$pid" ] && pid_alive "$pid"; then
      echo "pid:      $pid (alive)"
    else
      echo "pid:      ${pid:-unknown} (not running)"
    fi
  else
    echo "pid:      (not running)"
  fi

  echo "--- deploy.log (last 20 lines) ---"
  if [ -f "$DEPLOY_LOG" ]; then
    tail -n 20 "$DEPLOY_LOG"
  else
    echo "(deploy.log is empty)"
  fi
}

case "${1:-}" in
  status)
    status
    ;;
  '')
    echo "usage: $0 <sha> [label] | $0 status" >&2
    exit 2
    ;;
  *)
    deploy "$@"
    ;;
esac
