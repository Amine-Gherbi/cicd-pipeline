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
SERVICE_PORT="${RELEASE_PORT:-8787}"
export RELEASE_PORT="$SERVICE_PORT"

# PIDs on this host: netstat/taskkill and the service's own log use the Windows
# PID (WINPID), which is stable. `$!` is an MSYS pid, meaningful only inside the
# Git Bash session that spawned the process; a later run cannot use it to find
# the process again. This script therefore writes the WINPID that netstat
# reports into service.pid. Every consumer (status, stop, demo.sh) matches it
# against the live listener instead of trusting a stale number.
on_windows() {
  case "$(uname -s 2>/dev/null)" in
    MINGW* | MSYS* | CYGWIN*) return 0 ;;
  esac
  return 1
}

# Print every PID listening on SERVICE_PORT, one per line.
port_listener_pids() {
  if on_windows && command -v netstat >/dev/null 2>&1; then
    netstat -ano -p tcp 2>/dev/null | awk -v suffix=":$SERVICE_PORT" '
      tolower($4) ~ /listen/ &&
      length($2) >= length(suffix) &&
      substr($2, length($2) - length(suffix) + 1) == suffix { print $NF }
    '
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$SERVICE_PORT" -sTCP:LISTEN 2>/dev/null
  fi
  return 0
}

port_listener_pid() {
  port_listener_pids | awk 'NF { print; exit }'
}

process_command_line() {
  local pid="$1" cmd=""
  if on_windows && command -v powershell.exe >/dev/null 2>&1; then
    cmd=$(powershell.exe -NoProfile -NonInteractive -Command \
      "(Get-CimInstance Win32_Process -Filter 'ProcessId=$pid').CommandLine" 2>/dev/null)
  elif command -v ps >/dev/null 2>&1; then
    cmd=$(ps -p "$pid" -o args= 2>/dev/null)
  fi
  printf '%s' "$cmd" | tr -d '\r' | awk 'NR == 1 { print }'
}

# True only when the listener's command line names a release inside THIS repo.
# service.sh passes the release path as --release-dir for exactly this check.
command_is_our_release() {
  local cmd="$1" normalized win_root msys_root
  [ -n "$cmd" ] || return 1
  normalized=$(printf '%s' "$cmd" | tr '\\' '/' | tr '[:upper:]' '[:lower:]')
  msys_root=$(printf '%s' "$REPO_ROOT" | tr '\\' '/' | tr '[:upper:]' '[:lower:]')
  if win_root=$(cd "$REPO_ROOT" && pwd -W 2>/dev/null); then
    win_root=$(printf '%s' "$win_root" | tr '\\' '/' | tr '[:upper:]' '[:lower:]')
  else
    win_root="$msys_root"
  fi
  case "$normalized" in
    *"$win_root/.releases/"*) return 0 ;;
    *"$msys_root/.releases/"*) return 0 ;;
  esac
  return 1
}

# Match the WINPID column of `ps -W` directly. An MSYS pid belongs to the shell
# session that spawned the process; it is not a handle a later run can use.
pid_alive() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  if on_windows; then
    ps -W 2>/dev/null | awk -v win="$pid" '$4 == win { found = 1 } END { exit(found ? 0 : 1) }'
    return $?
  fi
  kill -0 "$pid" 2>/dev/null
}

# Stop a process by WINPID. taskkill is the primary path on Windows — a plain
# `kill` of the mapped MSYS pid does not terminate a node.exe started by another
# shell session, and there is no other mechanism to fall back to. If taskkill is
# unavailable the failure is reported. On POSIX, SIGTERM then SIGKILL.
STOP_ELAPSED_MS=0
stop_pid() {
  local pid="$1" i
  STOP_ELAPSED_MS=0
  if ! pid_alive "$pid"; then
    return 0
  fi

  if on_windows; then
    if ! command -v taskkill >/dev/null 2>&1; then
      echo "stop_pid: taskkill is unavailable; refusing to improvise a kill for WINPID $pid" >&2
      return 1
    fi
    MSYS_NO_PATHCONV=1 taskkill /PID "$pid" /F /T >/dev/null 2>&1 || :
    for i in $(seq 1 100); do
      if ! pid_alive "$pid"; then
        STOP_ELAPSED_MS=$((i * 100))
        return 0
      fi
      sleep 0.1
    done
    STOP_ELAPSED_MS=10000
    return 1
  fi

  kill "$pid" 2>/dev/null || :
  for i in $(seq 1 100); do
    if ! pid_alive "$pid"; then
      STOP_ELAPSED_MS=$((i * 100))
      return 0
    fi
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null || :
  for i in $(seq 1 50); do
    if ! pid_alive "$pid"; then
      STOP_ELAPSED_MS=$((10000 + i * 100))
      return 0
    fi
    sleep 0.1
  done
  STOP_ELAPSED_MS=15000
  return 1
}

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
  pid_alive "$pid"
}

