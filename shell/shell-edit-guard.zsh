# Guard: refuse in-place and bulk file edits issued from the shell.
#
# Why: the contract requires every file change to go through the edit tool, one
# file at a time, because a shell edit can write nothing and still look like it
# succeeded, and a temporary mutation can escape review. Git cannot tell which
# tool produced a byte, so the refusal has to sit at the point of use.
#
# Refused: `sed -i`, `perl -i` (including the combined `-pi`/`-ni` forms), a
# script read from stdin (`python -`, `node -`), and an inline script that carries
# a filesystem write (`node -e`, `node --eval`, `bun -e`, `python3 -c`, `-p`).
# Read-only use of each tool is untouched.
#
# What this does not catch: an inline script that writes through an API the
# pattern list below does not name (a computed property, a fresh import name), or
# a shell redirection inside the script text. The guard is a stop sign at the
# point of use, not a sandbox; review is still what notices the rest.
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
    if (( inline )) && [[ "$text" =~ $_script_write_pattern ]]; then
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
