# AGENTS.md Refactor — Triage Table (review artifact)

Status: PROPOSAL. Nothing has moved. AGENTS.md is unmodified.
Source: ~/.config/opencode/AGENTS.md — 828 lines, 112,139 chars (~28–32k tokens, loaded every turn).
Repo: sxh/global-agent-rules (git). Suggested execution branch: refactor/agent-layers.

## Principle

Every section maps to exactly one layer:

| Layer | Job | Loaded |
|---|---|---|
| AGENTS.md | operating contract | every turn |
| hooks / CI / scripts | enforcement | at gate time |
| skills/ | situational playbooks | on demand |
| docs/incidents.md | institutional memory | when a defect class recurs |
| docs/local-setup.md | machine configuration | never (human doc) |

Admission test for the contract (all three required):
applies every turn · cannot be enforced mechanically · non-obvious to a competent engineer

## Triage table

| Section | Chars | Destination | Notes |
|---|---|---|---|
| Priority Order | 453 | CONTRACT | Testability > Simplicity > Consistency. Keep as-is. |
| Process Rules | 8,144 | CONTRACT + MECHANISM | Core of the contract. Compress each rule to 2–4 lines; move incident rationale to incidents. Bypass-flag STOP, commit permission, question protocol, read-only investigation, system-change permission stay. |
| Browser Security & Proven Limitations | 1,459 | SKILL (debugging-playbook) | Situational. |
| Confirm Problem Understanding Before Coding | 1,951 | CONTRACT (2 lines) + SKILL | The "state your understanding in one sentence" rule is contract; the rest is workflow detail. |
| Language Preferences | 166 | CONTRACT | Short and stable. |
| Development Methodology (XP/TDD) | 3,975 | SKILL (xp-craftsman) | Overlaps the xp-craftsman skill you already load every session. Merge, don't duplicate. |
| Skills (loading mechanics + DRY/RPG/retrospective pointers) | ~1,200 | CONTRACT (3 lines) | Keep: how skills resolve, XP-is-default. RPG pointer is cross-tool (~/.gemini) — one line. |
| XP Craftsman Skill / RPG / Retrospective pointers | ~1,185 | CONTRACT | Pointers only. |
| Architecture (hexagonal, DSL host language) | 698 | SKILL (engineering-standards) | |
| Naming & Organization | 1,775 | SKILL (engineering-standards) | Dedupes against "Test names reveal intent" in Functional Tests. |
| Object-Oriented Design (SOLID) | 416 | ARCHIVE | Canonical knowledge; a competent engineer knows SOLID. Keep one line "SOLID applies" if wanted. |
| CLI Tools vs Test Frameworks | 486 | SKILL (engineering-standards) | |
| Testability Rules | 1,080 | SKILL (xp-craftsman) | Overlaps XP/TDD section. |
| Functional Tests Over Technical Tests | 2,899 | SKILL (testing-standards) | |
| API Pagination | 662 | SKILL (testing-standards) | |
| Required Per-Project Files (start.sh) | 211 | SKILL (project-scaffold) + TEMPLATE | Ship an actual start.sh template. |
| Required Git Precommit Hooks | 751 | MECHANISM | Ship the hook as a template + install step. Delete the prose. |
| Coverage Strategy | 943 | MECHANISM (config) + SKILL | Threshold lives in c8/vitest config. Strategy notes to skill. |
| Technology (per-stack playbooks) | 19,705 | SKILLS + INCIDENTS | Biggest single win. Gleam+Lustre+Electron, Birdie, React/TS, JVM → per-stack skills. The dated entries embedded inside (React, CI/CD, Zod, Throw-outside-try, Shopify cap) → incidents.md. |
| Security | 413 | SKILL (engineering-standards) | |
| Zero Tolerance for Errors and Warnings | 937 | MECHANISM + CONTRACT (1 line) | Gate enforces it; contract says "the gate decides". |
| Documentation | 184 | SKILL | |
| Error Handling | 998 | SKILL (engineering-standards) | |
| CI/CD | 419 | MECHANISM (workflow template) | Ship the workflow YAML. |
| Code Review | 1,530 | MECHANISM (hooks + review-harness) + SKILL | Per your own 2026-09-04 entry: the lever is the reviewer's prompt and the gate. |
| API Design | 139 | SKILL (engineering-standards) | |
| Cloud Environments | 222 | SKILL | |
| Accessibility | 1,138 | MECHANISM (lint rules) + SKILL | Several already exist as local ESLint rules (icon-button, etc.). |
| Application (scope statement) | 100 | CONTRACT | Keep as the header. |
| Obsidian ↔ OpenCode Server Setup | 3,265 | docs/local-setup.md | STALE: describes a launchd plist that no longer exists. Rewrite to current reality (Login Item app + Keychain + llama.cpp :1234). |
| Process Integrity | 2,665 | CONTRACT (short) + SKILL (Five Whys) | No skipping, no self-granted exceptions = contract. Five Whys + "defects are process failures" = skill. |
| Done Criteria + Smoke Test Principle | 1,022 | CONTRACT (2 lines) + MECHANISM | "Done = the gate passes" + smoke-test scope. Gate itself is the hook. |
| Retrospective Findings (~400 entries + archived list) | 51,287 | docs/incidents.md | Verbatim move. Keep the tag convention as the file header. Merge entries already marked Superseded into the archive list. |

