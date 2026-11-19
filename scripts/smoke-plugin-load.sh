#!/usr/bin/env bash
# Smoke check: does opencode still start with the PCP plugin loaded?
#
# WHY THIS EXISTS
# opencode auto-discovers plugins/*.ts and invokes every export as a plugin factory.
# A module that throws at import/factory time can leave the plugin registry malformed
# and make opencode unstartable (2026-09-18 incident). This check boots opencode
# non-interactively and fails loudly if PCP did not load.
#
# WHY THE PROCESS EXIT CODE IS IGNORED
# The boot command exits 0 even when a plugin fails to load, and still lists the plugin
# path. The only reliable signal is the --print-logs output, and the two lines differ per
# major:
#
#   V1 (`opencode debug info`):      pass: "PCP initialized" present AND
#                                          "failed to load plugin" absent
#   V2 (`opencode debug agents`):    pass: 'msg="loading plugin" … plugins/pcp.ts' present
#                                          AND 'message="failed to load plugin"' absent
#
# A plugin that logs and then throws prints both the load line and the failure, so the
# failure check takes precedence in both branches. V2 no longer forwards a plugin's
# console output to the server log, which is why it is matched on the loader line instead.
#
# Usage: scripts/smoke-plugin-load.sh
# Env:
#   SMOKE_HOME  HOME passed to opencode (default: $HOME). Point at a fake HOME to test
#               an isolated config without touching the real install.
#   SMOKE_CWD   Working directory for the run (default: a temp dir) so no project
#               config leaks in.
set -uo pipefail

if ! command -v opencode >/dev/null 2>&1; then
  echo "FAIL: opencode is not on PATH; cannot run the load smoke check"
  exit 1
fi

smoke_home="${SMOKE_HOME:-$HOME}"
if [ ! -d "$smoke_home" ]; then
  echo "FAIL: SMOKE_HOME is not a directory: $smoke_home"
  exit 1
fi

cwd="${SMOKE_CWD:-$(mktemp -d)}"
if [ -z "${SMOKE_CWD:-}" ]; then
  trap 'rm -rf "$cwd"' EXIT
fi

version="$(opencode --version 2>/dev/null || true)"
case "$version" in
  *v2.*|*2.*) major=2 ;;
  *) major=1 ;;
esac

if [ "$major" = "2" ]; then
  # --standalone boots a private instance with this HOME, so SMOKE_HOME is honoured and
  # no model call is made.
  out="$(cd "$cwd" && HOME="$smoke_home" opencode debug agents --standalone --print-logs 2>&1)"

  if printf '%s\n' "$out" | grep -q 'message="failed to load plugin"'; then
    echo "FAIL: opencode reported a plugin load failure"
    printf '%s\n' "$out" | grep -n 'failed to load plugin' | head
    exit 1
  fi

  if ! printf '%s\n' "$out" | grep -q 'msg="loading plugin".*plugins/pcp\.ts'; then
    echo "FAIL: PCP plugin was not loaded (opencode booted without it)"
    printf '%s\n' "$out" | grep -iE 'plugin' | sed -n '1,20p'
    exit 1
  fi

  echo "PASS: PCP plugin loaded and initialised (opencode 2)"
  exit 0
fi

out="$(cd "$cwd" && HOME="$smoke_home" opencode debug info --print-logs 2>&1)"

if ! printf '%s\n' "$out" | grep -q 'PCP initialized'; then
  echo "FAIL: PCP plugin did not initialise (opencode booted without it)"
  printf '%s\n' "$out" | sed -n '1,40p'
  exit 1
fi

if printf '%s\n' "$out" | grep -q 'failed to load plugin'; then
  echo "FAIL: opencode reported a plugin load failure"
  printf '%s\n' "$out" | grep -n 'failed to load plugin' | head
  exit 1
fi

echo "PASS: PCP plugin loaded and initialised"
