#!/usr/bin/env bash
# Commit a finished task in one step: stage the work, judge the staged tree, commit it.
#
#   scripts/commit-task.sh -F <commit-message-file>
#
# Order is the point. A coverage run before staging judges a tree the commit will not contain
# (and passed on that tree while failing the real one); a check run before the task close judges
# a tree the close then changes. So: stage, then gate, then commit.
#
# The receipt written by the last gate step lets the pre-commit hook skip re-judging the
# identical tree. Any further staged edit changes the tree hash and puts the hook back in charge,
# so the tier never skips a tree it has not seen.
#
# Adapt the two project-specific lines marked below; everything else is generic.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

DRY=0
MESSAGE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)
            DRY=1
            shift
            ;;
        -F)
            MESSAGE="${2:-}"
            shift 2
            ;;
        *)
            echo "commit-task: unknown option: $1" >&2
            exit 2
            ;;
    esac
done

if [ -z "$MESSAGE" ] || [ ! -f "$MESSAGE" ]; then
    echo "usage: scripts/commit-task.sh -F <commit-message-file>" >&2
    exit 2
fi

run() {
    if [ "$DRY" -eq 1 ]; then
        echo "$*"
    else
        "$@"
    fi
}

if [ "$DRY" -eq 1 ]; then
    echo "bash scripts/gate-lock.sh acquire commit-task.sh"
else
    # shellcheck source=scripts/gate-lock.sh
    . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gate-lock.sh"
    gate_lock_hold commit-task.sh
fi

run git add -A
run bash scripts/preflight.sh
# PROJECT-SPECIFIC: the commit tier's suites. A selector that maps the staged paths to the
# packages they touch is what keeps this under a minute; see scripts/affected-suites.sh in
# paints-app / rpg_combat_tool for the pattern.
run bash scripts/affected-suites.sh --cached
# PROJECT-SPECIFIC: omit only when the stack has no line-coverage report to read.
run npx tsx scripts/check-changed-line-coverage.ts
run bash scripts/gate-receipt.sh write
run git commit -F "$MESSAGE"
