#!/usr/bin/env bash
# Tests the incident-leak heuristic in check-contract.sh against a fixture.
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

if [ "$count" = "1" ]; then
  echo "PASS: leak heuristic counts only active untagged rule-bearing entries (got $count)"
  exit 0
fi

echo "FAIL: expected 1 leak, got '${count:-<none>}'"
printf '%s\n' "$out"
exit 1
