#!/usr/bin/env bash
# Promoted from paints-app (2026-11-24). Generic: needs only git and a gate command.
# Prove that a gate actually fails when the behaviour it guards is broken.
#
#   scripts/prove-gate.sh <file> <from> <to> -- <gate command...>
#
# Applies the probe (<from> replaced by <to>, which must occur exactly once),
# runs the gate, captures its non-zero exit as the evidence, and restores the
# file with `git checkout --`. The tree is left clean, so a probe can never be
# mistaken for a real change and no hand-written mutation is needed.
#
# Exit status:
#   0  proof succeeded — the gate failed (non-zero) with the probe applied
#   1  proof failed — the gate still passed, so it does not guard this behaviour
#   2  usage or precondition error; the file was not touched
set -euo pipefail
export LC_ALL=C

usage() {
    echo "usage: prove-gate.sh <file> <from> <to> -- <gate command...>" >&2
    exit 2
}

die() {
    echo "prove-gate: $*" >&2
    exit 2
}

[ "$#" -ge 5 ] || usage
file=$1
from=$2
to=$3
[ "$4" = "--" ] || usage
shift 4
gate=("$@")
[ "${#gate[@]}" -gt 0 ] || die "no gate command given after --"

[ -n "$from" ] || die "the probe's <from> text must not be empty"
[ -f "$file" ] || die "not a file: $file"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git work tree"
git ls-files --error-unmatch -- "$file" >/dev/null 2>&1 ||
    die "not tracked by git: $file (it could not be restored afterwards)"
[ -z "$(git status --porcelain -- "$file")" ] ||
    die "refusing to probe a file with uncommitted changes: $file"

# Read the exact bytes (a trailing newline must survive the round trip).
original=""
IFS= read -r -d '' original <"$file" || true

stripped=${original//"$from"/}
occurrences=$(((${#original} - ${#stripped}) / ${#from}))
[ "$occurrences" -eq 1 ] || die "the probe text must occur exactly once in $file (found $occurrences)"

restore() {
    git checkout -- "$file" >/dev/null 2>&1 || true
}
trap 'restore; exit 130' INT TERM
trap restore EXIT

replaced=${original/"$from"/"$to"}
printf '%s' "$replaced" >"$file"
git diff --quiet -- "$file" && die "the probe did not change $file — <to> must differ from <from>"

status=0
output=$("${gate[@]}" 2>&1) || status=$?

restore
git diff --quiet -- "$file" || die "could not restore $file — inspect it before continuing"

# 126/127 mean the shell could not execute the gate at all, so a non-zero exit
# here is not evidence that the gate caught anything.
if [ "$status" -eq 126 ] || [ "$status" -eq 127 ]; then
    die "the gate command could not run (exit $status) — nothing was proven"
fi

if [ "$status" -eq 0 ]; then
    echo "✖ proof failed: the gate still passed with the probe applied." >&2
    echo "  file:  $file" >&2
    echo "  probe: $from -> $to" >&2
    echo "  gate:  ${gate[*]}" >&2
    exit 1
fi

echo "✔ proof: the gate failed (exit $status) with the probe applied."
echo "  file:  $file"
echo "  probe: $from -> $to"
echo "  gate:  ${gate[*]}"
if [ -n "$output" ]; then
    echo "  evidence (last 20 lines):"
    printf '%s\n' "$output" | tail -n 20 | sed 's/^/    /'
fi
exit 0
