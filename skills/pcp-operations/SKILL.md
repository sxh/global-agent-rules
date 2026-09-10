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
