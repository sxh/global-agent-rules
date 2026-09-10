#!/usr/bin/env bash
# Gate conformance check — audits a project against the required gate set and the
# pre-commit template (templates/pre-commit).
#
# Usage:  check-gates.sh [project-dir]        # default: current directory
# Exit:   0 = every applicable gate is live, or explicitly excluded with a recorded reason
#         1 = gaps found (absent/commented/stubbed without an exclusion)
#
# WHY: the review skill's Quality-Gate Integrity axis checks that a project's gates exist and
# actually gate. That axis is judgement; this script is its mechanical half.
#
# HOW IT RESOLVES THE GATE:
#   1. Finds the hook: hooks/pre-commit, .husky/pre-commit, $(git config core.hooksPath)/pre-commit,
#      or .git/hooks/pre-commit. Husky v9 sets core.hooksPath and installs nothing in .git/hooks.
#   2. Follows indirection: a hook that just calls ./runTests.sh IS a gate — the gates live there.
#      Referenced shell scripts and package.json scripts are followed two levels deep.
#   3. Classifies each gate from the text that actually runs: ACTIVE, COMMENTED, STUB, ABSENT,
#      N/A (not applicable to this project) or EXCLUDED (recorded).
# Detection is heuristic and provenance-aware: a gate whose only evidence is an `echo` script is a
# STUB, not a gate. Read the output; do not trust it blindly.
#
# EXCLUSIONS: a gate that is deliberately absent must be recorded, not assumed. Create
# .gates-exclusions in the project root, one gate per line:
#
#     # gate   | reason                          | approved-by | date
#     smoke    | no desktop shell                | steve       | 2026-09-09
#     coverage | docs-only repository            | steve       | 2026-09-09

set -uo pipefail

TARGET="${1:-.}"
if [ ! -d "$TARGET" ]; then
  echo "error: not a directory: $TARGET"
  exit 2
fi

ROOT="$( (cd "$TARGET" && git rev-parse --show-toplevel 2>/dev/null) || (cd "$TARGET" && pwd) )"
cd "$ROOT" || exit 2

EXCL_FILE=".gates-exclusions"
CORPUS="$(mktemp)"
trap 'rm -f "$CORPUS"' EXIT
FAIL=0

# ---------------------------------------------------------------- hook discovery
hooks_path="$(git config --get core.hooksPath 2>/dev/null || true)"
hook_file=""
for cand in hooks/pre-commit .husky/pre-commit ${hooks_path:+$hooks_path/pre-commit} .git/hooks/pre-commit; do
  if [ -f "$cand" ]; then hook_file="$cand"; break; fi
done

strip_comments() { grep -vE '^[[:space:]]*#' "$1" 2>/dev/null; }

pkg_script_body() {
  [ -f package.json ] || { printf ''; return; }
  if command -v node >/dev/null 2>&1; then
    node -e "try{var p=require('./package.json');process.stdout.write(((p.scripts||{})['$1'])||'')}catch(e){process.stdout.write('')}" 2>/dev/null
  else
    grep -m1 "\"$1\"[[:space:]]*:" package.json 2>/dev/null
  fi
}

# An echo-only body is a disabled gate, not a gate. "Only" is the operative word: a body that
# echoes and then does real work is a gate; a body that echoes and stops is a stub.
is_stub_body() {
  local b="$1" rest
  case "$b" in
    ''|': '*|'true'|'exit 0') return 0 ;;
  esac
  rest="$(printf '%s' "$b" | sed -E 's/^[[:space:]]*echo[[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^;&|]*)[[:space:]]*(&&|;|\|\|)?[[:space:]]*//')"
  case "$rest" in
    ''|'exit 0'|'true'|':') return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------- corpus build
REF_RE='(npm run [A-Za-z0-9:_.-]+|npm test|\./[A-Za-z0-9_./-]+\.sh|[A-Za-z0-9_-]+\.sh)'

