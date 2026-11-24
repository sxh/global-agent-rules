---
name: project-scaffold
description: "Per-project requirements relocated from AGENTS.md — required files (start.sh), required pre-commit hook gates (lint/tests/95% coverage/smoke), CI/CD workflow requirements, code-review handling. Load when creating a project or setting up its gates."
---

# Project Scaffold & Gates

Relocated from `AGENTS.md` (branch `refactor/agent-layers`, 2026-09-09). Load when
creating a project, wiring its pre-commit hook or CI, or handling review findings.

Enforcement note: most of this section is (or should become) a mechanism — a hook
template, CI workflow YAML, or config — not prose the agent has to remember.

## Templates — copy, don't retype

| Template | Copy to | Purpose |
|---|---|---|
| `templates/pre-commit` | `hooks/pre-commit`, then into `.git/hooks/` | The commit tier: format, lint, type-check, affected suites, changed-line coverage, generated-artefact freshness, FFI guard, plus stale-build cleanup on rename/delete |
| `templates/pre-push` | `hooks/pre-push`, then into `.git/hooks/` | The push tier: full suites at the coverage threshold, integration, e2e, build + smoke |
| `templates/commit-task.sh` | `scripts/commit-task.sh` | Stage → preflight → affected suites → changed-line coverage → receipt → commit, in that order |
| `templates/post-commit` | `hooks/post-commit`, then into `.git/hooks/` | Commit audit trail; records each commit and flags `--no-verify` bypasses |
| `templates/start.sh` | `start.sh` (project root, executable) | Dev entry point with process-tree teardown, so Ctrl-C cannot orphan a dev server |
| `templates/ci.yml` | `.github/workflows/gate.yml` | The canonical gate in a pristine checkout; deploys gated to main/tags |
| `scripts/gate-lock.sh` | `scripts/gate-lock.sh` | One gate run at a time, with nested-run detection and dead-pid reclaim |
| `scripts/gate-receipt.sh` | `scripts/gate-receipt.sh` | Content-addressed proof the commit tier judged this exact staged tree |
| `scripts/prove-gate.sh` | `scripts/prove-gate.sh` | Prove a gate fails when the behaviour it guards is broken |
| `scripts/run-suite.ts` | `scripts/run-suite.ts` | Run a suite so a failure leaves `.gate/<suite>-failures.json` behind |
| `scripts/check-changed-line-coverage.ts` | `scripts/check-changed-line-coverage.ts` | Fail a diff whose added or modified lines no test executes (TypeScript/istanbul layout) |

The static-analysis row is stack-specific: name the tool that actually exists. For Dart/Flutter that is `flutter analyze`, not `tsc` — an ungated analyzer lets its findings accumulate and be dismissed as "pre-existing". Wire it into both the hook and CI, and assert parity (see the gate-parity test pattern).

### Checking conformance

Audit a project's gates mechanically instead of by eye:

```
bash ~/.config/opencode/skills/project-scaffold/scripts/check-gates.sh [project-dir]
```

