#!/usr/bin/env bash
# Tests check-contract.sh against fixtures: the incident-leak heuristic and the
# skill-test gate (a failing skill test must fail the gate; a passing one is
# reported with a coverage number).
#
# A "leak" is an ACTIVE incident entry that asserts a rule but carries no status tag.
# Exempt by design: [ENFORCED] / [OPEN] / [EXPIRED] / [KNOWLEDGE] tagged entries,
# [Positive] practice entries, and everything in the archive section.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT

cat > "$fixture" <<'FIXTURE'
- **[2026-01-01] [Process] Active Untagged Rule** — You must always do the thing. Example.
- **[2026-01-02] [Process] [ENFORCED] Tagged Rule** — You must do it. (Covering gate: hook.)
- **[2026-01-03] [Tooling] [KNOWLEDGE] Knowledge Gotcha** — Never trust X; it must be verified.
- **[2026-01-04] [Positive] Positive Practice** — Always do this well; it never fails.
These entries have been archived as of their respective retrospectives.
- **[2026-01-05] [Testing] Archived Rule** — You must do the archived thing.
- **[2026-01-06] [Process] Post-Archive Rule** — You must never do this.
FIXTURE

out="$(INCIDENTS_FILE="$fixture" bash scripts/check-contract.sh AGENTS.md 2>&1)"
count="$(printf '%s\n' "$out" | sed -nE 's/^incidents: ([0-9]+) untagged.*/\1/p')"

if [ "$count" != "1" ]; then
  echo "FAIL: expected 1 leak, got '${count:-<none>}'"
  printf '%s\n' "$out"
  exit 1
fi
echo "PASS: leak heuristic counts only active untagged rule-bearing entries (got $count)"

# --- Skill test suites must run in the gate ---
skills="$(mktemp -d)"
trap 'rm -f "$fixture"; rm -rf "$skills"' EXIT
mkdir -p "$skills/ok/test" "$skills/bad/test"
cat > "$skills/ok/test/ok.test.mjs" <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('passes', () => assert.equal(1, 1));
JS
cat > "$skills/bad/test/bad.test.mjs" <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fails', () => assert.equal(1, 2));
JS

if SKILLS_DIR="$skills" bash scripts/check-contract.sh AGENTS.md >/dev/null 2>&1; then
  echo "FAIL: a failing skill test must fail the gate"
  exit 1
fi
echo "PASS: a failing skill test fails the gate"

skills_ok="$(mktemp -d)"
trap 'rm -f "$fixture"; rm -rf "$skills" "$skills_ok"' EXIT
mkdir -p "$skills_ok/ok/test"
cp "$skills/ok/test/ok.test.mjs" "$skills_ok/ok/test/ok.test.mjs"
ok_out="$(SKILLS_DIR="$skills_ok" bash scripts/check-contract.sh AGENTS.md 2>&1)" || true
if ! printf '%s\n' "$ok_out" | grep -Eq 'tests: [0-9]+ test file\(s\) passed'; then
  echo "FAIL: expected the gate to report first-party test results/coverage"
  printf '%s\n' "$ok_out"
  exit 1
fi
echo "PASS: a passing skill test suite is reported by the gate"

# --- Top-level plugins/ modules may export only plugin factories ---
# opencode auto-discovers plugins/*.{ts,js} and (legacy path) invokes EVERY function export
# as a plugin factory. A pure helper parked in that directory is therefore called with a
# plugin-input object, throws, and can break startup. Only `default` and `*Plugin` exports
# are permitted; helpers belong in pcp/.
plug_bad="$(mktemp -d)"
plug_ok="$(mktemp -d)"
trap 'rm -f "$fixture"; rm -rf "$skills" "$skills_ok" "$plug_bad" "$plug_ok"' EXIT

cat > "$plug_bad/helper.ts" <<'TS'
export function decideStart(stack: { active: string }) {
  return stack.active;
}
TS
cat > "$plug_ok/pcp.ts" <<'TS'
export const PcpPlugin = async () => ({});
export default PcpPlugin;
TS

if PLUGINS_DIR="$plug_bad" SKILLS_DIR="$plug_bad" bash scripts/check-contract.sh AGENTS.md >/dev/null 2>&1; then
  echo "FAIL: a top-level plugins/ module exporting a non-plugin helper must fail the gate"
  exit 1
fi
echo "PASS: a non-plugin export in plugins/ fails the gate"

if ! PLUGINS_DIR="$plug_ok" SKILLS_DIR="$plug_ok" bash scripts/check-contract.sh AGENTS.md >/dev/null 2>&1; then
  echo "FAIL: a plugins/ module exporting only Plugin/default must pass the gate"
  exit 1
fi
echo "PASS: a well-formed plugin module passes the gate"
