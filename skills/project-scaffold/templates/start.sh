#!/usr/bin/env bash
# Dev start script — TEMPLATE. Copy to the project root as start.sh and chmod +x.
#
# Two failure modes this template exists to prevent, both of which recurred in real sessions:
#   1. Stale build output being executed after a rename/delete (clean before building).
#   2. A backgrounded dev server orphaning to launchd on Ctrl-C, holding its port for days.
# A backgrounded job is not in the foreground process group, so Ctrl-C never reaches it; the
# cleanup trap must kill the whole process tree, and confirm the port is free.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DEV_PORT="${DEV_PORT:-3000}"
DEV_PID=""

cleanup() {
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    echo
    echo "start.sh: stopping dev server (pid $DEV_PID) and its descendants"
    # kill descendants first, then the parent: destroying only the direct child orphans
    # shell -> npm -> node -> sst to launchd
    pkill -TERM -P "$DEV_PID" 2>/dev/null || true
    kill -TERM "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  # Confirm the port is free before the next start
  if command -v lsof >/dev/null 2>&1; then
    holders=$(lsof -ti :"$DEV_PORT" 2>/dev/null || true)
    if [ -n "$holders" ]; then
      echo "start.sh: port $DEV_PORT still held by: $holders — terminating"
      kill -TERM $holders 2>/dev/null || true
    fi
  fi
}

# INT/TERM for Ctrl-C and kill; EXIT so the server also dies if the script exits by any path.
# In an agent shell a persistent session may never fire EXIT between tool calls, so callers
# must also kill explicitly and verify the port is free.
trap cleanup INT TERM EXIT

# --- Clean stale artefacts before rebuilding ---
rm -rf build dist dist-electron coverage

# --- Build (filter third-party warnings, fail on project warnings) ---
# BUILD_OUTPUT=$(npm run build 2>&1) || { echo "$BUILD_OUTPUT"; exit 1; }
# echo "$BUILD_OUTPUT" | tail -3

echo "start.sh: launching dev server on port $DEV_PORT"
npm run dev & DEV_PID=$!
wait "$DEV_PID"
