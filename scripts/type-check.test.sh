#!/usr/bin/env bash
# Tests scripts/type-check.sh against a good and a deliberately-bad fixture.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

cat > "$fixture/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["**/*.ts"]
}
JSON

printf 'const n: number = 1;\nexport default n;\n' > "$fixture/good.ts"
if ! bash scripts/type-check.sh "$fixture" >/dev/null 2>&1; then
  echo "FAIL: a well-typed fixture must pass"
  exit 1
fi

printf 'const n: number = "not a number";\nexport default n;\n' > "$fixture/bad.ts"
if bash scripts/type-check.sh "$fixture" >/dev/null 2>&1; then
  echo "FAIL: a type error must fail the gate"
  exit 1
fi

echo "PASS: type-check gate accepts good code and rejects type errors"
