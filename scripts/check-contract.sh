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
# Heuristic: entries tagged [ENFORCED]/[OPEN]/[EXPIRED]/[KNOWLEDGE] are resolved; [Positive]
# practice entries and everything in the archive section are exempt by design. Remaining entries
# that use rule language ("Must", "Never", "Always") are candidate leaks for the next
# retrospective to resolve. Reported, not failed — the backlog is the resolution path.
# INCIDENTS_FILE is overridable so scripts/check-contract.test.sh can exercise the heuristic.
INCIDENTS="${INCIDENTS_FILE:-$ROOT/docs/incidents.md}"
if [ -f "$INCIDENTS" ]; then
  leaks=$(awk '/^These entries have been archived/{exit} {print}' "$INCIDENTS" \
    | grep '^- \*\*\[' \
    | grep -Ev '\[(ENFORCED|OPEN|EXPIRED|KNOWLEDGE|Positive)\]' \
    | grep -Eic '(must|never|always)' || true)
  echo "incidents: $leaks untagged rule-bearing entr(ies) — see the Effectiveness Audit step"
fi

# --- 5. Local patches to vendored files must survive a re-download ---
# plugins/pcp.ts is installed by curl from the pcp-skills repo; re-running that installer silently
# drops local patches. Each patch marks itself with a token, and this check fails if one vanishes.
while IFS=: read -r vfile vmarker; do
  [ -z "${vfile:-}" ] && continue
  [ -f "$ROOT/$vfile" ] || continue
  if grep -q "$vmarker" "$ROOT/$vfile"; then
    echo "vendored: $vfile carries $vmarker"
  else
    echo "FAIL: $vfile is missing $vmarker (re-downloaded?) — re-apply the local patch"
    fail=1
  fi
done <<'VENDORED'
plugins/pcp.ts:PCP_CACHE_FIX
plugins/pcp.ts:PCP_TASK_BINDING_FIX
plugins/pcp.ts:PCP_COMMIT_FILE_FIX
plugins/pcp.ts:PCP_PROMOTE_ENQUEUE_FIX
VENDORED

# --- 6. Type-check the TypeScript plugins (`bun test` only transpiles them) ---
if [ -f "$ROOT/plugins/tsconfig.json" ]; then
  if out="$(bash "$ROOT/scripts/type-check.sh" 2>&1)"; then
    echo "types: plugins type-check passed"
  else
    echo "FAIL: plugins type-check failed"
    printf '%s\n' "$out" | tail -20
    fail=1
  fi
fi

# --- 7. First-party test suites (skills + plugin parsers) ---
# Skills and plugins ship testable Node scripts. Run their suites so a broken
# first-party script fails the gate instead of drifting unnoticed.
# SKILLS_DIR is overridable so scripts/check-contract.test.sh can exercise this.
SKILLS_DIR="${SKILLS_DIR:-$ROOT/skills}"
PLUGINS_DIR="${PLUGINS_DIR:-$ROOT/plugins}"
TEST_COUNT="$(find "$SKILLS_DIR" "$PLUGINS_DIR" -path '*/test/*.test.mjs' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$TEST_COUNT" -gt 0 ]; then
  if out="$(find "$SKILLS_DIR" "$PLUGINS_DIR" -path '*/test/*.test.mjs' -print0 2>/dev/null \
      | xargs -0 node --test --experimental-test-coverage 2>&1)"; then
    cov="$(printf '%s\n' "$out" | awk -F'|' '/all files/ {gsub(/ /, "", $2); print $2; exit}')"
    echo "tests: $TEST_COUNT test file(s) passed (coverage ${cov:-n/a}% lines)"
  else
    echo "FAIL: first-party test suites failed"
    printf '%s\n' "$out" | tail -30
    fail=1
  fi
else
  echo "tests: no test files found"
fi

if [ "$fail" -ne 0 ]; then
  echo "contract check FAILED"
  exit 1
fi

echo "contract check passed"
