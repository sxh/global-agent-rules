// Pure decision for pcp_promote (B074/T135).
//
// pcp_promote nests the promoted backlog item under the currently active task.
// Calling it repeatedly stacks each item under the previous one, so the last
// promoted task becomes active and the intended order is reversed (LIFO). The
// always-injected PCP_RULE alone failed to prevent this, so the tool itself must
// refuse the ambiguous case: promotion is only unambiguous from the sprint main
// (active depth 1). From a nested task the caller should finish/return first,
// then promote the next item.
//
// Keeping the branch decision pure lets the handler own state mutation while the
// decision is unit-tested, matching pcp_start's `decideStart`.

import type { Stack } from "./state.js";

export type PromoteDecision =
  | { kind: "allow"; activeId: string }
  | { kind: "no-sprint" }
  | { kind: "nested"; activeId: string; rootId: string; depth: number };

export function decidePromote(
  stack: Pick<Stack, "active_task_id" | "active_stack">,
): PromoteDecision {
  if (!stack.active_task_id) {
    return { kind: "no-sprint" };
  }
  if (stack.active_stack.length > 1) {
    return {
      kind: "nested",
      activeId: stack.active_task_id,
      rootId: stack.active_stack[0]!,
      depth: stack.active_stack.length,
    };
  }
  return { kind: "allow", activeId: stack.active_task_id };
}
