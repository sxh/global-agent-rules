// Pure stack.json parsing (A4/B005).
//
// readStack previously parsed stack.json inline alongside fs I/O, so it could not be unit-tested
// from node (state.ts's runtime .js imports do not resolve outside opencode). The parsing and
// defaulting move here — pure and importable — and are exercised against a compatibility corpus
// of every historical shape found in the A0 inventory.
//
// Only `import type` is used so this module has no runtime dependency back on state.ts.

import type { Stack, Task } from "./state.js";

export function emptyStack(): Stack {
  return {
    next_id: 1,
    backlog_next_id: 1,
    active_stack: [],
    active_task_id: null,
    ready_tasks: [],
  };
}

// Returns null instead of silent defaults, so readStack can tell "corrupt" from "legitimately
// empty" and recover from the event log in the former case.
export function parseStackStrict(raw: string): Stack | null {
  try {
    const stack = JSON.parse(raw) as Stack;
    if (stack.backlog_next_id === undefined) stack.backlog_next_id = 1;
    if (stack.ready_tasks === undefined) stack.ready_tasks = [];
    return stack;
  } catch {
    return null;
  }
}

export function parseStack(raw: string): Stack {
  return parseStackStrict(raw) ?? emptyStack();
}

// R1: rebuild a workable stack when stack.json is missing/corrupt. The newest open task becomes
// active and the rest queue in creation order. Order cannot be recovered from events (only the
// snapshot holds it), so this is a best-effort recovery, not a reconstruction.
export function recoverStackFromEvents(tasks: Task[]): Stack {
  const maxId = tasks.reduce((max, task) => {
    const n = Number.parseInt(task.id.replace(/^T/, ""), 10);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const open = tasks.filter((task) => !task.done);
  if (open.length === 0) {
    return {
      next_id: maxId + 1,
      backlog_next_id: 1,
      active_stack: [],
      active_task_id: null,
      ready_tasks: [],
    };
  }

  const active = open[open.length - 1];
  return {
    next_id: maxId + 1,
    backlog_next_id: 1,
    active_stack: [active.id],
    active_task_id: active.id,
    ready_tasks: open.slice(0, -1).map((task) => ({ id: task.id, title: task.title })),
  };
}
