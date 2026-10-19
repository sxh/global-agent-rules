---
name: act-on-feedback
description: "Adjudicates code-review feedback one item at a time — verify each point against the code, fix the valid ones under TDD, and leave an in-code comment defending the false positives so they stop recurring. Use when the user says 'act on the feedback', 'address the review', 'work the review backlog', or when a reviewer (human or model) has raised points you must resolve."
---

# Act on Feedback

## What This Is

A review produces a list of points. Some are real defects; some are false positives —
confidently wrong claims, correct observations at the wrong severity, or issues already handled
elsewhere. Treating all of them as true wastes work and degrades the code; dismissing any of them
without checking is how real defects ship.

This skill is the repeatable loop that resolves a review's feedback: **adjudicate each item
against the code first, then act on the verdict** — fix what is valid, and for what is not, leave
a durable in-code marker so the same false positive does not get re-raised next review.

## When to Use

- The user says "act on the feedback", "address the review comments", "work the review backlog",
  or "resolve PR #N's comments".
- A code review (human or model, including a subagent) has just landed and its points are captured
  as backlog items.
- You are about to fold a batch of review nits into a change and want to triage them first.

The items normally arrive as PCP backlog entries (`pcp_backlog`) tagged as review feedback — a
review write-up captured via `pcp_capture`, or PR-comment items. If they are not yet in the
backlog, capture them first so each verdict is tracked against a stable id.

## The Loop (per item, one at a time)

Never batch-adjudicate. Handle one item fully — locate, verify, decide, act, record — before
moving to the next. A batch verdict is how a real defect rides along unexamined.

1. **Locate.** Open the exact file/line the point names, at the current revision. A review may
   reference a pre-rebase line or a file that has since changed.
2. **Reproduce the claim.** Decide from the code (and, for runtime claims, a reproduction) whether
   the statement is actually true *now*. Do not accept a reviewer's assertion on authority — model
   reviewers are fluent, plausible, and wrong with equal confidence.
3. **Classify** (see the verdict table). State the verdict and the evidence in one or two lines.
4. **Act** on the verdict — fix valid items, comment on false positives, answer questions.
5. **Record** the verdict against the backlog id (`pcp_backlog_done` with the reason, or
   `pcp_dismiss` where the item should stop being tracked). Capture a follow-up item if acting
   revealed new work that is out of scope for this resolve.

## Verdict Classes

| Verdict | Meaning | Action |
|---|---|---|
| **Valid — defect** | The claim is true and describes a real bug/regression. | Fix under TDD; add the regression test the defect lacked. |
| **Valid — improvement** | Not a defect, but the change genuinely improves health and the project agrees. | Make the change; keep it scoped; run the gate. |
| **Valid — convention** | The project's own rules require it (naming, structure, a documented standard). | Apply the project convention. |
| **Correct observation, wrong severity** | The fact is right but it is a nit, not a required change. | Downgrade; fix only if cheap, otherwise record the downgrade. |
| **False positive — already handled** | The guard lives elsewhere (parent wiring, shared hook, upstream validation). | Add a comment marking the false positive at the flagged site (see below). |
| **False positive — misread** | The reviewer misread the code, the spec, or the language semantics. | Add a comment marking the false positive at the flagged site. |
| **Stale** | The point was true once but the code has since changed. | Verify at HEAD; close the item with a note. |
| **Question / FYI** | The reviewer explicitly asked or informed, not asserted a defect. | Answer it in text; do not change code. Record the answer. |
| **Ambiguous** | You cannot tell valid from false without information only the user has. | **Stop and ask.** Do not guess, and do not act on it. |

If a point could be read two ways, it is **Ambiguous** — ask, in the same format the user gave it,
before touching code.

## Acting on Valid Feedback

- **TDD first.** A valid defect means a test was missing. Write the failing test that reproduces
  the reviewer's point, watch it fail, then fix it. A valid improvement that changes behavior gets
  the same treatment; a pure structure/clarity change may not need a new test but must not break
  the suite.
- **Validate the remedy, not just the claim.** A reviewer's suggested mechanism is not binding —
  check that it actually removes the cost before adopting it, and choose the mechanism that does.
  B104 correctly identified `flatMap` allocation but proposed a `Sequence`, which every caller
  materialises anyway; a pre-sized `LinkedHashSet` removed the copies instead.
- **Keep the reproduction test.** If the reviewer supplied a repro test, do not delete it — fold it
  into the permanent suite (the regression rule). A defect that recurs because its test was thrown
  away is a process failure.
- **One item, one concern.** Do not combine an unrelated refactor with a feedback fix. If the fix
  is large enough to be its own change, split it.
- **Run the gate in full** before proposing a commit: lint, tests, coverage at the project
  threshold, smoke where the project has one. State the result.

