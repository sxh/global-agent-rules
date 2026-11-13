# Guard: refuse in-place and bulk file edits issued from the shell.
#
# Why: the contract requires every file change to go through the edit tool, one
# file at a time, because a shell edit can write nothing and still look like it
# succeeded, and a temporary mutation can escape review. Git cannot tell which
# tool produced a byte, so the refusal has to sit at the point of use.
#
# Refused: `sed -i`, `perl -i` (including the combined `-pi`/`-ni` forms), and
# Python reading its script from stdin (`-`, the heredoc form). Read-only use of
# each tool is untouched.
#
# Deliberate exception, for a genuine bulk operation:
#   ALLOW_SHELL_EDITS=1 sed -i 's/a/b/' file
#
# Sourced from ~/.zshrc; remove that line to disable.

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

_python_edit_guard() {
    local real="$1"
    shift
    if [[ -z "${ALLOW_SHELL_EDITS:-}" ]]; then
        case "${1:-}" in
            -)
                print -u2 "refused: $real reading a script from stdin (heredoc). Use the edit tool; ALLOW_SHELL_EDITS=1 to override."
                return 1
                ;;
        esac
    fi
    command "$real" "$@"
}

python() { _python_edit_guard python "$@"; }
python3() { _python_edit_guard python3 "$@"; }
