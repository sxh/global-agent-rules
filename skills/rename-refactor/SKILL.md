---
name: rename-refactor
description: Cross-repo rename workflow for Dart/TS symbols and files — vocabulary check, reference sweep, dry-run, apply, regenerate, gate. Use when renaming a class, file or symbol across packages on the RPG combat tool or a similar repo.
---

# Rename Refactor

A rename is a behaviour-preserving refactor. Its guard is the existing suite plus the
analyzer proving no consumer was missed — not a new failing behaviour test (see
`xp-craftsman`'s deletion/refactor red guard). Use the repo helper instead of hand-editing
symbols across files.

## Prerequisites

- A clean working tree. The helper refuses to apply on a dirty tree (pass
  `--allow-dirty` only after confirming the dirty files are bookkeeping such as
  `.opencode/pcp`, not work in progress).
- The old → new pair for each symbol and file. Check `docs/glossary.md` first: if the
  rename changes a domain term, update the glossary and the sibling surfaces in the same
  change.

## Workflow

1. **Vocabulary.** Confirm the new name against `docs/glossary.md` and the sibling surfaces.
   A name that encodes a surface/layer distinction (e.g. `DndPcEditorScreen` vs
   `Pf2ePcSheetScreen` vs `SharedPlayerViewScreen`) is worth the rename; otherwise stop.
2. **Reference sweep.** Read the existing references before renaming:
   `rg -n '\bOldSymbol\b|old_file\.dart'` across `packages/`, `scripts/`, `docs/` and config.
   Note routing entries, imports, mixin generics, test widget types and generated imports.
3. **Dry run.** `npx tsx scripts/refactor-rename.ts --symbol Old:New --file old/path:new/path`.
   Review the per-file replacement counts; add any missing file/symbol pairs.
4. **Apply.** Re-run with `--apply`. It moves files with `git mv`, replaces whole-word
   symbols and file references in tracked text files, and runs `scripts/gate.sh`. Review
   `git diff` for semantic references the word-boundary sweep cannot know (string literals,
   prose, generated output).
5. **Regenerate, don't edit.** Generated files (`*.g.dart`, `*.g.ts`, the character
   catalogue) are skipped by the helper; run their generator
   (`npx tsx scripts/gen-*.ts`) and commit the regenerated output.
6. **Gate and commit.** Run the structural-debt scan and the gate, then commit with the PCP
   state (`pcp_done` / `scripts/commit.sh`). A rename that leaves a stale reference is not
   done — the analyzer/test suite is the no-consumer proof.

## What the helper does not do

- It does not rename behaviour, string values or prose meaning; review the diff.
- It does not add a dependency or an AST tool; the Dart/TS language-server rename is the
  upgrade path if word-boundary replacement proves insufficient.
- It does not stage or commit; the caller owns the commit and the PCP state.

## See also

- `xp-craftsman` — the pre-RED inventory and the deletion/refactor red guard.
- `code-review-and-quality` — Step 3b sibling-surface sweep.
- `structural-debt-auditor` — the duplication/abstraction scan the rename should leave green.
- `pcp-operations` — commit the task state with the code.
