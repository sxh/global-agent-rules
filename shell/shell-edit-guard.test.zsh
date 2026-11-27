#!/bin/zsh
# Self-test for shell-edit-guard.zsh. Run: zsh shell-edit-guard.test.zsh
#
# Each case runs in a fresh zsh with the guard sourced, against a scratch file,
# so the assertions are about what the guard does, not about this shell's state.
# The runner disables its own debug trap: the case strings below quote redirect
# syntax, which the trap would otherwise judge as if it were a command.
set -u
unfunction TRAPDEBUG 2>/dev/null || true

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
repo="$(mktemp -d)"
trap 'rm -f "$scratch"; rm -rf "$repo"' EXIT

run() {
    zsh -c "source '$GUARD'; $1" >/dev/null 2>&1
    print $?
}

# The tracked-path rule resolves the target against the shell's working
# directory, so a case that needs a repository runs *in* it rather than
# `cd`-ing inside the guarded line (a compound line's trap sees the old cwd).
run_in() {
    ( cd "$1" && zsh -c "source '$GUARD'; $2" ) >/dev/null 2>&1
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

# Inline scripts are the same hole as a heredoc: the edit never passes through
# the edit tool, and a failing command can leave the file half-written.
check "node -e writing a file is refused" 1 \
    "$(run "node -e \"require('fs').writeFileSync('$scratch','after')\"")"
check "the file is unchanged after node" "before" "$(command cat "$scratch")"
check "node --eval writing a file is refused" 1 \
    "$(run "node --eval \"require('node:fs').appendFileSync('$scratch','after')\"")"
check "bun -e writing a file is refused" 1 \
    "$(run "bun -e \"await Bun.write('$scratch','after')\"")"
check "python -c writing a file is refused" 1 \
    "$(run "python3 -c \"open('$scratch','w').write('after')\"")"
check "the file is unchanged after python -c" "before" "$(command cat "$scratch")"
check "node from stdin is refused" 1 "$(run "printf 'console.log(1)\\n' | node -")"

check "node -e that only reads still works" 0 "$(run "node -e 'console.log(1)'")"

check "node -e writing to stdout still works" 0 "$(run "node -e 'process.stdout.write(String(1))'")"

# A shell redirect is performed by the shell, not by a command function, so the
# guard inspects the debug command line of a non-interactive shell (the shell a
# tool runs). A heredoc feeding a file is the 2026-11-26 shape.
check "a heredoc into a file is refused" 1 \
    "$(run "cat > '$scratch' <<'EOF'
after
EOF")"
check "the file is unchanged after the heredoc" "before" "$(command cat "$scratch")"
check "a heredoc with the redirect last is refused" 1 \
    "$(run "cat <<'EOF' > '$scratch'
after
EOF")"
check "the file is unchanged after the reversed heredoc" "before" "$(command cat "$scratch")"

# A plain redirect is a write too, but only into a tracked path: an untracked
# diagnostic file is not a project edit, and a false refusal there would stop
# ordinary debugging.
git -C "$repo" init -q
git -C "$repo" config user.email "test@example.com"
git -C "$repo" config user.name "Test"
print "before" >"$repo/tracked.txt"
git -C "$repo" add tracked.txt
git -C "$repo" commit -q -m init

check "a redirect into a tracked file is refused" 1 \
    "$(run_in "$repo" "print after > tracked.txt")"
check "the tracked file is unchanged" "before" "$(command cat "$repo/tracked.txt")"
check "a redirect into an untracked file is allowed" 0 \
    "$(run_in "$repo" "print after > untracked.txt")"
check "a redirect into /dev/null still works" 0 "$(run "print after > /dev/null")"
print "before" >"$repo/tracked.txt"
check "tee writing a tracked file is refused" 1 \
    "$(run_in "$repo" "print after | tee tracked.txt")"
check "the tracked file is unchanged after tee" "before" "$(command cat "$repo/tracked.txt")"
check "tee to /dev/null still works" 0 "$(run "print after | tee /dev/null")"

check "ALLOW_SHELL_EDITS overrides" 0 \
    "$(run "ALLOW_SHELL_EDITS=1 sed -i '' 's/before/after/' '$scratch'")"
check "the override actually edited" "after" "$(command cat "$scratch")"
check "the override covers node too" 0 \
    "$(run "ALLOW_SHELL_EDITS=1 node -e \"require('fs').writeFileSync('$scratch','node')\"")"
check "the node override actually edited" "node" "$(command cat "$scratch")"

# The guard must be loaded by the shell a tool actually runs: a *bare*
# non-interactive zsh reading a .zshenv, not one that sources the guard
# explicitly (2026-11-13: the .zshrc-only source was absent from tool shells).
zshdir="$(mktemp -d)"
print "before" >"$scratch"
print "source '$GUARD'" >"$zshdir/.zshenv"
print "python3 - <<'PY'" >"$zshdir/edit.zsh"
print "open('$scratch', 'w').write('after')" >>"$zshdir/edit.zsh"
print "PY" >>"$zshdir/edit.zsh"
ZDOTDIR="$zshdir" zsh "$zshdir/edit.zsh" >/dev/null 2>&1
check "a bare non-interactive zsh loads the guard from .zshenv" 1 "$?"
check "the bare shell wrote nothing" "before" "$(command cat "$scratch")"
rm -rf "$zshdir"

if ((failures > 0)); then
    print -u2 "$failures case(s) failed"
    exit 1
fi
print "all cases passed"
