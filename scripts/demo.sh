#!/usr/bin/env bash
# demo.sh — one command that shows the local lane end to end:
#
#   1. healthy release          -> /health, /ready, five smoke assertions pass
#   2. deliberately broken release -> smoke fails
#   3. rollback                 -> previous release restarted, re-waited, re-smoked
#
# The deploy events are appended to deploy.log by release-local.sh, in the same
# format as any other release. This script only reads that log to build the
# summary; it writes no events of its own. Elapsed values are whole seconds
# taken from the deploy.log event timestamps.
#
# Exit 0 only when the broken release failed at smoke and the rollback passed.
# A healthy failure, a broken release that passes, or a failed rollback exits 1.
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT" || exit 1

DEPLOY_LOG="$REPO_ROOT/deploy.log"
STATE_DIR="$REPO_ROOT/.deploy"
HEALTHY_OUT="$STATE_DIR/demo-healthy.log"
BROKEN_OUT="$STATE_DIR/demo-broken.log"
EVENTS="$STATE_DIR/demo-events.$$"
trap 'rm -f "$EVENTS"' EXIT

mkdir -p "$STATE_DIR"

# demo.sh accepts PORT as well as RELEASE_PORT; export the resolved value so
# release-local.sh, service.sh and smoke.sh all talk to the same endpoint.
PORT="${RELEASE_PORT:-${PORT:-8787}}"
export RELEASE_PORT="$PORT"

on_windows() {
  case "$(uname -s 2>/dev/null)" in
    MINGW* | MSYS* | CYGWIN*) return 0 ;;
  esac
  return 1
}

port_listener_pids() {
  if on_windows && command -v netstat >/dev/null 2>&1; then
    netstat -ano -p tcp 2>/dev/null | awk -v suffix=":$PORT" '
      tolower($4) ~ /listen/ &&
      length($2) >= length(suffix) &&
      substr($2, length($2) - length(suffix) + 1) == suffix { print $NF }
    '
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null
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

# The WINPID that netstat reports is the only stable handle on this host: an
# MSYS pid is meaningful only inside the shell session that spawned the process,
# and `kill` on it does not terminate a node.exe started by another session.
# Match the WINPID column of `ps -W` instead.
pid_alive() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  if on_windows; then
    ps -W 2>/dev/null | awk -v win="$pid" '$4 == win { found = 1 } END { exit(found ? 0 : 1) }'
    return $?
  fi
  kill -0 "$pid" 2>/dev/null
}

