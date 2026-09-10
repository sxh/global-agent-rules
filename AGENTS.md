# Global Development Rules

These rules apply to **every** OpenCode session across **all** projects, unless a project's
own AGENTS.md explicitly overrides them.

## Priority Order

1. **Testability** — every line of application code must be testable; if configuration or
   UI code has an outcome, that outcome is testable. Coverage measurement is mandatory.
2. **Simplicity**
3. **Consistency** across the entire stack

## Working Protocol

**Permission to act** — No code change and no commit without an explicit instruction from
the user in a separate turn. The two-turn protocol (propose, then execute) applies to every
commit without exception. Passing tests, perceived urgency, and the question "what's the
plan?" are not permission. A question about plans is a request for information: state the
plan in text and wait.

**Commits are for working code** — Never commit during an investigation or while
experimenting. Commit only verified work whose gates pass.

**Review before proposing a commit** — Before proposing any commit, run the eight-axis
`skills/code-review-and-quality/SKILL.md` review on the staged diff and state the result in
the proposal: which axes passed, which findings were addressed, which were deliberately
deferred and why. Every commit, including a one-line typo fix. (The structural-debt scan runs
separately on cadence via the `structural-debt-auditor` skill.)

**No "move fast and fix"** — Never skip process steps because something seems simple or
"pretty sure it will work". The process exists because that instinct has been wrong before.

**Questions get answers, not fixes** — When the user asks a question, restate it, answer it
concisely, and stop. No file edits, no fixes, no implementation in the same turn. Standing
input convention: a message prefixed `Question:` or ending `Answer only` is answer-only. If a
message could be either a question or an assignment — common when it arrives mid-implementation
— ask "answer or implement?" before touching code. Do not resume an edit in the same turn a
question arrives.

**Bypass flags are a STOP, not a workaround** — If a commit would require `--no-verify`, `-n`,
or equivalent, freeze immediately and state the reason and risk in text. Wait for the user to
volunteer permission. A prior yes does not carry forward.

**No self-granted exceptions** — Never decide a process rule does not apply without asking.
If an exception seems warranted ("this is just config", "this is a prototype"), propose it and
wait for approval. The burden of proof is on the exception, not on compliance. A request to
"prototype" or "explore" does not waive the requirement: a prototype's test may change as the
design evolves, but it must exist before implementation.

**No skipping** — Tests, linting, coverage, and pre-commit hooks all pass, or nothing proceeds.
Never use `.skip()`, `eslint-disable`, `@Suppress`, or an equivalent to get past a check.
Fix the root cause; if a tool genuinely cannot be satisfied, document why explicitly. "Pre-existing"
is never a valid reason to dismiss an error.

**System changes need permission** — Installing packages, modifying PATH, or changing
configuration outside the project must be proposed with options and explicitly approved first,
however obvious or safe the fix appears.

**Investigations are read-only** — Before running any command during investigation, confirm it
has no side effects. Read source or `package.json` rather than executing a binary to learn a
version. Isolate anything that must run (docker, temp dir, `--dry-run`). `.git/` is immutable
during investigations.

**Human context is not observable** — You cannot see the user's terminal, screen, or filesystem.
When they describe their environment, workflow, or what they ran, ask for the exact path, command,
or output rather than assuming. Guessing which script the user ran has burned multiple turns.

**Investigate before acting** — Gather data first; verify against real systems (logs, CI config,
live tables, real requests) rather than hypothesising. For runtime errors, reproduce and read the
actual error. When output does not work, the gap is almost always tool-specific syntax — find a
working example instead of deriving from first principles. State your understanding of the problem
in one sentence before changing any code, and ask "is this correct?" if unsure.

**Verify actual state, never assumed state** — After any shell or git operation, inspect the real
outcome: capture exit codes before piping, re-check `git status` and `git diff --cached` after
index-mutating commands, and run the canonical gate command in full rather than a filtered version.
A pipe masks exit codes; a stash silently unstages; a filtered grep hides errors. An edit made after
`git add -A` is not in the commit — restage before committing. Before attributing a red gate to your
change, reproduce it at clean HEAD and at the merge base.

**Generated output must be run** — A generator that compiles is not verified. Generated artifacts
(scripts, configs, deployment files) must be executed at least once, end to end, before claiming
they work. A green pre-commit does not cover shell scripts or infrastructure configuration.

**Done means the gate passes** — A change is complete when the pre-commit hook passes: lint,
tests, coverage at the project threshold, and a smoke test for apps with a build pipeline or
desktop shell. This applies even if the change is not committed.

**Defects are process failures** — Any reported defect means a test was missing and a process
step failed. Investigate which test was missing, which step failed, and what change to tooling,
hooks, or rules prevents recurrence. Use Five Whys (see the `retrospective` skill).

## Language Preference

Strongly typed languages are preferred over dynamic ones. Platform order: **BEAM** (Gleam,
Lustre), then **JVM** (Java, Kotlin, Scala).

## Skills

**XP is the default mode** — For any task involving software implementation, code generation,
infrastructure configuration, testing, or refactoring, load `skills/xp-craftsman/SKILL.md` at the
start of the session and follow it unless the user overrides a specific deviation for that session.
Do not wait for a trigger phrase.

**Resolve skills yourself** — Do not require the user to remember skill names or trigger phrases.
When asked for an audit, review, or analysis in natural language, scan `skills/` and match the best
fit automatically. The `skill` tool only knows pre-registered skills; for skills at explicit paths,
read the SKILL.md and follow it for that session so the latest version is always used.

Triggers: "run retrospective" / "reflect on session" → `skills/retrospective/SKILL.md`.

## Where things live

| Need | Location |
|---|---|
| Coding standards (architecture, naming, SOLID, security, errors, API, a11y) | `skills/engineering-standards/SKILL.md` |
| Testing practice (DI, functional tests, hermeticity, coverage strategy) | `skills/testing-standards/SKILL.md` |
| Per-stack playbooks (Gleam+Lustre+Electron, Birdie, React/TS, JVM) | `skills/stack-playbooks/SKILL.md` |
| Project setup and gates (start.sh, pre-commit, CI, review handling) | `skills/project-scaffold/SKILL.md` |
| Debugging discipline and proven platform limitations | `skills/debugging-playbook/SKILL.md` |
| Past incidents and gotchas (institutional memory) | `docs/incidents.md` — grep it; do not load wholesale |
| Machine setup (server, local models, ports) | `docs/local-setup.md` |

## Adding rules to this file

Before adding anything here, check whether an existing rule should already have prevented the
issue. If one exists, the gap is enforcement — add a hook, lint rule, or gate, not prose. Every
addition must state which layer it belongs to (this file, a skill, docs/incidents.md, or a
mechanism) and must come with a mechanism or an expiry. This file has a hard budget of 200 lines;
entries that do not earn their place are removed.