follow_ref() {
  local tok="$1" depth="$2" name body f t
  [ "$depth" -gt 2 ] && return 0
  case "$tok" in
    "npm test") follow_ref "npm run test" "$depth" ;;
    "npm run "*)
      name="${tok#npm run }"
      body="$(pkg_script_body "$name")"
      [ -z "$body" ] && return 0
      printf '##SRC:pkg:%s\n%s\n' "$name" "$body" >> "$CORPUS"
      printf '%s\n' "$body" | grep -oE "$REF_RE" | sort -u | while IFS= read -r t; do
        follow_ref "$t" $((depth + 1))
      done
      ;;
    *)
      f="${tok#./}"
      [ -f "$f" ] || return 0
      printf '##SRC:file:%s\n' "$f" >> "$CORPUS"
      strip_comments "$f" >> "$CORPUS"
      grep -oE "$REF_RE" "$f" | sort -u | while IFS= read -r t; do
        follow_ref "$t" $((depth + 1))
      done
      ;;
  esac
}

build_corpus() {
  : > "$CORPUS"
  [ -n "$hook_file" ] || return 0
  printf '##SRC:hook:%s\n' "$hook_file" >> "$CORPUS"
  strip_comments "$hook_file" >> "$CORPUS"
  # while-read, not `for t in $(...)`: references contain spaces ("npm run test:all"), and word
  # splitting would shred them into unusable tokens and silently truncate the chain.
  grep -oE "$REF_RE" "$hook_file" | sort -u | while IFS= read -r t; do
    follow_ref "$t" 1
  done
}
build_corpus

# DEBUG_CORPUS=1 prints the resolved gate text (hook + followed scripts), for when a result
# looks wrong. The SRC markers show which file each line came from.
if [ "${DEBUG_CORPUS:-0}" = "1" ]; then
  echo "--- corpus (the text that actually runs) ---"
  cat "$CORPUS"
  echo "--- end corpus ---"
  echo
fi

# First corpus line matching a pattern, with its source. Prints "source<TAB>line".
# Log lines (`echo "Running smoke test..."`) are skipped: they report a gate, they do not run one.
scan_corpus() {
  local pattern="$1" line src="hook"
  while IFS= read -r line; do
    case "$line" in
      "##SRC:"*) src="${line#\#\#SRC:}"; continue ;;
    esac
    [ -z "$line" ] && continue
    # Skip log lines from hooks and helper scripts (`echo "Running smoke test..."` reports a
    # gate, it does not run one) — but never skip a package.json script body, where an echo IS
    # the evidence that the gate is disabled.
    case "$src" in
      pkg:*) ;;
      *)
        case "$(printf '%s' "$line" | sed 's/^[[:space:]]*//')" in
          echo\ *|echo) continue ;;
        esac
        ;;
    esac
    if printf '%s\n' "$line" | grep -qE "$pattern"; then
      printf '%s\t%s\n' "$src" "$line"
      return 0
    fi
  done < "$CORPUS"
  return 1
}

excluded() {
  [ -f "$EXCL_FILE" ] || return 1
  grep -qE "^[[:space:]]*$1[[:space:]]*\|" "$EXCL_FILE"
}

