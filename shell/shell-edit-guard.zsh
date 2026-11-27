# Guard: refuse in-place and bulk file edits issued from the shell.
#
# Why: the contract requires every file change to go through the edit tool, one
# file at a time, because a shell edit can write nothing and still look like it
# succeeded, and a temporary mutation can escape review. Git cannot tell which
# tool produced a byte, so the refusal has to sit at the point of use.
#
# Refused: `sed -i`, `perl -i` (including the combined `-pi`/`-ni` forms), a
# script read from stdin (`python -`, `node -`), an inline script that carries a
# filesystem write (`node -e`, `node --eval`, `bun -e`, `python3 -c`, `-p`), a
# shell heredoc feeding a file redirect, a shell redirect into a tracked path,
# and `tee` writing a real file. Read-only use of each tool is untouched.
#
# A redirect is opened by the shell before a command function runs, so it cannot
# be refused by wrapping a command: the refusal lives in the DEBUG trap of a
# non-interactive shell, which is the shell a tool runs. Interactive shells keep
# the command wrappers but not the trap (a refusal there would kill a terminal).
#
# What this does not catch: an inline script that writes through an API the
# pattern list below does not name (a computed property, a fresh import name), a
# redirect spelled inside quotes, a compound line that `cd`s before redirecting
# (the hook sees the old working directory), or a heredoc whose redirect follows
# the body. The guard is a stop sign at the point of use, not a sandbox; review
# is still what notices the rest.
#
# Deliberate exception, for a genuine bulk operation:
#   ALLOW_SHELL_EDITS=1 sed -i 's/a/b/' file
#
# Sourced from ~/.zshenv, which non-interactive shells also read; remove that
# line to disable.

# Whether these arguments request an in-place edit: `-i`, `-i.bak`, `--in-place`,
# or a short cluster carrying `i` (perl's `-pi`, sed's `-ni`).
_refuses_in_place() {
    local arg
    for arg in "$@"; do
        case "$arg" in
            --in-place*) return 0 ;;
            -i | -i*) return 0 ;;
            -[A-Za-z]*i*) return 0 ;;
        esac
    done
    return 1
}

sed() {
    if [[ -n "${ALLOW_SHELL_EDITS:-}" ]]; then
        command sed "$@"
        return $?
    fi
    if _refuses_in_place "$@"; then
        print -u2 "refused: in-place edit via sed. Use the edit tool (or a repo rename script); ALLOW_SHELL_EDITS=1 to override."
        return 1
    fi
    command sed "$@"
}

perl() {
    if [[ -n "${ALLOW_SHELL_EDITS:-}" ]]; then
        command perl "$@"
        return $?
    fi
    if _refuses_in_place "$@"; then
        print -u2 "refused: in-place edit via perl. Use the edit tool; ALLOW_SHELL_EDITS=1 to override."
        return 1
    fi
    command perl "$@"
}

# A filesystem write inside a script body: the Node and Python spellings of the
# same act, so one list rules on every interpreter the guard wraps.
_script_write_pattern='(writeFile|appendFile|createWriteStream|writeSync|openSync|truncate|unlink|rmSync|rmdir|renameSync|copyFile|mkdirSync|fs\.write|\.write\(|\.writelines\(|\.write_text\(|\.write_bytes\(|Bun\.write|shutil\.|os\.remove|os\.rename|os\.replace|os\.makedirs|os\.mkdir)'

# Whether these arguments ask an interpreter to run code inline (python -c,
# node/bun -e/-p/--eval/--print) or from stdin (`-`), and whether that code
# carries a write.
_refuses_script_edit() {
    local arg text=" "
    local inline=0
    for arg in "$@"; do
        case "$arg" in
            -)
                # `-` is the stdin script, and `print -` / `-p -` are not how any
                # of these interpreters take a filename.
                return 0
                ;;
            --eval | --print) inline=1 ;;
            -[ecp] | -[A-Za-z]*[ecp]*) inline=1 ;;
        esac
        text="$text$arg "
    done
    # Writing to stdout or stderr is display, not an edit: `process.stdout.write`
    # is how a Node one-liner prints, and refusing it was the false positive
    # that made a timestamp probe look like a violation (2026-11-26).
    local scanned="${text//process.stdout.write/}"
    scanned="${scanned//process.stderr.write/}"
    if (( inline )) && [[ "$scanned" =~ $_script_write_pattern ]]; then
        return 0
    fi
    return 1
}

_script_edit_guard() {
    local real="$1"
    shift
    if [[ -z "${ALLOW_SHELL_EDITS:-}" ]] && _refuses_script_edit "$@"; then
        print -u2 "refused: $real running a script that writes files. Use the edit tool; ALLOW_SHELL_EDITS=1 to override."
        return 1
    fi
    command "$real" "$@"
}

python() { _script_edit_guard python "$@"; }
python3() { _script_edit_guard python3 "$@"; }
node() { _script_edit_guard node "$@"; }
bun() { _script_edit_guard bun "$@"; }

# The file a shell redirection in [line] writes, when there is one. Descriptor
# copies (`2>&1`) and process substitutions (`>(cmd)`) are not files, and a
# diagnostic to `/dev/*` is not an edit.
_redirect_target() {
    local line="$1"
    if [[ "$line" =~ '(>>?)[|]?[[:space:]]*([^&|;<>[:space:]]+)' ]]; then
        local target="${match[2]}"
        case "$target" in
            /dev/*) return 1 ;;
        esac
        print -r -- "$target"
        return 0
    fi
    return 1
}

# A redirect and a heredoc on one command line is the 2026-11-26 shape: the body
# fed to a command whose output truncates a file. The heredoc is judged on the
# command line alone, so a body that merely contains `>` (a commit message, a
# code sample) is not mistaken for one.
_guard_refuses_shell_edit() {
    local line="${1%%$'\n'*}"
    local target

    # The inner shell runs this guard itself; judging the quoted text here would
    # refuse the very command that starts it.
    if [[ "$line" =~ '^([^[:space:]]*/)?(zsh|bash|sh)[[:space:]]+-c' ]]; then
        return 1
    fi

    target="$(_redirect_target "$line")" || return 1
    if [[ "$line" == *"<<"* ]]; then
        print -u2 "refused: heredoc feeding a file redirect. Use the edit/write tool; ALLOW_SHELL_EDITS=1 to override."
        return 0
    fi
    if command git ls-files --error-unmatch -- "$target" >/dev/null 2>&1; then
        print -u2 "refused: shell redirect into tracked file '$target'. Use the edit tool; ALLOW_SHELL_EDITS=1 to override."
        return 0
    fi
    return 1
}

tee() {
    if [[ -z "${ALLOW_SHELL_EDITS:-}" ]]; then
        local arg
        for arg in "$@"; do
            case "$arg" in
                -* | - | /dev/*) ;;
                *)
                    print -u2 "refused: tee writing '$arg'. Use the edit/write tool; ALLOW_SHELL_EDITS=1 to override."
                    return 1
                    ;;
            esac
        done
    fi
    command tee "$@"
}

# A redirect is performed by the shell, so the refusal has to sit in the debug
# hook of the non-interactive shell a tool runs: returning non-zero stops that
# shell before the command (and its redirect) executes. Interactive shells keep
# the command wrappers but not this trap — a refusal there would kill a terminal.
if [[ ! -o interactive ]]; then
    TRAPDEBUG() {
        [[ -n "${ALLOW_SHELL_EDITS:-}" ]] && return 0
        if _guard_refuses_shell_edit "${ZSH_DEBUG_CMD:-}"; then
            return 1
        fi
        return 0
    }
fi
