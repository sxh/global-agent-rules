// Actionable failure messages (E2/B015).
//
// The bare "no active task" / "no active sprint" dead-ends now name a concrete next step.
// Dependency-free on purpose: node cannot resolve a runtime `.js` specifier between source
// modules (it only maps to a .ts file under opencode/bun), so the pure modules must not import
// each other at runtime. That is also why the rename/reorder message builders stay inside their
// own modules rather than importing these.

export function noActiveTask(): string {
  return "❌ No active task. Start one with pcp_plan, or pcp_start to advance the queue.";
}

export function noActiveSprint(): string {
  return "❌ No active sprint. Begin one with pcp_start, then retry.";
}

export function noReadyTask(id: string): string {
  return `❌ No queued task [${id}]. Check pcp_status for queued ids.`;
}