start() {
  local rel pid listener cmd marker i
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
  listener=$(port_listener_pid)
  if [ -n "$listener" ]; then
    cmd=$(process_command_line "$listener")
    echo "port $SERVICE_PORT is held by $listener (${cmd:-command line unavailable})" >&2
    return 1
  fi

  mkdir -p "$STATE_DIR"
  load_env
  ensure_smoke_token
  export NODE_ENV=production
  export HOST=127.0.0.1
  export PORT="$SERVICE_PORT"

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set (add it to .env)" >&2
    return 1
  fi

  # The release path is also an argument, not just the child's cwd: a later run
  # can read a listening process's command line but not its working directory.
  if command -v cygpath >/dev/null 2>&1; then
    marker=$(cygpath -w "$REPO_ROOT/$rel")
  else
    marker="$REPO_ROOT/$rel"
  fi

  echo "==> start $(date -u +%Y-%m-%dT%H:%M:%SZ) release=$rel port=$SERVICE_PORT" >>"$SERVICE_LOG"

  (
    cd "$REPO_ROOT/$rel"
    nohup node dist/server.js --release-dir "$marker" >>"$SERVICE_LOG" 2>&1 &
  )

  # Record the WINPID netstat reports rather than `$!`; the two differ on this
  # host and only the WINPID survives this shell.
  listener=""
  for i in $(seq 1 100); do
    listener=$(port_listener_pid)
    if [ -n "$listener" ]; then
      break
    fi
    sleep 0.1
  done
  if [ -z "$listener" ]; then
    echo "service did not bind $HOST:$SERVICE_PORT; last log lines:" >&2
    tail -n 20 "$SERVICE_LOG" >&2
    rm -f "$PID_FILE"
    return 1
  fi
  cmd=$(process_command_line "$listener")
  if [ -n "$cmd" ] && ! command_is_our_release "$cmd"; then
    echo "port $SERVICE_PORT is held by $listener ($cmd)" >&2
    return 1
  fi

  printf '%s\n' "$listener" >"$PID_FILE"
  pid=$listener
  echo "started release $rel (pid $pid) on $HOST:$PORT"
}

stop() {
  local pid cmd
  if [ ! -f "$PID_FILE" ]; then
    echo "service is not running (no pid file)"
    return 0
  fi

  pid=$(cat "$PID_FILE" 2>/dev/null) || pid=""
  if [ -n "$pid" ] && pid_alive "$pid"; then
    # A stale pid file can name a process that Windows has since given to
    # something else. Only stop it when its command line runs a release here.
    cmd=$(process_command_line "$pid")
    if ! command_is_our_release "$cmd"; then
      echo "pid $pid is not a release in this repo (${cmd:-command line unavailable}); refusing to stop it" >&2
      rm -f "$PID_FILE"
      return 1
    fi
    if stop_pid "$pid"; then
      echo "stopped WINPID $pid after ${STOP_ELAPSED_MS}ms"
    else
      echo "could not stop WINPID $pid" >&2
      rm -f "$PID_FILE"
      return 1
    fi
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
    pid=$(cat "$PID_FILE" 2>/dev/null) || pid=""
    if [ -n "$pid" ] && pid_alive "$pid"; then
      echo "pid:      $pid (alive)"
    else
      echo "pid:      ${pid:-unknown} (stale)"
    fi
  else
    echo "pid:      (none)"
  fi
  echo "port:     $SERVICE_PORT"
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
