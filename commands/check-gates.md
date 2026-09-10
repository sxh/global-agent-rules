---
description: Audit this project's quality gates against the required gate set
---

Gate conformance audit for this project:

!`bash ~/.config/opencode/skills/project-scaffold/scripts/check-gates.sh . 2>&1 || true`

Report the result in plain terms: which gates are live, and which are commented out, stubbed,
absent, not applicable, or excluded.

For each gap, state whether it should be implemented or recorded as an exclusion — and do not
add an exclusion yourself. Propose it with a reason and wait for approval, per the contract's
no-self-granted-exceptions rule.

Notes for reading the output:
- STUB means the underlying script exists but is disabled (an `echo` where a command should be).
  Find what it was hiding before re-enabling it — a stubbed gate typically conceals a backlog of
  real errors.
- COMMENTED or ABSENT with an applicable gate means the hook needs the gate added; the ready-made
  block is in skills/project-scaffold/templates/pre-commit.
- "threshold ABSENT" means the coverage number lives in prose rather than in the tool config.
- "N/A" is the checker inferring applicability (smoke needs a dev server or desktop shell; the FFI
  guard needs Gleam); it is not a gap.
- The final "RESULT:" line is the verdict; the injected output has no exit code.

If the audit shows the repository is fine, say so in one line and stop — this command exists to
find gaps, not to produce a report for its own sake.