applicable() {
  case "$1" in
    ffi-guard)
      [ -f gleam.toml ] || ls ./*.gleam src/*.gleam >/dev/null 2>&1 ;;
    smoke)
      grep -qE '"(dev|start)"' package.json 2>/dev/null \
        || [ -f electron/main.js ] || [ -f tauri.conf.json ] \
        || [ -f vite.config.ts ] || [ -f webpack.config.js ] \
        || scan_corpus 'smoke' >/dev/null 2>&1 ;;
    *)
      return 0 ;;
  esac
}

# A repository with no build manifest is not a code project: the application gates are
# meaningless there, but the repository still needs *a* gate of its own (docs/config check).
is_code_project() {
  for m in gleam.toml pom.xml build.gradle build.gradle.kts Cargo.toml pyproject.toml go.mod; do
    [ -f "$m" ] && return 0
  done
  ls ./*.csproj >/dev/null 2>&1 && return 0

  # A package.json that only declares dependencies is scaffolding (an editor or plugin install
  # directory), not a build manifest. Scripts are what make it a project.
  if [ -f package.json ]; then
    local n
    if command -v node >/dev/null 2>&1; then
      n=$(node -e "try{const p=require('./package.json');process.stdout.write(String(Object.keys(p.scripts||{}).length))}catch(e){process.stdout.write('0')}" 2>/dev/null)
    else
      n=$(grep -c '"scripts"' package.json 2>/dev/null || echo 0)
    fi
    [ "${n:-0}" -gt 0 ] && return 0
  fi

  # Source files make it a code project even without a script block.
  ls src/* app/* lib/* 2>/dev/null | head -1 | grep -q . && return 0
  return 1
}

# Resolve a matched line to the text that will actually execute.
effective_text() {
  local src="$1" line="$2" inv body
  inv="$(printf '%s\n' "$line" | sed -nE 's/^[[:space:]]*(npm run |npm )([A-Za-z0-9:_.-]+)[[:space:]]*$/\2/p')"
  if [ -n "$inv" ]; then
    body="$(pkg_script_body "$inv")"
    [ -n "$body" ] && { printf '%s' "$body"; return; }
  fi
  case "$src" in
    pkg:*)
      body="$(pkg_script_body "${src#pkg:}")"
      [ -n "$body" ] && { printf '%s' "$body"; return; } ;;
  esac
  printf '%s' "$line"
}

report() {
  local name="$1" state="$2" note="$3"
  case "$state" in
    ACTIVE|N/A) printf '  %-12s %-10s %s\n' "$name" "$state" "$note" ;;
    EXCLUDED)   printf '  %-12s %-10s %s\n' "$name" "$state" "$(grep -E "^[[:space:]]*$name[[:space:]]*\|" "$EXCL_FILE" | head -1 | sed 's/^[[:space:]]*//; s/|/ /g')" ;;
    *)          printf '  %-12s %-10s %s\n' "$name" "$state" "$note"; FAIL=1 ;;
  esac
}

check_gate() {
  local name="$1" pattern="$2" note="$3" res src line text inv stubcheck=0
  res="$(scan_corpus "$pattern")" || res=""

  if [ -n "$res" ]; then
    src="${res%%$'\t'*}"
    line="${res#*$'\t'}"
    # Only a package.json script body — or a line that is a bare script invocation — can be a
    # stub. A plain command line in the hook or a helper script is evidence the gate runs.
    case "$src" in pkg:*) stubcheck=1 ;; esac
    inv="$(printf '%s\n' "$line" | sed -nE 's/^[[:space:]]*(npm run |npm )([A-Za-z0-9:_.-]+)[[:space:]]*$/\2/p')"
    [ -n "$inv" ] && stubcheck=1
    text="$(effective_text "$src" "$line")"
    if [ "$stubcheck" = 1 ] && is_stub_body "$text"; then
      report "$name" "STUB" "the invoked script only echoes — a disabled gate, not a gate"
    else
      report "$name" "ACTIVE" "$note"
    fi
    return
  fi

  if [ -n "$hook_file" ] && grep -qE "^[[:space:]]*#[[:space:]]*.*($pattern)" "$hook_file" 2>/dev/null; then
    if excluded "$name"; then report "$name" "EXCLUDED" ""; else report "$name" "COMMENTED" "commented out in $hook_file"; fi
    return
  fi

  if excluded "$name"; then
    report "$name" "EXCLUDED" "$(grep -E "^[[:space:]]*$name[[:space:]]*\|" "$EXCL_FILE" | head -1 | sed 's/^[[:space:]]*//; s/|/ /g')"
    return
  fi
  if ! applicable "$name"; then
    report "$name" "N/A" "not applicable to this project"
    return
  fi
  report "$name" "ABSENT" "no gate in the hook chain${hook_file:+ ($hook_file)}"
}

echo "gate conformance: $ROOT"
echo
echo "hook chain: ${hook_file:-NONE}${hooks_path:+  [core.hooksPath=$hooks_path]}"
if [ -n "$hook_file" ]; then
  ind="$(grep -oE "$REF_RE" "$hook_file" | sort -u | tr '\n' ' ')"
  echo "  invokes:  ${ind:-(direct commands)}"
fi
echo

