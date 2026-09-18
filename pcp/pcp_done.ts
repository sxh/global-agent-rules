// Pure done/advance rule for task completion (C3/B009).
//
// Completing the active task either returns to a parent (subtask), advances to the next queued
// task, or ends the sprint. This rule was inline in pcp_done and duplicated in the autoDoneTask
// hook; it lives here once and the handlers keep their own events, messages and mutations.

import type { Stack } from "./state.js";

export type TaskDoneDecision =
  | { kind: "no-task" }
  | { kind: "sub-return"; parentId: string }
  | { kind: "advance"; nextId: string; nextTitle: string; remaining: number }
  | { kind: "all-done" };

export function decideTaskDone(
  stack: Pick<Stack, "active_stack" | "active_task_id" | "ready_tasks">,
): TaskDoneDecision {
  if (!stack.active_task_id) return { kind: "no-task" };

  const parentId =
    stack.active_stack.length >= 2
      ? stack.active_stack[stack.active_stack.length - 2]
      : null;
  if (parentId) return { kind: "sub-return", parentId };

  if (stack.ready_tasks.length > 0) {
    const [next, ...rest] = stack.ready_tasks;
    return { kind: "advance", nextId: next.id, nextTitle: next.title, remaining: rest.length };
  }

  return { kind: "all-done" };
}
