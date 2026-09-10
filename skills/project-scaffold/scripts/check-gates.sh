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
SCRIPT_CACHE="$(mktemp)"
SEEN="$(mktemp)"
trap 'rm -f "$CORPUS" "$SCRIPT_CACHE" "$SEEN"' EXIT
FAIL=0

# ---------------------------------------------------------------- hook discovery
hooks_path="$(git config --get core.hooksPath 2>/dev/null || true)"
hook_file=""
for cand in hooks/pre-commit .husky/pre-commit ${hooks_path:+$hooks_path/pre-commit} .git/hooks/pre-commit; do
  if [ -f "$cand" ]; then hook_file="$cand"; break; fi
done

strip_comments() { grep -vE '^[[:space:]]*#' "$1" 2>/dev/null; }

# Read package.json scripts ONCE into a cache. Looking them up per reference spawned a node
# process per call, which made the checker look hung on projects with a deep script graph.
pkg_cache_build() {
  : > "$SCRIPT_CACHE"
  [ -f package.json ] || return 0
  if command -v node >/dev/null 2>&1; then
    node -e "try{var p=require('./package.json');var s=p.scripts||{};Object.keys(s).forEach(function(k){process.stdout.write(k+'\t'+String(s[k]).replace(/\n/g,' ')+'\n')})}catch(e){}" > "$SCRIPT_CACHE" 2>/dev/null || true
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "
import json
try: d=json.load(open('package.json'))
except Exception: d={}
with open('$SCRIPT_CACHE','w') as f:
    for k,v in (d.get('scripts') or {}).items():
        f.write(str(k)+chr(9)+str(v).replace(chr(10),' ')+chr(10))
" 2>/dev/null || true
  fi
}

pkg_script_body() {
  [ -s "$SCRIPT_CACHE" ] || { printf ''; return 0; }
  awk -F'\t' -v n="$1" '$1==n { print substr($0, index($0, "\t") + 1); exit }' "$SCRIPT_CACHE"
}

# Follow each reference once: a script that calls itself (`type-check` -> `npm run type-check
# --workspace=...`) or a shared helper referenced from several places would otherwise multiply
# the chain exponentially.
seen_check() { [ -s "$SEEN" ] && grep -qxF "$1" "$SEEN"; }
seen_add()   { printf '%s\n' "$1" >> "$SEEN"; }

# A script body in a workspace package (packages/*/package.json, etc).
pkg_script_body_in() {
  local file="$1" name="$2"
  [ -f "$file" ] || { printf ''; return 0; }
  if command -v node >/dev/null 2>&1; then
    node -e "try{var p=require('./$file');process.stdout.write(((p.scripts||{})['$name'])||'')}catch(e){}" 2>/dev/null
  fi
}

# `npm test --workspaces` runs each PACKAGE's test script, not the root one — and the root script
# is frequently a stub. Without this, a project whose coverage lives in the packages reads as
# having no coverage gate at all.
append_workspace_scripts() {
  local sname="$1" f dir body
  seen_check "ws:$sname" && return 0
  seen_add "ws:$sname"
  for f in packages/*/package.json apps/*/package.json libs/*/package.json services/*/package.json; do
    [ -f "$f" ] || continue
    dir="$(dirname "$f")"
    body="$(pkg_script_body_in "$f" "$sname")"
    [ -n "$body" ] && printf '##SRC:pkg:%s/%s\n%s\n' "$dir" "$sname" "$body" >> "$CORPUS"
  done
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
  # Depth 4: hook -> script -> npm script -> the scripts that one calls. Truncating at 2 stops
  # exactly where the gate detail lives (a hook that calls runTests.sh -> test:all -> lint).
  [ "$depth" -gt 4 ] && return 0
  seen_check "$tok" && return 0
  seen_add "$tok"
  case "$tok" in
    "npm test") follow_ref "npm run test" "$depth" ;;
    "npm run "*)
      name="${tok#npm run }"
      body="$(pkg_script_body "$name")"
      [ -z "$body" ] && return 0
      printf '##SRC:pkg:%s\n%s\n' "$name" "$body" >> "$CORPUS"
      local ws=0
      printf '%s' "$body" | grep -qE -- '--workspaces|--workspace=' && ws=1
      printf '%s\n' "$body" | grep -oE "$REF_RE" | sort -u | while IFS= read -r t; do
        if [ "$ws" = 1 ]; then
          case "$t" in
            "npm test")  append_workspace_scripts test ;;
            "npm run "*) append_workspace_scripts "${t#npm run }" ;;
          esac
        fi
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
  : > "$SEEN"
  [ -n "$hook_file" ] || return 0
  printf '##SRC:hook:%s\n' "$hook_file" >> "$CORPUS"
  strip_comments "$hook_file" >> "$CORPUS"
  # while-read, not `for t in $(...)`: references contain spaces ("npm run test:all"), and word
  # splitting would shred them into unusable tokens and silently truncate the chain.
  grep -oE "$REF_RE" "$hook_file" | sort -u | while IFS= read -r t; do
    follow_ref "$t" 1
  done
}