# Milliseconds since the epoch, for the "port free after" report.
now_ms() {
  local t
  if [ -n "${EPOCHREALTIME:-}" ]; then
    t=${EPOCHREALTIME//[.,]/}
    printf '%s' "$((t / 1000))"
  else
    printf '%s' "$(($(date +%s) * 1000))"
  fi
}

# Stop a process by WINPID. On Windows taskkill is the primary path, never a
# fallback: `taskkill /F /T` terminates the process and its tree directly, and
# there is no other mechanism to improvise with. If taskkill is missing the
# caller must see the failure. On POSIX, SIGTERM then SIGKILL.
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

# A listener left by a previous run still has its release directory as cwd, so
# rebuilding that directory fails with EBUSY. Stop it only when its command
# line proves it belongs to this repository; never kill a foreign listener.
ensure_port_available() {
  local pid cmd waited recorded stopped t0 t1 elapsed
  pid=$(port_listener_pid)
  [ -n "$pid" ] || return 0

  cmd=$(process_command_line "$pid")
  if ! command_is_our_release "$cmd"; then
    echo "demo: port $PORT is held by $pid (${cmd:-command line unavailable})" >&2
    exit 1
  fi

  stopped="$pid"
  echo "==> demo: stopping WINPID $stopped on port $PORT before building (its command line runs a release in this repo: $cmd)"
  t0=$(now_ms)
  if ! stop_pid "$stopped"; then
    echo "demo: could not stop WINPID $stopped" >&2
    exit 1
  fi

  # Clear the state file only when it names the process we just stopped; a
  # different PID is not ours to discard.
  recorded=$(cat "$STATE_DIR/service.pid" 2>/dev/null) || recorded=""
  recorded=$(printf '%s' "$recorded" | tr -d '[:space:]')
  if [ "$recorded" = "$stopped" ]; then
    rm -f "$STATE_DIR/service.pid"
  fi

  # The kill is proven only when netstat stops listing the port: poll it, never
  # sleep a fixed amount and assume.
  waited=0
  while [ "$waited" -lt 100 ]; do
    pid=$(port_listener_pid)
    if [ -z "$pid" ]; then
      t1=$(now_ms)
      elapsed=$((t1 - t0))
      printf '==> demo: stopped WINPID %s; port %s free after %d.%03ds\n' \
        "$stopped" "$PORT" $((elapsed / 1000)) $((elapsed % 1000))
      return 0
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  echo "demo: port $PORT is still held by $pid after stopping WINPID $stopped" >&2
  exit 1
}

if ! SHA=$(git rev-parse HEAD); then
  echo "demo: not a git checkout" >&2
  exit 1
fi

before=0
if [ -f "$DEPLOY_LOG" ]; then
  before=$(wc -l <"$DEPLOY_LOG")
fi

elapsed_seconds() {
  local from="$1" to="$2" a b
  if [ -z "$from" ] || [ -z "$to" ]; then
    printf 'n/a'
    return 0
  fi
  a=$(date -u -d "$from" +%s 2>/dev/null) || { printf 'n/a'; return 0; }
  b=$(date -u -d "$to" +%s 2>/dev/null) || { printf 'n/a'; return 0; }
  printf '%ss' "$((b - a))"
}

parse_events() {
  H_START=; H_HEALTH=; H_SMOKE=
  B_START=; B_HEALTH=; B_SMOKE=
  B_RSTART=; B_RHEALTH=; B_ROK=
  local seg=0 event rest ts

  : >"$EVENTS"
  if [ -f "$DEPLOY_LOG" ]; then
    tail -n "+$((before + 1))" "$DEPLOY_LOG" >"$EVENTS" 2>/dev/null || : >"$EVENTS"
  fi

  while read -r event rest; do
    [ -n "$event" ] || continue
    ts=${rest##* }
    case "$event" in
      deploy.start)
        if [ "$seg" -eq 0 ]; then
          H_START=$ts
          seg=1
        elif [ "$seg" -eq 1 ]; then
          B_START=$ts
          seg=2
        fi
        ;;
      health.ok)
        if [ "$seg" -eq 1 ]; then
          H_HEALTH=$ts
        elif [ "$seg" -eq 2 ]; then
          B_HEALTH=$ts
        fi
        ;;
      smoke.ok)
        [ "$seg" -eq 1 ] && H_SMOKE=$ts
        ;;
      smoke.fail)
        [ "$seg" -eq 2 ] && B_SMOKE=$ts
        ;;
      rollback.start)
        B_RSTART=$ts
        ;;
      rollback.health.ok)
        B_RHEALTH=$ts
        ;;
      rollback.smoke.ok)
        B_ROK=$ts
        ;;
    esac
  done <"$EVENTS"
}

compute_results() {
  parse_events

  H_RELEASE=PASS
  if [ "$healthy_ec" -ne 0 ] || [ -z "$H_START" ] || [ -z "$H_HEALTH" ]; then
    H_RELEASE=FAIL
  fi

  H_SMOKE_RESULT=PASS
  if [ -z "$H_SMOKE" ]; then
    H_SMOKE_RESULT=FAIL
  fi

  B_RELEASE=FAIL
  if [ -n "$B_START" ] && [ -n "$B_HEALTH" ]; then
    B_RELEASE=PASS
  fi

  B_SMOKE_LABEL=FAIL
  if [ -z "$B_SMOKE" ]; then
    B_SMOKE_LABEL="NOT REACHED"
  fi

  ROLLBACK=FAIL
  if [ -n "$B_ROK" ]; then
    ROLLBACK=PASS
  fi

  demo_ok=1
  [ "$H_RELEASE" = PASS ] || demo_ok=0
  [ "$H_SMOKE_RESULT" = PASS ] || demo_ok=0
  [ "$B_RELEASE" = PASS ] || demo_ok=0
  [ "$B_SMOKE_LABEL" = FAIL ] || demo_ok=0
  [ "$ROLLBACK" = PASS ] || demo_ok=0
  if [ "$broken_ran" -eq 1 ] && [ "$broken_ec" -ne 1 ]; then
    demo_ok=0
  fi
}