if ! is_code_project; then
  echo "  (non-code repository: no build manifest — application gates do not apply)"
  echo
  if [ -n "$hook_file" ]; then
    printf '  %-12s %-10s %s\n' "repo-gate" "PRESENT" "$hook_file (the repository's own check)"
    echo
    echo "RESULT: conforms as a non-code repository — its gate is $hook_file"
    exit 0
  fi
  if excluded repo-gate; then
    printf '  %-12s %-10s %s\n' "repo-gate" "EXCLUDED" ""
    echo
    echo "RESULT: conforms — no repository gate, recorded as an exclusion"
    exit 0
  fi
  printf '  %-12s %-10s %s\n' "repo-gate" "ABSENT" "a non-code repository still needs a gate (docs/config integrity check)"
  echo
  echo "RESULT: gaps found — add a repository gate, or record a repo-gate exclusion"
  exit 1
fi

echo "  GATE         STATE      DETAIL"

check_gate format     'prettier|format:check|gleam format|dart format|--check-format' "formatting check"
check_gate lint       'eslint|npm run lint|ktlint|clippy|npm run dep-check'            "linter"
check_gate type-check 'type-check|typecheck|tsc|dart analyze|mypy'                     "type checker (never stubbed)"
check_gate tests      'vitest|jest|npm test|npm run test|gleam test|mvn test|pytest'   "full test suite"
check_gate coverage   'coverage|c8 |kover|jacoco|--check-coverage'                     "coverage at the configured threshold"
check_gate build      'npm run build|gleam build|mvn |gradle|vite build|tsc --build'   "production build"
check_gate smoke      'smoke'                                                          "app builds, launches, renders"
check_gate ffi-guard  '@external'                                                      "FFI requires explicit authorisation"

# --- Coverage threshold must live in the tool config, not in prose or in the hook ---
echo
thresh=""
for cfg in .c8rc.json .c8rc vitest.config.ts vitest.config.js vitest.config.mjs jest.config.js jest.config.ts jest.config.cjs package.json; do
  if [ -f "$cfg" ] && grep -qE 'thresholds|check-coverage|coverageThreshold' "$cfg" 2>/dev/null; then
    thresh="$cfg"
    break
  fi
done
[ -f pom.xml ] && grep -q 'jacoco' pom.xml 2>/dev/null && thresh="pom.xml (jacoco)"
if [ -n "$thresh" ]; then
  printf '  %-12s %-10s %s\n' "threshold" "PRESENT" "configured in $thresh"
elif excluded coverage; then
  printf '  %-12s %-10s %s\n' "threshold" "EXCLUDED" "coverage excluded for this project"
else
  printf '  %-12s %-10s %s\n' "threshold" "ABSENT" "no threshold in tool config — an ungated number is not a gate"
  FAIL=1
fi

# --- CI runs the gate in a pristine checkout (a separate gate from the local hook) ---
echo
ci_files=$(ls .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null || true)
if [ -n "$ci_files" ]; then
  for f in $ci_files; do
    steps=""
    grep -qE 'lint'        "$f" && steps="$steps lint"
    grep -qE 'type-check'  "$f" && steps="$steps type-check"
    grep -qE 'test'        "$f" && steps="$steps test"
    grep -qE 'coverage'    "$f" && steps="$steps coverage"
    grep -qE 'build'       "$f" && steps="$steps build"
    printf '  %-12s %-10s %s%s\n' "ci" "PRESENT" "$(basename "$f")" "$steps"
  done
elif excluded ci; then
  printf '  %-12s %-10s %s\n' "ci" "EXCLUDED" ""
else
  printf '  %-12s %-10s %s\n' "ci" "ABSENT" "no .github/workflows — the pristine-checkout gate is missing"
  FAIL=1
fi

# --- start.sh: the dev entry point ---
echo
if [ -f start.sh ] && [ -x start.sh ]; then
  printf '  %-12s %-10s %s\n' "start.sh" "PRESENT" "executable"
elif [ -f start.sh ]; then
  printf '  %-12s %-10s %s\n' "start.sh" "NOT-EXEC" "exists but not executable (chmod +x start.sh)"
  FAIL=1
elif excluded start.sh; then
  printf '  %-12s %-10s %s\n' "start.sh" "EXCLUDED" ""
else
  printf '  %-12s %-10s %s\n' "start.sh" "ABSENT" "no dev entry point"
  FAIL=1
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: conforms — every applicable gate is live or explicitly excluded"
  exit 0
fi
echo "RESULT: gaps found — add the gate, or record an exclusion in $EXCL_FILE with a reason and approver"
exit 1
