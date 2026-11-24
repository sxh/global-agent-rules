#!/usr/bin/env bash
# Promoted from paints-app (2026-11-24). Generic: every path resolves through git.
# One gate run at a time.
#
#   scripts/gate-lock.sh acquire <label>   # 0 taken, 4 already held by this run, 3 refused
#   scripts/gate-lock.sh release <pid>     # drop the lock recorded for <pid>
#
# Source it to get `gate_lock_hold <label>`, which takes the lock and installs the
# release trap on the caller's own EXIT:
#
#   . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gate-lock.sh"
#   gate_lock_hold preflight.sh
#
# The pid acquire records is the calling shell's, and release only removes the lock
# recorded for the pid it is given: the acquiring shell passes its own $BASHPID, so
# no other process can drop a lock it did not take.
#
# Why this exists: a preflight left running in the background overlapped a
# commit-tier run, which then took 1423s and reported test files as failed with
# 4254s of import time — resource exhaustion, not a defect, diagnosed and re-run
# at cost (retrospective 2026-11-23). Two gates at once means two vitest suites and
# two tsc processes competing for one machine.
#
# The lock is a file beside the git directory naming the holder, so a refusal can
# say who holds it. A holder whose pid is gone is reclaimed rather than blocking
# every later run: a crash must not need a human to clear a file.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || echo .)"
case "$GIT_DIR" in
    /*) ;;
    *) GIT_DIR="$ROOT/$GIT_DIR" ;;
esac
LOCK="$GIT_DIR/gate.lock"
REFUSED=3
NESTED=4

# The recorded pid is the shell that called acquire, not this short-lived helper:
# that is the process whose EXIT trap calls release, and the one a nested gate run
# finds in its ancestry.
write_lock() {
    local label="$1"
    (
        set -o noclobber
        printf 'pid=%s\nstarted=%s\ncommand=%s\n' "$PPID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" >"$LOCK"
    ) 2>/dev/null
}

lock_field() {
    sed -n "s/^$1=//p" "$LOCK" 2>/dev/null | head -1
}

# True when [1] is [2] or one of its ancestors: the mark of the same gate run.
is_ancestor() {
    local target="$1" current="$2"
    while [ -n "$current" ] && [ "$current" -gt 1 ] 2>/dev/null; do
        [ "$current" = "$target" ] && return 0
        current="$(ps -o ppid= -p "$current" 2>/dev/null | tr -d ' ')"
    done
    return 1
}

refuse() {
    local pid="$1" started="$2" command="$3"
    cat >&2 <<EOF
✖ gate lock: another gate run is in progress.
    pid $pid, started $started, running $command
    lock: $LOCK
Two gates at once fight over the same machine and reported a false failure on
2026-11-23 (1423s, 4254s of import time). Wait for it to finish; if it is stuck,
remove the lock file — a lock whose pid is gone is reclaimed automatically.
EOF
    return "$REFUSED"
}

reclaim() {
    local pid="$1" label="$2"
    echo "gate lock: reclaiming $LOCK — pid ${pid:-unknown} is gone." >&2
    rm -f "$LOCK"
    if write_lock "$label"; then
        return 0
    fi
    echo "gate lock: another run took the lock while it was being reclaimed." >&2
    return "$REFUSED"
}

acquire() {
    local label="${1:-gate}" pid started command
    if write_lock "$label"; then
        return 0
    fi
    pid="$(lock_field pid || true)"
    started="$(lock_field started || true)"
    command="$(lock_field command || true)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        reclaim "$pid" "$label"
        return
    fi
    # A run started by the holder is part of the same gate, not a second one.
    if is_ancestor "$pid" "$PPID"; then
        return "$NESTED"
    fi
    refuse "$pid" "$started" "$command"
}

release() {
    local pid="${1:-}"
    [ -f "$LOCK" ] || return 0
    [ -n "$pid" ] || return 0
    if [ "$(lock_field pid || true)" = "$pid" ]; then
        rm -f "$LOCK"
    fi
    return 0
}

# Takes the lock for the calling script and releases it when that script exits.
# A nested run returns success without arming a trap: the lock belongs to the run
# this one is part of.
gate_lock_hold() {
    local label="${1:-gate}" self="${BASH_SOURCE[0]}" pid="$$" status=0
    bash "$self" acquire "$label" || status=$?
    case "$status" in
        0) trap "bash '$self' release '$pid'" EXIT ;;
        "$NESTED") ;;
        *) return "$status" ;;
    esac
    return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1:-acquire}" in
        acquire)
            shift
            acquire "${1:-gate}"
            ;;
        release)
            shift
            release "${1:-}"
            ;;
        *)
            echo "usage: scripts/gate-lock.sh acquire <label> | release <pid>" >&2
            exit 2
            ;;
    esac
fi