# Drop log lines (`echo "Running smoke test..."`) from hook and helper-script sources: they report
# a gate, they do not run one. Package.json script bodies keep their echoes — there an echo IS the
# evidence that the gate is disabled. Done once per corpus: doing it per line during the scan
# spawned thousands of processes and made the checker appear hung.
filter_corpus() {
  awk '
    /^##SRC:/                    { print; pkg = ($0 ~ /^##SRC:pkg:/); next }
    /^[[:space:]]*$/             { next }
    (!pkg && $0 ~ /^[[:space:]]*echo([[:space:]]|$)/) { next }
                                 { print }
  ' "$1" > "$1.filtered" && mv "$1.filtered" "$1"
}

pkg_cache_build
build_corpus
filter_corpus "$CORPUS"

# DEBUG_CORPUS=1 prints the resolved gate text (hook + followed scripts), for when a result
# looks wrong. The SRC markers show which file each line came from.
if [ "${DEBUG_CORPUS:-0}" = "1" ]; then
  echo "--- corpus (the text that actually runs) ---"
  cat "$CORPUS"
  echo "--- end corpus ---"
  echo
fi

# First corpus line matching a pattern, with its source. Prints "source<TAB>line".
# One grep for the match, one head/tail pair to find which source it came from.
scan_corpus() {
  local pattern="$1" hit n src
  hit="$(grep -m1 -nE "$pattern" "$CORPUS")" || return 1
  n="${hit%%:*}"
  src="$(head -n "$n" "$CORPUS" | grep '^##SRC:' | tail -1)"
  printf '%s\t%s\n' "${src#\#\#SRC:}" "${hit#*:}"
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
  main_corpus="$CORPUS"
  for f in $ci_files; do
    # Analyse a workflow the same way as the hook: read it, then follow the scripts its steps
    # invoke. A step that runs `npm run test:all` covers whatever test:all covers — grepping the
    # YAML text alone reports "no gates" for a workflow that runs the whole suite.
    ci_corpus="$(mktemp)"
    CORPUS="$ci_corpus"
    : > "$SEEN"
    printf '##SRC:ci:%s\n' "$f" >> "$CORPUS"
    grep -vE '^[[:space:]]*#' "$f" >> "$CORPUS"
    grep -oE "$REF_RE" "$f" | sort -u | while IFS= read -r t; do follow_ref "$t" 1; done
    filter_corpus "$CORPUS"

    covered=""
    ci_hit() { scan_corpus "$1" >/dev/null 2>&1 && covered="$covered $2"; }
    ci_hit 'prettier|format:check|gleam format|dart format' format
    ci_hit 'eslint|npm run lint|dep-check|ktlint|clippy'    lint
    ci_hit 'type-check|typecheck|tsc |dart analyze|mypy'    type-check
    ci_hit 'vitest|jest|npm test|npm run test|gleam test'   test
    ci_hit 'coverage|--check-coverage|kover|jacoco'         coverage
    ci_hit 'npm run build|gleam build|vite build|mvn |gradle' build
    ci_hit 'smoke'                                          smoke
    printf '  %-12s %-10s %s%s\n' "ci" "PRESENT" "$(basename "$f")" "${covered:- — no gate steps detected}"
    rm -f "$ci_corpus"
    CORPUS="$main_corpus"
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
