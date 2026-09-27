// Pure decision for pcp_promote (B077).
//
// pcp_promote appends a backlog item to the sprint queue. It must never nest the
// promoted task onto the active path: nesting made repeated promotions reverse
// their order (LIFO, B074/T135) and forced the guard to refuse any promotion
// while a subtask was active. Enqueuing keeps order (FIFO) and works at any
// stack depth. The decision is pure so the handler owns state mutation, matching
// pcp_start's `decideStart`.

import type { Stack } from "./state.js";

export type PromoteDecision =
  | { kind: "enqueue"; activeId: string }
  | { kind: "no-sprint" };

export function decidePromote(
  stack: Pick<Stack, "active_task_id">,
): PromoteDecision {
  if (!stack.active_task_id) {
    // Intentional terminal (B060): refusing a promotion when no sprint exists is by design —
    // the handler returns actionable guidance (noActiveSprint -> pcp_start). Starting a sprint
    // is pcp_plan/pcp_start's job; do not auto-create one here. Backlog<->task linking already
    // exists via the `backlog_promote` event and the "-> added to Txxx" status display.
    return { kind: "no-sprint" };
  }
  return { kind: "enqueue", activeId: stack.active_task_id };
}
