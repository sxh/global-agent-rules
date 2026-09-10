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
| `templates/pre-commit` | `hooks/pre-commit`, then into `.git/hooks/` | The gate: format, lint, type-check, tests, coverage, generated-artefact freshness, FFI guard, smoke test, plus stale-build cleanup on rename/delete |
| `templates/post-commit` | `hooks/post-commit`, then into `.git/hooks/` | Commit audit trail; records each commit and flags `--no-verify` bypasses |
| `templates/start.sh` | `start.sh` (project root, executable) | Dev entry point with process-tree teardown, so Ctrl-C cannot orphan a dev server |
| `templates/ci.yml` | `.github/workflows/gate.yml` | The canonical gate in a pristine checkout; deploys gated to main/tags |

### Checking conformance

Audit a project's gates mechanically instead of by eye:

```
bash ~/.config/opencode/skills/project-scaffold/scripts/check-gates.sh [project-dir]
```

It reports each gate as ACTIVE, COMMENTED, STUB, ABSENT, N/A or EXCLUDED, verifies the coverage
threshold lives in tool config rather than in prose, checks the CI workflow runs the gate in a
pristine checkout, and checks start.sh is present and executable. Exit 0 means every applicable
gate is live or explicitly excluded; exit 1 lists the gaps.

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

Every gate in `templates/pre-commit` is commented out: uncommenting one is a decision, and an
absent gate must be an explicit, user-approved exclusion. The review skill's Quality-Gate
Integrity axis checks exactly this. Never leave a gate stubbed as `echo 'disabled'` — a
disabled gate is the root enabler of silent defect accumulation.

**Installed hooks are not versioned.** `hooks/` is the source of truth; `.git/hooks/` is the
install target. Re-install after cloning.

**The honest limit of mechanising the commit protocol:** git cannot know whether the human
approved a commit, so the two-turn permission protocol cannot be a hard gate. What is
mechanisable is friction plus an audit trail: `templates/post-commit` records every commit, and
because `--no-verify` skips the pre-commit hook but *not* post-commit, a bypass is logged as
`GATE-BYPASSED` instead of being invisible. Review `.git/commit-audit.log` to check the
protocol held.

---

### Required Per-Project Files

- **`start.sh`** - A shell script in the project root that starts the application.
  - Must be executable (`chmod +x start.sh`)
  - Must start the application in a way that users/developers can run it locally

### Required Git Precommit Hooks

Every project must have a precommit hook (at `hooks/pre-commit` or `.git/hooks/pre-commit`) that runs:
1. **Linting** - Check code style/formatting
2. **Tests** - Run the full test suite
3. **Coverage** - Verify code coverage is at least **95%**
4. **Smoke test** (for desktop/web apps) - Verify the app builds and launches without errors
For desktop apps (Electron, Tauri, etc.) and web apps, unit tests alone are not sufficient. The smoke test must verify:
- The build pipeline compiles without errors
- All referenced files exist (no dangling references in config files)
- The app process can start without crashing
- The renderer can load the app (no `ERR_FILE_NOT_FOUND` or equivalent)
If any of these checks fail, the commit must be rejected.

### CI/CD

All projects must have GitHub Actions configured:
- **Lint check** - Run linter in CI
- **Test suite** - Run all tests in CI
- **Coverage check** - Verify 95%+ coverage in CI
- **Build** - Verify project builds successfully
- **Production gating** - Only deploy to production on main branch or tagged releases

### Code Review

**Empty-Config-First for Analysis Tools** — When adding a new analysis tool to the build, start with the strictest sensible configuration (e.g., `maxIssues: 0`) and only add suppressions for actual, proven violations. Do not pre-suppress rules you haven't seen fail — run the tool first, fix what it finds, then decide whether remaining violations are worth suppressing.

Add code quality tools to precommit hooks:
- **Linting** - Style and format checking
- **Static analysis** - Code quality tools (e.g., ESLint, Clippy, SonarQube)
- **Security scanning** - Vulnerability detection
- **Complexity check** - Flag overly complex code
When addressing code review findings (from automated tools, PR comments, or AI reviewers):
- **Verify before acting** — Read the relevant source lines and confirm the claim is accurate before implementing a fix. Code reviews can produce false positives (e.g., flagging imports as unused when they are used, or claiming CSS classes are missing when they exist in other files).
- **If verified** — proceed with the fix. **If false** — do not make the change and document why it was rejected.
- **Linter rules take precedence over code review suggestions** — If a code review finding conflicts with an enforced linter rule, follow the linter rule and find an alternative approach (e.g., scoping constants more narrowly rather than removing them entirely). The precommit hook enforces linter rules, so any fix that violates them will be rejected regardless of the code review's intent.

