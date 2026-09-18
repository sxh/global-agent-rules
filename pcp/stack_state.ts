// Pure stack.json parsing (A4/B005).
//
// readStack previously parsed stack.json inline alongside fs I/O, so it could not be unit-tested
// from node (state.ts's runtime .js imports do not resolve outside opencode). The parsing and
// defaulting move here — pure and importable — and are exercised against a compatibility corpus
// of every historical shape found in the A0 inventory.
//
// Only `import type` is used so this module has no runtime dependency back on state.ts.

import type { Stack } from "./state.js";

export function emptyStack(): Stack {
  return {
    next_id: 1,
    backlog_next_id: 1,
    active_stack: [],
    active_task_id: null,
    ready_tasks: [],
  };
}

export function parseStack(raw: string): Stack {
  try {
    const stack = JSON.parse(raw) as Stack;
    if (stack.backlog_next_id === undefined) stack.backlog_next_id = 1;
    if (stack.ready_tasks === undefined) stack.ready_tasks = [];
    return stack;
  } catch {
    return emptyStack();
  }
}
