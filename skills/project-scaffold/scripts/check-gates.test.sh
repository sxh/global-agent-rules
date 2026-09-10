#!/bin/bash
# Full regression for check-gates.sh — no `set -e`: the checker is supposed to exit 1 on gaps.
S="$HOME/.config/opencode/skills/project-scaffold/scripts/check-gates.sh"
run() { # label, dir, expected-exit
  out=$(bash "$S" "$2" 2>&1); code=$?
  verdict=$(printf '%s\n' "$out" | tail -1)
  if [ "$code" = "$3" ]; then mark="PASS"; else mark="FAIL"; fi
  printf '[%s] %-28s exit=%s (want %s)\n        %s\n' "$mark" "$1" "$code" "$3" "$verdict"
  printf '%s\n' "$out" | sed -n '/^  GATE/,/^$/p' | sed 's/^/        /'
  echo
}

# --- A: conforming app -------------------------------------------------------
A=/tmp/gc-a; rm -rf $A; mkdir -p $A/hooks $A/.github/workflows; cd $A; git init -q
cat > hooks/pre-commit <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
npm run format:check
npm run lint
npm run type-check
npm test
npm run coverage
npm run build
npm run smoke
EOF
cat > package.json <<'EOF'
{"name":"a","scripts":{"dev":"vite","format:check":"prettier --check .","lint":"eslint .","type-check":"tsc --noEmit","test":"vitest run","coverage":"vitest run --coverage","build":"vite build","smoke":"node smoke.mjs"}}
EOF
echo 'export default { test: { coverage: { thresholds: { lines: 95 } } } }' > vitest.config.ts
printf 'name: gate\non: [push]\njobs:\n  g:\n    steps:\n      - run: npm run lint\n      - run: npm run coverage\n      - run: npm run build\n' > .github/workflows/gate.yml
printf '#!/usr/bin/env bash\necho dev\n' > start.sh; chmod +x start.sh
run "A conforming app" "$A" 0

# --- B: stubbed + commented --------------------------------------------------
cd $A
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts["type-check"]="echo NO_TYPE_CHECK";fs.writeFileSync("package.json",JSON.stringify(p,null,2))'
sed -i '' 's|^npm run smoke|# npm run smoke|' hooks/pre-commit
run "B stub + commented" "$A" 1

# --- C: exclusion recorded ---------------------------------------------------
printf 'smoke | no desktop shell | steve | 2026-09-09\n' > .gates-exclusions
run "C excluded smoke (stub remains)" "$A" 1

# --- D: husky + script indirection (the bug just fixed) ----------------------
D=/tmp/gc-d; rm -rf $D; mkdir -p $D/.husky $D/scripts; cd $D; git init -q
git config core.hooksPath .husky/_
printf './scripts/gate.sh\n' > .husky/pre-commit
cat > scripts/gate.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
npm run verify
EOF
cat > package.json <<'EOF'
{"name":"d","scripts":{"verify":"npm run lint && npm run test && npm run coverage","lint":"eslint .","test":"vitest run","coverage":"vitest run --coverage"}}
EOF
chmod +x scripts/gate.sh
run "D husky + indirection" "$D" 1

# --- E: husky indirection to a STUBBED script --------------------------------
cd $D
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts["verify"]="echo disabled; exit 0";fs.writeFileSync("package.json",JSON.stringify(p,null,2))'
run "E husky -> stubbed verify" "$D" 1

# --- J: workspace monorepo — coverage lives in the packages, root test is a stub ---
J=/tmp/gc-j; rm -rf $J; mkdir -p $J/.husky $J/packages/core $J/.github/workflows; cd $J; git init -q
git config core.hooksPath .husky/_
printf './runTests.sh\n' > .husky/pre-commit
printf 'npm run test:all\nnpm run build\n' > runTests.sh
cat > package.json <<'EOF'
{"name":"j","private":true,"workspaces":["packages/*"],"scripts":{"test":"echo \"Error: no test specified\" && exit 1","test:all":"npm run lint && npm run type-check && npm test --workspaces --if-present","lint":"prettier --check . && eslint .","type-check":"tsc --noEmit","build":"vite build"}}
EOF
printf '{"name":"@j/core","scripts":{"test":"vitest run --coverage --bail 1"}}\n' > packages/core/package.json
echo 'export default { test: { coverage: { thresholds: { lines: 95 } } } }' > vitest.config.ts
printf 'name: gate\non: [push]\njobs:\n  g:\n    steps:\n      - run: npm run test:all\n' > .github/workflows/gate.yml
printf '#!/usr/bin/env bash\necho start\n' > start.sh; chmod +x start.sh
run "J workspace: coverage in packages" "$J" 0

# --- F: docs repo, no gate ---------------------------------------------------
F=/tmp/gc-f; rm -rf $F; mkdir -p $F; cd $F; git init -q; echo "# docs" > README.md
run "F docs repo no gate" "$F" 1

# --- G: docs repo, repo-gate excluded ---------------------------------------
printf 'repo-gate | throwaway demo | steve | 2026-09-09\n' > $F/.gates-exclusions
run "G docs repo excluded" "$F" 0

# --- H: this repo, and the real project -------------------------------------
run "H config repo (own gate)" "$HOME/.config/opencode" 0
run "I scheduler4" "$HOME/projects/scheduler4" 1
