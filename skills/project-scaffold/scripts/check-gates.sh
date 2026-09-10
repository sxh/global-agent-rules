#!/usr/bin/env bash
# Gate conformance check — audits a project against the required gate set and the
# pre-commit template (templates/pre-commit).
#
# Usage:  check-gates.sh [project-dir]        # default: current directory
# Exit:   0 = every applicable gate is live, or explicitly excluded with a recorded reason
#         1 = gaps found (absent/commented/stubbed without an exclusion)
#
# WHY: the review skill's Quality-Gate Integrity axis checks that a project's gates exist and
# actually gate. That axis is judgement; this script is its mechanical half — it reports what is
# present, what is commented out, what is stubbed, and what is missing without an exclusion.
#
# Detection is heuristic: gate commands are found by pattern in the hook, and applicability is
# inferred from the project's shape (a library needs no smoke test; only a Gleam project needs
# the FFI guard). Everything it reports is meant to be read by a human, not trusted blindly.
#
# EXCLUSIONS: a gate that is deliberately absent must be recorded, not assumed. Create
# .gates-exclusions in the project root, one gate per line:
#
#     # gate   | reason                             | approved-by | date
#     smoke    | no build pipeline or desktop shell | steve       | 2026-09-09
#     coverage | docs-only repository               | steve       | 2026-09-09

set -uo pipefail

TARGET="${1:-.}"
if [ ! -d "$TARGET" ]; then
  echo "error: not a directory: $TARGET"
  exit 2
fi

ROOT="$( (cd "$TARGET" && git rev-parse --show-toplevel 2>/dev/null) || (cd "$TARGET" && pwd) )"
cd "$ROOT" || exit 2

EXCL_FILE=".gates-exclusions"
FAIL=0

hook_file=""
for cand in hooks/pre-commit .git/hooks/pre-commit; do
  if [ -f "$cand" ]; then hook_file="$cand"; break; fi
done

# Hook lines that are not comments — a commented gate is an absent gate.
hook_active() {
  [ -n "$hook_file" ] || return 0
  grep -vE '^[[:space:]]*#' "$hook_file"
}

pkg_script() {
  [ -f package.json ] || { printf ''; return; }
  if command -v node >/dev/null 2>&1; then
    node -e "try{var p=require('./package.json');process.stdout.write(((p.scripts||{})['$1'])||'')}catch(e){process.stdout.write('')}" 2>/dev/null
  else
    grep -m1 "\"$1\"[[:space:]]*:" package.json 2>/dev/null
  fi
}

excluded() {
  [ -f "$EXCL_FILE" ] || return 1
  grep -qE "^[[:space:]]*$1[[:space:]]*\|" "$EXCL_FILE"
}

# Some gates only apply to some projects.
applicable() {
  case "$1" in
    ffi-guard)
      [ -f gleam.toml ] || ls ./*.gleam src/*.gleam >/dev/null 2>&1 ;;
    smoke)
      grep -qE '"(dev|start)"' package.json 2>/dev/null \
        || [ -f electron/main.js ] || [ -f tauri.conf.json ] \
        || [ -f vite.config.ts ] || [ -f webpack.config.js ] ;;
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

  # A package.json that only declares dependencies is scaffolding (an editor/plugin install
  # directory, say), not a build manifest. Scripts are what make it a project.
  if [ -f package.json ]; then
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

# ACTIVE | COMMENTED | ABSENT | STUB | N/A
gate_state() {
  local pattern="$1" script_name="$2" state="ABSENT"

  if [ -n "$hook_file" ]; then
    if hook_active | grep -qE "$pattern"; then
      state="ACTIVE"
    elif grep -qE "^[[:space:]]*#[[:space:]]*.*($pattern)" "$hook_file"; then
      state="COMMENTED"
    fi
  fi

  if [ -n "$script_name" ]; then
    case "$(pkg_script "$script_name")" in
      echo*|': '*|'true'|'exit 0')
        [ "$state" = "ACTIVE" ] && state="STUB" ;;
    esac
  fi

  echo "$state"
}

report() {
  local name="$1" state="$2" note="$3"
  case "$state" in
    ACTIVE)
      printf '  %-12s %-10s %s\n' "$name" "$state" "$note" ;;
    N/A|EXCLUDED)
      printf '  %-12s %-10s %s\n' "$name" "$state" "$note" ;;
    *)
      printf '  %-12s %-10s %s\n' "$name" "$state" "$note"
      FAIL=1 ;;
  esac
}

check_gate() {
  local name="$1" pattern="$2" script_name="$3" note="$4" state
  state="$(gate_state "$pattern" "$script_name")"

  if [ "$state" = "ABSENT" ] || [ "$state" = "COMMENTED" ]; then
    if excluded "$name"; then
      report "$name" "EXCLUDED" "$(grep -E "^[[:space:]]*$name[[:space:]]*\|" "$EXCL_FILE" | head -1 | sed 's/^[[:space:]]*//; s/|/ /g')"
      return
    fi
    if ! applicable "$name"; then
      report "$name" "N/A" "not applicable to this project"
      return
    fi
    if [ "$state" = "COMMENTED" ]; then
      report "$name" "COMMENTED" "commented out in $hook_file"
    else
      report "$name" "ABSENT" "no gate in ${hook_file:-any hook}"
    fi
    return
  fi

  if [ "$state" = "ABSENT" ] && excluded "$name"; then
    report "$name" "EXCLUDED" ""
    return
  fi

  report "$name" "$state" "$note"
}

echo "gate conformance: $ROOT"
echo
echo "hook: ${hook_file:-NONE} (installed: $([ -x .git/hooks/pre-commit ] && echo yes || echo no))"
echo

if ! is_code_project; then
  echo "project shape: non-code repository (no build manifest) — application gates are N/A"
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

check_gate format     'format'                                              "format:check" "formatting check"
check_gate lint       'lint'                                                "lint"         "linter"
check_gate type-check 'type-check|typecheck|tsc |dart analyze|mypy'         "type-check"   "type checker (never stubbed)"
check_gate tests      'npm test|npm run test|vitest|jest|gleam test|mvn test|gradle test|pytest' "test" "full test suite"
check_gate coverage   'coverage|c8 |kover|jacoco|--check-coverage'          "coverage"     "coverage at the configured threshold"
check_gate build      'npm run build|gleam build|mvn |gradle|vite build'    "build"        "production build"
check_gate smoke      'smoke'                                               "smoke"        "app builds, launches, renders"
check_gate ffi-guard  '@external'                                           ""             "FFI requires explicit authorisation"

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
    grep -qE 'lint'     "$f" && steps="$steps lint"
    grep -qE 'test'     "$f" && steps="$steps test"
    grep -qE 'coverage' "$f" && steps="$steps coverage"
    grep -qE 'build'    "$f" && steps="$steps build"
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
