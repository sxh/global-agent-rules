// Pure decision for pcp_rename (B079).
//
// The plugin auto-creates a task titled from the first user message, so a
// mis-named task is common and there was no verb to correct it (B079). The
// decision is pure so the handler owns the event write, matching pcp_start's
// `decideStart` and pcp_promote's `decidePromote`.
//
// Target resolution runs before title validation: a bad id must be reported as
// an unknown task rather than masked by an empty title.

import type { PcpEvent, Task } from "./state.js";

export type RenameDecision =
  | { kind: "rename"; id: string; title: string }
  | { kind: "no-task" }
  | { kind: "unknown-task"; id: string }
  | { kind: "empty-title" };

export function decideRename(
  tasks: Task[],
  requestedId: string | null,
  activeId: string | null,
  newTitle: string,
): RenameDecision {
  const targetId = requestedId ?? activeId;
  if (!targetId) {
    return { kind: "no-task" };
  }
  if (!tasks.some((task) => task.id === targetId)) {
    return { kind: "unknown-task", id: targetId };
  }

  const title = newTitle.trim();
  if (!title) {
    return { kind: "empty-title" };
  }

  return { kind: "rename", id: targetId, title };
}

export interface RenameOutcome {
  event: Omit<PcpEvent, "ts"> | null;
  message: string;
}

export function renameOutcome(decision: RenameDecision): RenameOutcome {
  switch (decision.kind) {
    case "rename":
      return {
        event: { e: "renamed", id: decision.id, title: decision.title },
        message: `✅ Renamed [${decision.id}] to: ${decision.title}`,
      };
    case "no-task":
      return {
        event: null,
        message: "❌ No active task to rename. Pass an explicit id, or start one with pcp_plan.",
      };
    case "unknown-task":
      return {
        event: null,
        message: `❌ No task [${decision.id}] to rename. Check pcp_status for valid ids.`,
      };
    case "empty-title":
      return {
        event: null,
        message: "❌ A rename needs a non-empty title.",
      };
  }
}
