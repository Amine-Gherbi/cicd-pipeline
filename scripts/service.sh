#!/usr/bin/env bash
# service.sh — start / stop / restart / status for the release that `current`
# points at.
#
# Pointer layout on this host: a native symlink needs the
# SeCreateSymbolicLinkPrivilege, and Git Bash's `ln -s` silently copies a
# directory instead of linking it. release-local.sh probes for real symlink
# support and, when it is unavailable, writes `current.txt` containing the
# release path relative to the repo root. This script reads either one, so
# never assume `readlink current` is the source of truth on Windows.
#
# PORT: invoice-api documents 8080 as its default. This Windows host excludes
# TCP 8001-8300, so every local run uses 8787 (override with RELEASE_PORT).
#
# Env: .env and .env.local are loaded from the repo root. If .env.local has no
# SMOKE_TOKEN, a random 32-hex token is seeded there (gitignored) so the smoke
# lane can prove that POST /invoices is authenticated.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

STATE_DIR="$REPO_ROOT/.deploy"
PID_FILE="$STATE_DIR/service.pid"
SERVICE_LOG="$STATE_DIR/service.log"
CURRENT_LINK="$REPO_ROOT/current"
CURRENT_POINTER="$REPO_ROOT/current.txt"

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

ensure_smoke_token() {
  if [ -n "${SMOKE_TOKEN:-}" ]; then
    export SMOKE_TOKEN
    return 0
  fi

  local file="$REPO_ROOT/.env.local"
  SMOKE_TOKEN=$(node -e "process.stdout.write(require('node:crypto').randomBytes(16).toString('hex'))")
  printf 'SMOKE_TOKEN=%s\n' "$SMOKE_TOKEN" >>"$file"
  export SMOKE_TOKEN
  echo "seeded SMOKE_TOKEN in .env.local" >&2
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

is_running() {
  local pid
  [ -f "$PID_FILE" ] || return 1
  pid=$(cat "$PID_FILE" 2>/dev/null) || return 1
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

start() {
  local rel pid
  if ! rel=$(resolve_current); then
    echo "no current release: run ./scripts/release-local.sh <sha> first" >&2
    return 1
  fi
  if [ ! -d "$REPO_ROOT/$rel" ]; then
    echo "current points at a missing release: $rel" >&2
    return 1
  fi
  if is_running; then
    echo "service already running (pid $(cat "$PID_FILE"), release $rel); use restart"
    return 0
  fi

  mkdir -p "$STATE_DIR"
  load_env
  ensure_smoke_token
  export NODE_ENV=production
  export HOST=127.0.0.1
  export PORT="${RELEASE_PORT:-8787}"

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set (add it to .env)" >&2
    return 1
  fi

  echo "==> start $(date -u +%Y-%m-%dT%H:%M:%SZ) release=$rel port=$PORT" >>"$SERVICE_LOG"

  (
    cd "$REPO_ROOT/$rel"
    nohup node dist/server.js >>"$SERVICE_LOG" 2>&1 &
    echo $! >"$PID_FILE"
  )

  pid=$(cat "$PID_FILE")
  sleep 0.3
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "service failed to start; last log lines:" >&2
    tail -n 20 "$SERVICE_LOG" >&2
    rm -f "$PID_FILE"
    return 1
  fi

  echo "started release $rel (pid $pid) on $HOST:$PORT"
}

stop() {
  local pid
  if [ ! -f "$PID_FILE" ]; then
    echo "service is not running (no pid file)"
    return 0
  fi

  pid=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    local i
    for i in $(seq 1 50); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null
    fi
    echo "stopped pid $pid"
  else
    echo "pid file was stale (${pid:-empty}); cleaning up"
  fi

  rm -f "$PID_FILE"
}

status() {
  local rel pid
  if rel=$(resolve_current); then
    echo "current:  $rel"
    echo "running:  $([ -d "$REPO_ROOT/$rel" ] && echo yes || echo 'no (release dir missing)')"
  else
    echo "current:  (none)"
  fi

  if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "pid:      $pid (alive)"
    else
      echo "pid:      ${pid:-unknown} (stale)"
    fi
  else
    echo "pid:      (none)"
  fi
  echo "port:     ${RELEASE_PORT:-8787}"
  echo "log:      $SERVICE_LOG"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *)
    echo "usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
