#!/usr/bin/env bash
# Contract integrity check for the global agent rules repo.
#
# Enforces the AGENTS.md budget and pointer/frontmatter integrity. This repo has no
# application code, so contract integrity is its gate.
#
# Usage: scripts/check-contract.sh [contract-path]
#   The optional argument exists so the failure paths can be tested against a synthetic file.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

CONTRACT="${1:-AGENTS.md}"
MAX_CONTENT_LINES=200
fail=0

if [ ! -f "$CONTRACT" ]; then
  echo "FAIL: contract file not found: $CONTRACT"
  exit 1
fi

# --- 1. Budget: content lines (blank lines do not count) ---
total_lines=$(wc -l < "$CONTRACT" | tr -d ' ')
content_lines=$(grep -cve '^[[:space:]]*$' "$CONTRACT" || true)
chars=$(wc -c < "$CONTRACT" | tr -d ' ')
echo "contract: $CONTRACT — $total_lines lines, $content_lines content lines (budget $MAX_CONTENT_LINES), $chars chars"

if [ "$content_lines" -gt "$MAX_CONTENT_LINES" ]; then
  echo "FAIL: contract exceeds its $MAX_CONTENT_LINES-line budget."
  echo "      Demote entries to skills/, docs/incidents.md or a mechanism before adding more."
  fail=1
fi

# --- 2. Every skills/... or docs/... path the contract references must exist ---
while read -r p; do
  [ -z "$p" ] && continue
  if [ ! -e "$ROOT/$p" ]; then
    echo "FAIL: $CONTRACT references a path that does not exist: $p"
    fail=1
  fi
done < <(grep -o '\(skills\|docs\)/[A-Za-z0-9_.-]*\(/[A-Za-z0-9_.-]*\)*' "$CONTRACT" | sort -u)

# --- 3. Every skill declares name + description frontmatter (otherwise it cannot load) ---
for f in "$ROOT"/skills/*/SKILL.md; do
  [ -e "$f" ] || continue
  rel="${f#"$ROOT"/}"
  head -5 "$f" | grep -q '^name:' || { echo "FAIL: $rel is missing 'name:' frontmatter"; fail=1; }
  head -5 "$f" | grep -q '^description:' || { echo "FAIL: $rel is missing 'description:' frontmatter"; fail=1; }
done

# --- 4. Incident entries that assert a rule must carry a status tag ---
# Heuristic: entries tagged [ENFORCED]/[OPEN]/[EXPIRED] are fine; untagged entries that use
# rule language ("Must", "Never", "Always") are reported as candidate leaks for the next
# retrospective to resolve. Reported, not failed — the backlog is the resolution path.
if [ -f "$ROOT/docs/incidents.md" ]; then
  leaks=$(grep -n '^- \*\*\[' "$ROOT/docs/incidents.md" \
    | grep -Ev '\[(ENFORCED|OPEN|EXPIRED)\]' \
    | grep -Eic '(must|never|always)' || true)
  echo "incidents: $leaks untagged rule-bearing entr(ies) — see the Effectiveness Audit step"
fi

if [ "$fail" -ne 0 ]; then
  echo "contract check FAILED"
  exit 1
fi

echo "contract check passed"
