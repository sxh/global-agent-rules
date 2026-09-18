#!/usr/bin/env bash
# Tests scripts/smoke-plugin-load.sh against a loadable plugin and one that throws
# at factory time.
#
# The real config lives at $HOME/.config/opencode (this repo). The test mirrors it
# into throwaway HOME dirs and points the checker at them via SMOKE_HOME, so the
# real installation is never touched.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

# Mirror this repo's config into a fake HOME: opencode.json + plugins/ + pcp/.
make_home() {
  local home="$1"
  mkdir -p "$home/.config/opencode"
  cp "$ROOT/opencode.json" "$home/.config/opencode/opencode.json"
  cp -R "$ROOT/plugins" "$home/.config/opencode/plugins"
  cp -R "$ROOT/pcp" "$home/.config/opencode/pcp"
}

# --- A well-formed plugin must load ---
good="$fixture/good-home"
make_home "$good"
if ! SMOKE_HOME="$good" bash scripts/smoke-plugin-load.sh >/dev/null 2>&1; then
  echo "FAIL: a loadable PCP plugin must pass the smoke check"
  SMOKE_HOME="$good" bash scripts/smoke-plugin-load.sh || true
  exit 1
fi
echo "PASS: loadable plugin passes the smoke check"

# --- A plugin that throws at factory time must fail ---
bad="$fixture/bad-home"
make_home "$bad"
printf 'export const PCPPlugin = async () => { throw new Error("boom"); };\n' \
  > "$bad/.config/opencode/plugins/pcp.ts"
if SMOKE_HOME="$bad" bash scripts/smoke-plugin-load.sh >/dev/null 2>&1; then
  echo "FAIL: a plugin that throws at load must fail the smoke check"
  exit 1
fi
echo "PASS: throwing plugin fails the smoke check"

echo "PASS: smoke-plugin-load gate accepts a loadable plugin and rejects a broken one"

# --- The smoke check must be wired into the contract gate ---
# Otherwise the safety net exists but never runs. Skipped at commit-run time only by the
# dir overrides check-contract.test.sh uses for its other sections.
if ! grep -q 'smoke-plugin-load.test.sh' "$ROOT/scripts/check-contract.sh"; then
  echo "FAIL: check-contract.sh must run the plugin load smoke check"
  exit 1
fi
echo "PASS: the plugin load smoke check is wired into the contract gate"
