#!/usr/bin/env bash
# Count ACTIVE incident entries that assert a rule (must/never/always) but carry no
# status tag. Shared by check-contract.sh (§4, which enforces a zero-leak budget) and
# check-contract.test.sh (fixture + live assertions), so the heuristic has one home.
#
# Exempt by design: [ENFORCED] / [OPEN] / [EXPIRED] / [KNOWLEDGE] tagged entries,
# [Positive] practice entries, and everything in the archive section.
#
# Usage: scripts/incident-leaks.sh [incidents-file]   (prints the integer count)
set -uo pipefail

INCIDENTS="${1:-docs/incidents.md}"
if [ ! -f "$INCIDENTS" ]; then
  echo 0
  exit 0
fi

awk '/^These entries have been archived/{exit} {print}' "$INCIDENTS" \
  | grep '^- \*\*\[' \
  | grep -Ev '\[(ENFORCED|OPEN|EXPIRED|KNOWLEDGE|Positive)\]' \
  | grep -Eic '(must|never|always)' || true
