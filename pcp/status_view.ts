// Pure renderers for the read-only PCP views (C1/B007).
//
// pcp_status / pcp_backlog / pcp_history used to each build their own strings inline beside
// state.ts I/O, so node could not test the formatting. The rendering moves here — pure and
// importable — and the tools just read state and call a renderer.

import type { BacklogItem, Stack, Task } from "./state.js";

export type StatusStack = Pick<Stack, "active_stack" | "active_task_id" | "ready_tasks">;

function taskById(tasks: Task[], id: string): Task | undefined {
  return tasks.find((task) => task.id === id);
}

export function renderTasks(
  stack: StatusStack,
  tasks: Task[],
  projectContext: string | null,
  pending: BacklogItem[],
  lastEvent: string | null = null,
): string {
  const lines: string[] = [];
  if (projectContext) lines.push(`[Project] ${projectContext}`);
  if (lastEvent) lines.push(`🕐 Last: ${lastEvent}`);

  if (!stack.active_task_id) {
    lines.push("No active task.");
    if (stack.ready_tasks.length > 0) {
      lines.push(`\n⏳ ${stack.ready_tasks.length} queued task(s) waiting:`);
      for (const t of stack.ready_tasks) lines.push(`  ${t.id}: ${t.title}`);
    }
    if (pending.length > 0) {
      lines.push(`📋 Backlog has ${pending.length} item(s) pending review; see pcp_backlog.`);
    }
    lines.push(`\n💡 Suggestion: have the planner lay out tasks, then load them with pcp_plan.`);
    return lines.join("\n");
  }

  lines.push("Current task stack:");
  for (let i = 0; i < stack.active_stack.length; i++) {
    const id = stack.active_stack[i];
    const task = taskById(tasks, id);
    const isCurrent = id === stack.active_task_id;
    const prefix = i === 0 ? "[main]" : "[sub]";
    lines.push(`  ${prefix} ${id} ${task?.title ?? id}${isCurrent ? "  ← current" : ""}`);
  }

  if (stack.ready_tasks.length > 0) {
    lines.push(`\n⏳ Queue (${stack.ready_tasks.length}):`);
    for (const t of stack.ready_tasks) lines.push(`  ${t.id}: ${t.title}`);
  }

  if (pending.length > 0) {
    lines.push(`📋 Backlog: ${pending.length} item(s) pending review`);
  }

  return lines.join("\n");
}

export function renderBacklog(pending: BacklogItem[]): string {
  if (pending.length === 0) return "📋 Backlog is empty.";

  const lines = [`📋 Backlog (${pending.length}):`];
  for (const item of pending) {
    lines.push(`  ${item.id}: ${item.title}`);
    if (item.detail) lines.push(`       ${item.detail}`);
  }
  return lines.join("\n");
}

export function renderHistory(
  tasks: Task[],
  stack: StatusStack,
  backlog: BacklogItem[],
  limit: number,
): string {
  const lines: string[] = [];

  const done = tasks.filter((t) => t.done && t.type === "main").slice(-limit);
  if (done.length > 0) {
    lines.push("=== Completed sprints ===");
    for (const t of done) {
      const icon = t.pivoted ? "🔄" : "✅";
      const suffix = t.pivoted && t.pivot_reason ? `  (pivot: ${t.pivot_reason})` : "";
      lines.push(`  ${icon} ${t.id}  ${t.title}${suffix}`);
    }
  }

  if (stack.active_task_id) {
    lines.push("\n=== In progress ===");
    for (let i = 0; i < stack.active_stack.length; i++) {
      const id = stack.active_stack[i];
      const t = taskById(tasks, id);
      const isCurrent = id === stack.active_task_id;
      const prefix = i === 0 ? "[main]" : "[sub]";
      lines.push(`  📌 ${prefix} ${id}  ${t?.title ?? id}${isCurrent ? "  ← current" : ""}`);
    }
  }

  if (stack.ready_tasks.length > 0) {
    lines.push("\n=== Queue ===");
    for (const t of stack.ready_tasks) lines.push(`  ⏳ ${t.id}  ${t.title}`);
  }

  if (backlog.length > 0) {
    lines.push("\n=== Backlog ===");
    for (const item of backlog) {
      const icon =
        item.status === "pending" ? "📝" :
        item.status === "promoted" ? "📦" :
        item.status === "done" ? "✅" : "❌";
      const suffix =
        item.status === "promoted" ? ` → added to ${item.promoted_to}` :
        item.status === "done" ? " (done)" :
        item.status === "dismissed" ? " (dismissed)" : "";
      lines.push(`  ${icon} ${item.id}  ${item.title}${suffix}`);
    }
  }

  if (lines.length === 0) return "No records yet.";
  return lines.join("\n");
}
