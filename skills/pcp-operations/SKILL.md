---
name: pcp-operations
description: "Day-to-day PCP hygiene — verify backlog items before starting work, keep .opencode/pcp/ state files tracked, and relay PCP tool output to the user. Load when starting a queued or backlog task, or before a commit that touches PCP state."
---

# PCP Operations

Day-to-day hygiene for the Progress Control Plane. Relocated from `AGENTS.md`
(branch `refactor/agent-layers`, 2026-09-09).

## Verify backlog items before starting

Before starting any task taken from the backlog or queue, check `git log --oneline -20` for
recent related work. A prior commit may have already completed the item, or changed the
premises it was written under. A stale item wastes a whole session.

If the work appears done, verify it against the current code and dismiss or close the item
rather than redoing it.

## PCP state files are part of the project

`.opencode/pcp/` files track task state across sessions — omitting them breaks continuity
between sessions, so they are project content, not scratch output.

- Default to committing them alongside the code change they describe.
- Batch them into the final commit at session end if the user prefers that cadence.
- Do not leave them unstaged at session end: state that is not committed does not exist for
  the next session.

## Relay PCP tool output in text

Tool results from `pcp_backlog`, `pcp_status`, `pcp_history`, etc. are returned to the agent
and may not be visible to the user. Always include the key information in your own text
response, translated into the user's process language rather than relaying the tool's generic
framing verbatim (do not echo "sprint" terminology to a user who does not use sprints).

Never call a PCP tool silently and assume the user saw the result.

## Commit proposals carry task state

Every commit proposal must reference the current PCP task (run `pcp_status` before proposing).
This keeps commits traceable to the work item that produced them. A commit auto-advances the
active task even when it is not that task's deliverable — after any commit, verify the queue
state and reconcile before continuing.

When promoted items nest (a subtask of a subtask), a commit auto-completes the *deepest* subtask,
so a multi-commit task can be closed before its work lands. On 2026-09-11 a nested B084 subtask
(`T274`) was completed by an unrelated commit; recovery is to reconcile immediately — finish the
prematurely-completed item with `pcp_done`, then `pcp_start` a fresh task for any remaining work.

## Build ordered queues with pcp_plan, not sequential pcp_promote

To load a batch of backlog items to execute **in order**, call `pcp_plan` with the ordered titles:
it makes the first task active and queues the rest FIFO, so each completion advances to the next in
the intended order. `pcp_promote` instead nests each item under the *current* active task and makes
it active, so promoting a sequence builds a LIFO stack whose commit-order is reversed — use it only
to add a single item to an existing sprint.

## Close a task before its commit (one commit per task)

Call `pcp_done` to close the active task, then stage the **whole `.opencode/pcp/`
directory** (`git add .opencode/pcp`) together with the code in that same commit: `pcp_done`
writes `WORKLOG.md`, `events.jsonl`, and `stack.json` *together*, so staging them as
individual files can silently leave `WORKLOG.md` behind (it happened on 2026-09-24, commit
`64a60bc`). No separate bookkeeping commit is needed.

As a fallback — when `pcp_done` was not called — a `git commit` auto-closes the active task
**only** when the commit message carries an explicit trailer naming it:

```
PCP-Task: T123
```

Without a matching trailer the queue is left unchanged (the plugin logs this); a commit that does
not implement the active task simply omits it and leaves the task open. (Mechanism:
`plugins/pcp.ts` `parsePcpTaskRef` + `autoDoneTask`, patch marker `PCP_TASK_BINDING_FIX`.)

The fallback path writes `.opencode/pcp/` state *after* `git commit` returns, so a `git status`
run in the same command can still show a clean tree even though the task was auto-closed. Re-check
`git status` (and `pcp_status`) a moment later before concluding that no state change occurred.

## Cross-repo work commits its state in the state's repo

The PCP state lives under the session directory's `.opencode/pcp/`, which may be a different git
repo from the one being edited. When the commit's repo is not the state's repo, the state cannot
be staged into that commit — leave it to ride into the next commit **in its own repo** (the
PCP-State rule) rather than making a dedicated bookkeeping commit.

## Task language and granularity

- Reply in the user's communication language (Chinese for Chinese, English for English).
- One Task = one concrete deliverable, doable in ≤2h, with a completion criterion. Never create
  project-goal / sprint-container mega-tasks.
- Use `pcp_sub` only for a temporary detour that returns immediately; never use it to execute a
  queued Task.

## Plan confirmation

When the user gives a todolist or plan document: first scan the existing code and outputs so no
task is created for work already done, then load the plan with `pcp_plan(tasks)`, show the list,
and wait for confirmation before executing.

## Completion review

When a task finishes with output files, list them and ask "needs review?"; if yes, present by
type — `.md` → convert to PDF with pandoc and give the path; `.json` → format key fields;
`.txt` → paste short files or summarise long ones; code → `git diff` the key changes — then call
`pcp_done`. If no review is needed, call `pcp_done` directly.

## Capture and pivot triggers

- "later / by the way / note X" → `pcp_capture` (record it; do not execute it now).
- "originally / was going to … now / changed to / found something better" → confirm, then
  `pcp_pivot` with the reason.

## No active task, and after a pivot

- No active task → guide the user to make a plan rather than inventing tasks.
- After a pivot with no active task, use `pcp_start` to advance the queue head; never mint a
  duplicate task id.
- If `pcp_start` refuses because of an unrelated active task that is a session artifact
  (auto-created from an earlier message, e.g. "Reorder tasks: T157 before T156"), do not
  commit around it: `pcp_pivot` it with a reason and a `new_task` for the real work.

## Queue verbs

The ready queue is FIFO by default, but it can be adjusted:

- `pcp_plan` loads an ordered batch (first task active, rest queued); `pcp_promote` appends a
  single backlog item to the queue end.
- `pcp_reorder <id>` moves a **queued** task: `top`, `position` (1-based), `before <id>`, or
  `after <id>`.
- `pcp_swap <id>` pauses the active main task (it goes to the queue head) and promotes a queued
  task in its place; it is refused while a subtask is active.
- `pcp_demote <id>` removes a queued task and returns its originating backlog item to `pending`.

The **active** task cannot be reordered — use `pcp_swap`, `pcp_done`, or `pcp_pivot`.
