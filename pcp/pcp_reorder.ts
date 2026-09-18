// Pure decision for pcp_reorder (T006).
//
// PCP's ready queue is strict FIFO and there was no verb to change it, so a blocking
// fix could sit behind unrelated work (the Hannants load: T155 behind T151-T154). The
// decision is pure so the handler owns the stack rewrite, matching decideStart /
// decidePromote / decideRename.
//
// Only the ready queue is reordered: the active task and the backlog are untouched.
// ready_tasks order lives in stack.json (event replay reconstructs task identity, not
// order), so no event is appended — a WORKLOG line is the audit trail.

import type { Stack } from "./state.js";

export interface ReadyTask {
  id: string;
  title: string;
}

export type ReorderAnchor =
  | { kind: "top" }
  | { kind: "position"; position: number }
  | { kind: "before"; id: string }
  | { kind: "after"; id: string };

export type ReorderDecision =
  | { kind: "reorder"; order: ReadyTask[] }
  | { kind: "no-sprint" }
  | { kind: "unknown-task"; id: string }
  | { kind: "unknown-anchor"; id: string }
  | { kind: "same-anchor"; id: string }
  | { kind: "bad-position"; position: number };

export function decideReorder(
  stack: Pick<Stack, "active_task_id" | "ready_tasks">,
  taskId: string,
  anchor: ReorderAnchor,
): ReorderDecision {
  if (!stack.active_task_id) {
    return { kind: "no-sprint" };
  }

  const from = stack.ready_tasks.findIndex((task) => task.id === taskId);
  if (from === -1) {
    return { kind: "unknown-task", id: taskId };
  }

  const moving = stack.ready_tasks[from];
  const rest = stack.ready_tasks.filter((_, i) => i !== from);

  let index: number;
  switch (anchor.kind) {
    case "top":
      index = 0;
      break;
    case "position": {
      if (
        !Number.isInteger(anchor.position) ||
        anchor.position < 1 ||
        anchor.position > stack.ready_tasks.length
      ) {
        return { kind: "bad-position", position: anchor.position };
      }
      index = anchor.position - 1;
      break;
    }
    case "before":
    case "after": {
      if (anchor.id === taskId) {
        return { kind: "same-anchor", id: anchor.id };
      }
      const anchorIndex = rest.findIndex((task) => task.id === anchor.id);
      if (anchorIndex === -1) {
        return { kind: "unknown-anchor", id: anchor.id };
      }
      index = anchor.kind === "before" ? anchorIndex : anchorIndex + 1;
      break;
    }
  }

  const order = [...rest];
  order.splice(index, 0, moving);
  return { kind: "reorder", order };
}

export function reorderOutcome(decision: ReorderDecision, taskId: string): string {
  switch (decision.kind) {
    case "reorder":
      return `↕️ Moved [${taskId}].\nQueue: ${decision.order.map((task) => task.id).join(", ")}`;
    case "no-sprint":
      return "❌ No active sprint to reorder; call pcp_start to begin one first.";
    case "unknown-task":
      return `❌ No ready task [${decision.id}] to reorder.`;
    case "unknown-anchor":
      return `❌ No ready task [${decision.id}] to position against.`;
    case "same-anchor":
      return `❌ [${decision.id}] cannot be positioned against itself.`;
    case "bad-position":
      return `❌ Position ${decision.position} is out of range (1..queue length).`;
  }
}
