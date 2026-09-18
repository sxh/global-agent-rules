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
