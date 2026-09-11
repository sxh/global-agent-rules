#!/usr/bin/env bash
# Type-check a target TypeScript project (default: plugins/).
#
# `bun test` only transpiles — it does not fail on type errors — so plugins must be
# type-checked explicitly. Uses the repo-local TypeScript so the gate is hermetic.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

TARGET="${1:-plugins}"
TSC="$ROOT/node_modules/.bin/tsc"

if [ ! -x "$TSC" ]; then
  echo "FAIL: typescript is not installed (run: npm install)"
  exit 1
fi

"$TSC" --noEmit -p "$TARGET/tsconfig.json"