print_summary() {
  compute_results

  echo
  echo "demo summary"
  printf '%-24s  %-11s  %-8s  %s\n' "step" "result" "expected" "elapsed"
  printf '%-24s  %-11s  %-8s  %s\n' "------------------------" "----------" "--------" "-------"
  printf '%-24s  %-11s  %-8s  %s\n' "release (healthy)" "$H_RELEASE" "PASS" "$(elapsed_seconds "$H_START" "$H_HEALTH")"
  printf '%-24s  %-11s  %-8s  %s\n' "smoke (healthy)" "$H_SMOKE_RESULT" "PASS" "$(elapsed_seconds "$H_HEALTH" "$H_SMOKE")"

  if [ "$broken_ran" -eq 1 ]; then
    printf '%-24s  %-11s  %-8s  %s\n' "release (broken)" "$B_RELEASE" "PASS" "$(elapsed_seconds "$B_START" "$B_HEALTH")"
    printf '%-24s  %-11s  %-8s  %s\n' "smoke (broken)" "$B_SMOKE_LABEL" "FAIL" "$(elapsed_seconds "$B_HEALTH" "$B_SMOKE")"
    printf '%-24s  %-11s  %-8s  %s\n' "rollback" "$ROLLBACK" "PASS" "$(elapsed_seconds "$B_RSTART" "$B_ROK")"
  else
    printf '%-24s  %-11s  %-8s  %s\n' "release (broken)" "NOT RUN" "PASS" "n/a"
    printf '%-24s  %-11s  %-8s  %s\n' "smoke (broken)" "NOT RUN" "FAIL" "n/a"
    printf '%-24s  %-11s  %-8s  %s\n' "rollback" "NOT RUN" "PASS" "n/a"
  fi
}

# The run is only reproducible if it leaves one service behind and the state
# file names that exact process. Print the evidence; a mismatch fails the demo.
report_service_state() {
  local expected listeners count
  expected=$(cat "$STATE_DIR/service.pid" 2>/dev/null) || expected=""
  expected=$(printf '%s' "$expected" | tr -d '[:space:]')
  listeners=$(port_listener_pids | sort -u | tr '\n' ' ')
  listeners=${listeners% }
  count=$(printf '%s\n' "$listeners" | awk 'NF { n++ } END { print n + 0 }')

  if [ "$count" -eq 1 ] && [ "$listeners" = "$expected" ]; then
    echo "demo: service state - pid $listeners is the only listener on port $PORT and matches .deploy/service.pid"
    return 0
  fi

  echo "demo: service state - expected .deploy/service.pid=${expected:-missing} to be the only listener on port $PORT (found: ${listeners:-none})" >&2
  demo_ok=0
}

broken_ran=0
broken_ec=0
healthy_ec=1

# On this host a release directory that is the running process's working
# directory cannot be moved ("Device or resource busy"). Clear the port before
# the first build; the listener's command line is what authorises the stop.
ensure_port_available

echo "==> demo: healthy release $SHA"
bash "$REPO_ROOT/scripts/release-local.sh" "$SHA" 2>&1 | tee "$HEALTHY_OUT"
healthy_ec=$?

if [ "$healthy_ec" -ne 0 ]; then
  print_summary
  if ! bash "$REPO_ROOT/scripts/service.sh" start; then
    echo "demo: the current release could not be restarted" >&2
  fi
  echo "demo: FAILED - the healthy release did not pass smoke; the broken release was not attempted" >&2
  exit 1
fi

echo
echo "==> demo: deliberately broken release $SHA (RELEASE_FAULT=invoices-500)"
broken_ran=1
RELEASE_FAULT=invoices-500 bash "$REPO_ROOT/scripts/release-local.sh" "$SHA" broken 2>&1 | tee "$BROKEN_OUT"
broken_ec=$?

print_summary
report_service_state

if [ "$demo_ok" -eq 1 ]; then
  echo "demo: ok - rollback verified"
  exit 0
fi

echo "demo: FAILED" >&2
exit 1