## Duplication found (why the volume is worse than it looks)

- The "lint + tests + 95% coverage + smoke test" gate is specified five times: Required Git Precommit Hooks, Done Criteria, Process Integrity, CI/CD, Coverage Strategy. One mechanism, one contract line.
- "Verify against a real request/system, not assumptions" appears in Process Rules (proxy curl), API Pagination, Investigate Before Acting, and several incidents. One principle.
- "Test names reveal intent" appears in Naming & Organization and Functional Tests Over Technical Tests.
- Testability/SOLID/hexagonal overlap the xp-craftsman skill loaded every session anyway.

## Mechanisms — status ledger

Already implemented (prose can be deleted):
- FFI prohibition → hook greps `@external` (block 341-348)
- eslint-disable prohibition → local lint rule
- icon-button a11y → local ESLint rule
- N+1 detection → local ESLint rule `no-n-plus-one-dynamo`
- coverage thresholds → vitest/c8 config
- CI lint/test/coverage/build → GitHub Actions workflows
- structural debt → structural-debt-auditor skill on cadence

Identified in incidents but NOT yet enforced (close these loops):
- generated artifacts must match generator → diff check in hook (2026-08-09)
- build gates must pass in a pristine checkout → CI (2026-09-04)
- stale compiled classes after rename/delete → clean-before-build in hook (2026-09-09)
- backgrounded dev processes killed on signal → in the generated scripts themselves (2026-08-06, 2026-08-22 — this one failed again on 2026-09-09 with the orphaned sst dev)
- hook resolves repo root via `git rev-parse --show-toplevel` → hook template fix (2026-09-04)
- commit permission → hook requiring an explicit token/marker so an unauthorised commit fails loudly rather than relying on memory

## Proposed contract contents (the whole of AGENTS.md)

Header: scope (applies to all agent invocations unless a project overrides).
1. Priority order: testability, simplicity, consistency.
2. Commit permission protocol: no commit, and no code change, without explicit instruction in a separate turn. A question is not a go-ahead.
3. Question protocol: on a question, restate, answer, stop. Standing convention: prefix "Question:" or end "Answer only."
4. Bypass flags (`--no-verify`) are a STOP: freeze and narrate.
5. No self-granted exceptions: process rules apply unless the user approves a specific exception.
6. No skipping: tests, lint, coverage, hooks.
7. Investigation is read-only; investigate before acting; state your understanding in one sentence before changing code.
8. Human context is not observable: ask for paths, commands, screenshots rather than assuming.
9. Verification: evidence over assertion. Verify actual state (exit codes, git status, canonical gate command). Run generated output before claiming it works.
10. System changes (installs, PATH, config outside the project) require explicit permission.
11. Done = the gate passes (hook/CI define it).
12. Language preference: strongly typed; BEAM then JVM.
13. Skills: XP is the default mode for any implementation work; resolve natural-language requests to skills without asking the user to name them.
14. Pointers: standards → skills/; recurring defect classes → grep docs/incidents.md; machine setup → docs/local-setup.md.

Target: ~120-180 lines, ~6-8k chars.

## Governance (enforced outside the file)

- Budget: CI check fails if AGENTS.md exceeds 200 content lines / 8k chars.
- Admission: every addition names its layer; needs a mechanism OR an expiry.
- Promotion: an incident becomes a principle only after recurring 2-3 times; otherwise it stays in incidents.md.
- Retirement: quarterly pass drops contract rules with no trigger and no mechanism.
- Duplication check: search for the principle before adding a rule (as 2026-07-26 already says).

## Execution order

0. Branch: `git checkout -b refactor/agent-layers`.
1. docs/incidents.md ← Retrospective Findings (-51,287 chars, zero semantic risk).
2. skills/<stack>-playbooks ← Technology section (-19,705).
3. docs/local-setup.md ← Obsidian setup, rewritten to current reality (-3,265).
4. skills/* ← remaining Skills subsections, deduped against existing skill files (-~18,000).
5. AGENTS.md ← rewrite from the contract list above (-~12,000, leaving ~8k).
6. Mechanisms: hook template (commit token, artifact-diff, clean-build, git-root), CI budget check.
7. Verify: A/B compliance battery (10 tasks × checklist), then re-test MiniCPM5-2B with the lean file.

## Verification

- Content preservation: every destination file reviewed against the source before AGENTS.md is rewritten; `git diff` shows deletions as moves, not losses.
- Behaviour: A/B battery. Prediction: the lean file scores equal or better on compliance while being faster.
- Local model: MiniCPM5-2B re-run on a code task with ~2.5k-token rules instead of ~30k.