## Acting on False Positives — the Comment Protocol

A false positive that leaves no trace gets re-raised. The default remedy is an **in-code comment
at the exact site the reviewer flagged**, so the next reviewer sees the reasoning before repeating
the claim.

Write the comment so it answers the reviewer's *argument*, not just their conclusion:

```
// Not a defect: <the specific reason this claim does not hold>. <Where the real guard lives, if elsewhere>. See <backlog id>.
```

Good:

```tsx
// Not a defect: the delete is confirmed by the parent composition root via useConfirm
// (PaletteList.handleDeleteWithConfirm); this dumb card fires immediately by design. See B192.
onDelete(component.id);
```

Bad (a comment that restates the code, or a bare "intentional"):

```tsx
// intentional
```

Rules:

- **Place it at the flagged line.** A comment elsewhere does not stop the re-raise.
- **Answer the argument.** "This is fine" is not a defence; say *why* the claim is wrong (guard
  lives in X, semantics are Y, the test already covers Z).
- **One durable comment, not a wall.** If the same false positive has now been raised twice, the
  comment is the wrong layer — escalate the defence to where reviewers actually look: the project
  `AGENTS.md`, the relevant skill, or a mechanism (below).
- **Prefer a mechanism when the false positive is mechanically detectable.** A false positive the
  linter/tests could settle belongs in a lint rule, an exclusion, or a test — not prose. The
  comment is for judgement-based false positives a tool cannot adjudicate. (This is the project's
  standing rule: a recurring class gets a gate, not a paragraph.)
- **Link the backlog id** so the reasoning is traceable and the comment can be revisited.

## Anti-Patterns

- **Rubber-stamping** — applying every comment as if review = truth. Some points are wrong.
- **Blanket dismissal** — rejecting a batch as "the reviewer doesn't know the codebase". Some
  points are real; each is checked on the evidence.
- **Silent non-action** — deciding a point is a false positive and changing nothing, leaving no
  marker. The same point returns next review; the feedback loop never closes.
- **Scope creep** — fixing a valid nit by rewriting the surrounding module. Fix the point.
- **Deleting the repro** — removing the test that demonstrates the defect once it is green.
- **Guessing on Ambiguous** — inventing the missing requirement instead of asking.

## Definition of Done

- [ ] Every review item in scope has a stated verdict with evidence (not just the easy ones)
- [ ] Valid items are fixed under TDD; defect items have a permanent regression test
- [ ] False positives carry an in-code comment at the flagged site, linked to the backlog id
- [ ] Questions are answered; code untouched for them
- [ ] Ambiguous items were escalated to the user rather than guessed
- [ ] Lint, tests, and coverage gate pass in full
- [ ] Each backlog item closed (`pcp_backlog_done` / `pcp_dismiss`) with its verdict recorded
- [ ] The change passed the `code-review-and-quality` eight-axis review before the commit proposal

## Relationship to Other Skills

- **code-review-and-quality** — produces reviews (the eight axes) that become this skill's input;
  also run it on your own fix before proposing the commit.
- **xp-craftsman** — the TDD loop used to fix every valid defect/behavior change.
- **pcp-operations** — owns the backlog lifecycle: capture the feedback, close each item with its
  verdict, close the task before its commit, stage `.opencode/pcp`.
- **retrospective** — when the same false positive or defect class recurs despite the comment/gate,
  record why at the right layer.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The reviewer is a strong model, it's probably right" | Model reviewers are fluent and confidently wrong. Verify every claim against the code before acting. |
| "This is obviously a nit, skip it" | The verdict must be *checked*, not assumed from tone. A required fix can look like a nit. |
| "I'll just apply all of them; it's faster" | Applying false positives degrades the code and entrenches wrong patterns. Adjudicate first. |
| "I decided it's a false positive, no action needed" | Non-action leaves no trace, so the same point returns. Leave a comment at the site. |
| "The comment is obvious / the code says it" | A reviewer who raised the point did not find it obvious. Answer their argument explicitly. |
| "I'll fix this valid point as part of a larger cleanup" | Combining hides the fix and risks the regression test. One item, one concern. |
| "The repro test proved the point; I can delete it now" | The repro test is the regression guard. Fold it in; never delete it. |
| "Not sure if this is valid — I'll assume yes" | Unsure is Ambiguous. Ask; do not guess and do not act. |

## Red Flags

- A batch of review comments applied wholesale with no per-item verdict
- A review point dismissed with no comment or record anywhere
- A `// intentional` / `// not a bug` comment that does not answer the reviewer's argument
- The reproduction test missing after a defect fix
- A feedback fix tangled with an unrelated refactor
- An Ambiguous point resolved by guessing at the requirement
- Backlog items left `pending` after the loop claims they were resolved
