// Pure decisions for the remaining task transitions (B020).
//
// pcp_sub, pcp_plan, pcp_pivot and the autoCreateTask hook each embedded branching and id
// allocation inline. They move here — pure and node-testable — while the handlers keep their
// own events, messages and mutations. `import type` only, so node can load this module.

import type { Stack } from "./state.js";

export interface ReadyTask {
  id: string;
  title: string;
}

function formatId(n: number): string {
  return `T${String(n).padStart(3, "0")}`;
}

// --- pcp_sub ---

export type SubStart =
  | { kind: "no-active" }
  | { kind: "start"; parentId: string; newId: string; resumePrompt: string };

export function decideSubStart(
  stack: Pick<Stack, "active_task_id" | "next_id">,
  title: string,
  parentTitle: string | null,
): SubStart {
  if (!stack.active_task_id) return { kind: "no-active" };
  const parentId = stack.active_task_id;
  return {
    kind: "start",
    parentId,
    newId: formatId(stack.next_id),
    resumePrompt: `About to start subtask [${title}]; when done, continue the main task: ${parentTitle ?? parentId}.`,
  };
}

// --- pcp_plan ---

export type PlanAllocation =
  | { kind: "empty" }
  | { kind: "enqueue"; created: ReadyTask[] }
  | { kind: "start"; first: ReadyTask; rest: ReadyTask[] };

export function decidePlan(
  stack: Pick<Stack, "active_task_id" | "next_id">,
  titles: string[],
): PlanAllocation {
  if (titles.length === 0) return { kind: "empty" };

  const created = titles.map((title, i) => ({ id: formatId(stack.next_id + i), title }));
  if (stack.active_task_id) return { kind: "enqueue", created };

  const [first, ...rest] = created;
  return { kind: "start", first, rest };
}

// --- pcp_pivot ---

export type PivotDecision =
  | { kind: "no-active" }
  | { kind: "pivot"; pivotId: string; newId: string | null };

export function decidePivot(
  stack: Pick<Stack, "active_task_id" | "next_id">,
  newTask?: string,
): PivotDecision {
  if (!stack.active_task_id) return { kind: "no-active" };
  return {
    kind: "pivot",
    pivotId: stack.active_task_id,
    newId: newTask ? formatId(stack.next_id) : null,
  };
}

// --- autoCreateTask ---

export type AutoCreate =
  | { kind: "skip-active" }
  | { kind: "skip-recent" }
  | { kind: "advance"; next: ReadyTask }
  | { kind: "create"; newId: string };

export function decideAutoCreate(
  stack: Pick<Stack, "active_task_id" | "ready_tasks" | "next_id" | "last_done_ts">,
  nowMs: number,
): AutoCreate {
  if (stack.active_task_id) return { kind: "skip-active" };
  if (stack.last_done_ts && nowMs - stack.last_done_ts < 1000) return { kind: "skip-recent" };
  if (stack.ready_tasks.length > 0) return { kind: "advance", next: stack.ready_tasks[0] };
  return { kind: "create", newId: formatId(stack.next_id) };
}

// --- pcp_swap (B021) ---

export type SwapDecision =
  | { kind: "no-sprint" }
  | { kind: "nested" }
  | { kind: "unknown-task"; id: string }
  | { kind: "same-task" }
  | { kind: "swap"; newActive: ReadyTask; order: ReadyTask[] };

export function decideSwap(
  stack: Pick<Stack, "active_stack" | "active_task_id" | "ready_tasks">,
  taskId: string,
  activeTitle: string | null,
): SwapDecision {
  if (!stack.active_task_id) return { kind: "no-sprint" };
  if (stack.active_stack.length > 1) return { kind: "nested" };
  if (taskId === stack.active_task_id) return { kind: "same-task" };

  const index = stack.ready_tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return { kind: "unknown-task", id: taskId };

  const paused: ReadyTask = {
    id: stack.active_task_id,
    title: activeTitle ?? stack.active_task_id,
  };
  const rest = stack.ready_tasks.filter((_, i) => i !== index);
  return { kind: "swap", newActive: stack.ready_tasks[index], order: [paused, ...rest] };
}

// --- pcp_demote (B021) ---

export type DemoteDecision =
  | { kind: "no-sprint" }
  | { kind: "unknown-task"; id: string }
  | { kind: "active"; id: string }
  | { kind: "demote"; id: string; order: ReadyTask[] };

export function decideDemote(
  stack: Pick<Stack, "active_task_id" | "ready_tasks">,
  taskId: string,
): DemoteDecision {
  if (!stack.active_task_id) return { kind: "no-sprint" };
  if (taskId === stack.active_task_id) return { kind: "active", id: taskId };

  const index = stack.ready_tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return { kind: "unknown-task", id: taskId };

  return { kind: "demote", id: taskId, order: stack.ready_tasks.filter((_, i) => i !== index) };
}