In the OpenCode TUI this is available as the custom command `/check-gates` (defined in
`commands/check-gates.md`, which injects the script's output into the prompt), and it can also be
requested in natural language — do not make the user name the script.

It reports each gate as ACTIVE, COMMENTED, STUB, ABSENT, N/A or EXCLUDED, verifies the coverage
threshold lives in tool config rather than in prose, checks the CI workflow runs the gate in a
pristine checkout, and checks start.sh is present and executable. Exit 0 means every applicable
gate is live or explicitly excluded; exit 1 lists the gaps.

It resolves the real hook chain: `hooks/pre-commit`, `.husky/pre-commit`, whatever
`git config core.hooksPath` points at, or `.git/hooks/pre-commit` — then follows the scripts those
invoke (a hook that only calls `./runTests.sh` is a gate; the gates live in that file, two levels
deep including package.json scripts). `DEBUG_CORPUS=1` dumps the resolved text when a result looks
wrong.

Regression suite: `bash scripts/check-gates.test.sh` (9 project shapes, asserting the exit codes).

Applicability is inferred from the project's shape: `smoke` applies only where a dev server or
desktop shell exists, `ffi-guard` only to Gleam projects, and a repository with no build manifest
is treated as a non-code repository whose only required gate is its own (docs/config check).

A gate that is deliberately absent must be **recorded, not assumed** — `.gates-exclusions` in the
project root:

```
# gate    | reason                             | approved-by | date
smoke     | no build pipeline or desktop shell | steve       | 2026-09-09
coverage  | docs-only repository               | steve       | 2026-09-09
```

Never add an exclusion on your own initiative — propose it and wait for approval. The review
skill's Quality-Gate Integrity axis reads the same file.

**Scaffolding is not complete until `check-gates.sh` reports no STUB or ABSENT gate** (every other gate is ACTIVE, or its absence recorded in `.gates-exclusions`). Projects scaffolded from the commented-out template ship stubs that silently reintroduce the disabled-gate and mock-only-test classes; run the conformance check before the first commit and in CI, so a new project cannot start green with a gate switched off.

Every gate in `templates/pre-commit` is commented out: uncommenting one is a decision, and an
absent gate must be an explicit, user-approved exclusion. The review skill's Quality-Gate
Integrity axis checks exactly this. Never leave a gate stubbed as `echo 'disabled'` — a
disabled gate is the root enabler of silent defect accumulation.

**Installed hooks are not versioned.** `hooks/` is the source of truth; `.git/hooks/` is the
install target. Re-install after cloning.

**The honest limit of mechanising the commit protocol:** git cannot know whether the human
approved a commit, so the commit-permission protocol (two-turn outside an authorised sprint,
standing approval inside one) cannot be a hard gate. What is
mechanisable is friction plus an audit trail: `templates/post-commit` records every commit, and
because `--no-verify` skips the pre-commit hook but *not* post-commit, a bypass is logged as
`GATE-BYPASSED` instead of being invisible. Review `.git/commit-audit.log` to check the
protocol held.

---

### Scope Before Scaffolding

Scaffolding is a decision, not a default. Before creating a build, hooks, CI, an entry-point script, a CLI surface, or a wrapper, confirm with the user whether the request is for a project or for a self-contained example; a request for a small program does not authorise project infrastructure. When gates are removed on purpose, record the absence in `.gates-exclusions` (or the project AGENTS.md) with the approver and date, so the stripped gates are a decision rather than an omission.

### Required Per-Project Files

- **`start.sh`** - A shell script in the project root that starts the application.
  - Must be executable (`chmod +x start.sh`)
  - Must start the application in a way that users/developers can run it locally

### Gate tiers — one canonical run per tier

A project has three gate tiers, and every gate belongs to exactly one of them:

| Tier | Entry point | Contents | Target |
|---|---|---|---|
| **Preflight** | `scripts/preflight.sh`, called before `pcp_done` and by a docs/PCP-only commit | format, lint, type-check/analyze, structural caps | seconds |
| **Commit** | `hooks/pre-commit` | preflight + the suites of the packages the staged diff touches + changed-line coverage | under a minute |
| **Push** | `hooks/pre-push` and CI | full suites at the coverage threshold, integration, e2e, build + smoke | the whole truth |

The full gate belongs to the push, not to every commit. A commit tier that re-runs every suite
makes the agent batch changes to avoid a five-minute wait, which is the opposite of the small
verified commits the protocol asks for. The commit tier still judges **exactly what the commit
contains** (the staged-tree rule below), so "no commit on a red gate" means the commit tier, and
"nothing leaves this machine unverified" means the push tier. Both tiers must be live: a project
with no pre-push hook has moved the full gate into a hole.

**Commit tier (must run):** formatting, lint, type-check/analyze, the affected package suites,
changed-line coverage, and new-source-has-test.
**Push tier (must run):** every suite at the coverage threshold (**95%**), integration tests
against real collaborators, e2e where a client seam exists, and build + smoke for a project with
a build pipeline.

For desktop apps (Electron, Tauri, etc.) and web apps, unit tests alone are not sufficient. The
smoke test must verify:
- The build pipeline compiles without errors
- All referenced files exist (no dangling references in config files)
- The app process can start without crashing
- The renderer can load the app (no `ERR_FILE_NOT_FOUND` or equivalent)
If any of these checks fail, the push must be rejected.

**Every composite gate must print its own verdict.** A gate script (the hook's entry point, or a
`gate.sh` it calls) must end with `gate: PASSED (<code>)` / `gate: FAILED (<code>)` derived from an
EXIT trap and the real exit code, so a piped or truncated log cannot hide a failure. Prove the line's
failure path in a test — for example a PATH shim that fails the first step — rather than only
observing the success case. Reference: `rpg_combat_tool/scripts/gate.sh` and its `scripts/gate.test.ts`
(B400).

**One gate run at a time.** Two gate runs on one machine compete for the same CPUs and produce a
false failure that costs more than the wait it avoided (a 1423 s run with 4254 s of import time).
Every gate entry point takes an exclusive lock at `.git/gate.lock`, recording the holder's pid,
start time and label. A second run is refused (exit 3) naming the holder and the lock path; a run
started *by* the holder is the same run and proceeds; a lock whose pid is gone is reclaimed
automatically, so a crash never needs a file deleted by hand. Copy `scripts/gate-lock.sh`: source
it and call `gate_lock_hold <label>` at each entry point.

**The gate judges the staged tree, once.** Stage first, gate second, commit third — a coverage run
before staging judges a tree the commit will not contain, and a check that runs before `pcp_done`
judges a tree the close then changes. `templates/commit-task.sh -F <message-file>` is the
canonical order: `git add -A`, preflight, affected suites, changed-line coverage, commit. It
writes a receipt holding `git write-tree`, and the pre-commit hook compares it with the staged
tree, so the tier never runs twice on an identical tree and any further staged edit re-enters it
(`scripts/gate-receipt.sh`). A receipt is never a flag: it is git's own content hash.

**Changed lines ship covered.** The package percentage cannot see a rewrite: a function at 0 %
leaves the total above the threshold because its siblings carry the average. Every statement that
*starts* on a line the diff adds or modifies must have executed; a changed measured file with no
coverage entry counts as uncovered; a report older than the newest changed source it would judge
is a **failure, not an input**, because a stale report can pass an uncovered line as covered.
Implement per stack — istanbul `coverage-final.json` for vitest/JS, `DA:<line>,<hits>` in
`lcov.info` for Dart/Flutter — and copy `scripts/check-changed-line-coverage.ts` for a
`packages/*/src` TypeScript layout. Never degrade it to a ratio.

**A failing suite leaves its cause in a file.** A run that filters stdout to the summary lines
keeps the verdict and deletes the only text naming the failure, which then costs half an hour to
recover. Route every suite through a wrapper that writes `.gate/<suite>-failures.json` with each
failing test's message and stack, removes it on a pass, and passes the exit status through
unchanged (`scripts/run-suite.ts`). Read the cause from that file, not from a grep of the console.

**A gate's failure path is proven.** A gate that has only ever passed is unverified. Run
`scripts/prove-gate.sh <file> <from> <to> -- <gate command>`: it applies the probe, requires the
gate to fail, restores the file with `git checkout --`, and refuses a dirty or untracked file. It
exits 0 only when the gate failed with the probe applied, 1 when the gate still passed, and 2 when
the probe or the command could not run. Prove the gate **before** writing the commit message that
claims it works.

**The gates are tested.** Gate scripts are code: pin them with a root suite that drives real git —
a temp repo, the installed hooks, a committed change — rather than calling each script directly. A
trailer gate once read `.git/COMMIT_EDITMSG` from `pre-commit`, which `git commit -F` has not
written, and every unit test passed while the real commit went unjudged. Cover the lock (a second
run refused, a nested one allowed), the receipt (a changed tree invalidates it), the tier
selection, and the hook wiring, and assert the gates run in **both** the hook and CI so the two
cannot drift.

### Definition of Done — proof belongs to the feature

A feature that crosses an external boundary (an API response, an imported document, a datastore,
an IdP) is not done until a test drives a **captured real payload** through the production parsing
boundary to the user-visible surface. Per-layer mocks, synthetic fixtures and hand-built domain
objects prove only the assumptions encoded in the fixture; they cannot falsify the wire shape.

- Capture the real payload (redact secrets) as a committed fixture; assert the production parse
  path reaches the feature surface, not just that a helper returns a value.
- If the only such test is tracked in the backlog, the feature is **not done**: move the test into
  the feature. Backlog holds optional hardening and extra variants, never the only verification.
- At completion and commit review, name the real-capture test and the surface it covers. A feature
  whose proof is a backlog item is a blocker, not an acceptable follow-up.

**Type-check is a per-package gate, and a stubbed script is not a gate.** Each package that ships
TypeScript needs its own strict `tsconfig.json` and a `type-check` script that runs the compiler —
`echo 'Type-check disabled'` reads as a gate in `package.json` while checking nothing, which is how a
self-referential declaration reached a commit. Wire the workspace into the root script so the hook
and preflight both run it, and pin the wiring with a test asserting the script is a real compiler
invocation, the tsconfig stays strict, and the root script names the package.
- **UI reuse:** a new affordance uses the shared primitive and placement convention (the project's
  `docs/ui-primitives.md`), or the task records the justified divergence and captures the
  extraction. A control that duplicates an existing one is not done.

Failure class this guards: a WG class-feature import stripped its selection operations in the
schema, so the resolver tests (fed hand-built blocks) and the app tests (fed a hand-built snapshot)
stayed green while the sheet showed only the class feature. The real captured document would have
failed at the first parse.

### CI/CD

All projects must have GitHub Actions configured:
- **Lint check** - Run linter in CI
- **Test suite** - Run all tests in CI
- **Integration tests** - Run the real-collaborator tests (a local emulator such as DynamoDB Local, or a test stage) in CI
- **Coverage check** - Verify 95%+ coverage in CI
- **Build** - Verify project builds successfully
- **Pin the toolchain** - Pin the SDK/tool versions the gates run under (e.g., `flutter-version` for `flutter-action`, the Node version for `setup-node`) to the version the project targets; a floating channel (`channel: stable`, `@latest`) drifts ahead of the dev machine, so format/analyze gates pass locally and fail only in CI. Declare any host tool a gate shells out to (e.g., `lsof`) in the CI image, or remove the dependency.
- **Production gating** - Only deploy to production on main branch or tagged releases

### Code Review

**Empty-Config-First for Analysis Tools** — When adding a new analysis tool to the build, start with the strictest sensible configuration (e.g., `maxIssues: 0`) and only add suppressions for actual, proven violations. Do not pre-suppress rules you haven't seen fail — run the tool first, fix what it finds, then decide whether remaining violations are worth suppressing.

Add code quality tools to precommit hooks:
- **Linting** - Style and format checking
- **Static analysis** - Code quality tools (e.g., ESLint, Clippy, SonarQube)
- **Security scanning** - Vulnerability detection
- **Complexity check** - Flag overly complex code
When addressing code review findings (from automated tools, PR comments, or AI reviewers):
- **Verify before acting** — Read the relevant source lines and confirm the claim is accurate before implementing a fix. Code reviews can produce false positives (e.g., flagging imports as unused when they are used, or claiming CSS classes are missing when they exist in other files). A review may also predate the merged HEAD — re-verify every finding against current HEAD, because findings can describe code that was already fixed or wired after the reviewed revision.
- **If verified** — proceed with the fix. **If false** — do not make the change; instead leave an explicit comment **in the codebase** at the site of the finding (e.g. an inline `//` comment where the reviewer flagged the line) stating that the finding is a false positive and why. The disposition must be visible to any reviewer in the diff — a finding you verified as invalid but answered only privately is a process failure, not a silent skip.
- **Linter rules take precedence over code review suggestions** — If a code review finding conflicts with an enforced linter rule, follow the linter rule and find an alternative approach (e.g., scoping constants more narrowly rather than removing them entirely). The precommit hook enforces linter rules, so any fix that violates them will be rejected regardless of the code review's intent.

## Boundary contracts in the gate

The gate set must contain, for every boundary in the project's boundary map, a contract that spans both real sides. A feature is not Done until its touched edges are BOUND and the map is updated. Every new gate or rule must be shown failing for the defect it exists to catch before it is trusted: a gate that has only ever passed is unverified. See `boundary-contracts`.

