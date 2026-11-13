#!/bin/zsh
# Self-test for shell-edit-guard.zsh. Run: zsh shell-edit-guard.test.zsh
#
# Each case runs in a fresh zsh with the guard sourced, against a scratch file,
# so the assertions are about what the guard does, not about this shell's state.
set -u

GUARD="${0:A:h}/shell-edit-guard.zsh"
failures=0

check() {
    local label="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        print "ok   $label"
    else
        print -u2 "FAIL $label (expected $expected, got $actual)"
        failures=$((failures + 1))
    fi
}

scratch="$(mktemp)"
print "before" >"$scratch"
trap 'rm -f "$scratch"' EXIT

run() {
    zsh -c "source '$GUARD'; $1" >/dev/null 2>&1
    print $?
}

check "sed -i is refused" 1 "$(run "sed -i '' 's/before/after/' '$scratch'")"
check "the file is unchanged" "before" "$(command cat "$scratch")"
check "sed --in-place is refused" 1 "$(run "sed --in-place 's/before/after/' '$scratch'")"
check "perl -pi is refused" 1 "$(run "perl -pi -e 's/before/after/' '$scratch'")"
check "python from stdin is refused" 1 \
    "$(run "printf 'print(1)\\n' | python3 -")"

check "read-only sed still works" 0 "$(run "sed -n 'p' '$scratch'")"
check "python -c still works" 0 "$(run "python3 -c 'print(1)'")"

check "ALLOW_SHELL_EDITS overrides" 0 \
    "$(run "ALLOW_SHELL_EDITS=1 sed -i '' 's/before/after/' '$scratch'")"
check "the override actually edited" "after" "$(command cat "$scratch")"

if ((failures > 0)); then
    print -u2 "$failures case(s) failed"
    exit 1
fi
print "all cases passed"
