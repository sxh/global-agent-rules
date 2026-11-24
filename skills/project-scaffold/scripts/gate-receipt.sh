#!/usr/bin/env bash
# Promoted from paints-app (2026-11-24). Generic: keyed on `git write-tree` alone.
# Content-addressed proof that the commit tier passed for the exact staged tree.
#
#   scripts/gate-receipt.sh write   # record the staged tree the tier just passed
#   scripts/gate-receipt.sh check   # 0 when the current staged tree is that tree
#
# Git's own tree hash is the key, not a flag: any further staged edit changes it
# and the receipt stops matching, so the pre-commit hook re-runs the tier. This
# lets scripts/commit-task.sh judge the tree and the hook not judge it twice,
# without ever skipping a tree the tier has not seen.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

RECEIPT="$(git rev-parse --git-dir)/pcp-gate-receipt"

case "${1:-check}" in
    write)
        git write-tree >"$RECEIPT"
        ;;
    check)
        [ -f "$RECEIPT" ] || exit 1
        [ "$(cat "$RECEIPT")" = "$(git write-tree)" ]
        ;;
    *)
        echo "usage: scripts/gate-receipt.sh [write|check]" >&2
        exit 2
        ;;
esac
