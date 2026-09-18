// Pure decision for pcp_start (B020).
//
// pcp_start must never mint a new id while the ready queue holds work: after a
// pivot with no new task the active slot is empty but the queue is not, and the
// old handler created a duplicate T-id instead of activating the queued head.
// Keeping the decision pure lets the handler own the state mutation (shift) while
// the branch logic is unit-tested.

import type { Stack } from "./state.js";

export type StartDecision =
  | { kind: "blocked"; activeId: string }
  | { kind: "advance"; id: string; title: string }
  | { kind: "create"; id: string; title: string };

export function decideStart(
  stack: Pick<Stack, "active_task_id" | "ready_tasks" | "next_id">,
  title: string,
): StartDecision {
  if (stack.active_task_id) {
    return { kind: "blocked", activeId: stack.active_task_id };
  }
  if (stack.ready_tasks.length > 0) {
    const next = stack.ready_tasks[0];
    return { kind: "advance", id: next.id, title: next.title };
  }
  return {
    kind: "create",
    id: `T${String(stack.next_id).padStart(3, "0")}`,
    title,
  };
}
