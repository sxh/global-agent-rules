// Pure decision for pcp_rename (B079).
//
// The plugin auto-creates a task titled from the first user message, so a
// mis-named task is common and there was no verb to correct it (B079). The
// decision is pure so the handler owns the event write, matching pcp_start's
// `decideStart` and pcp_promote's `decidePromote`.
//
// Target resolution runs before title validation: a bad id must be reported as
// an unknown task rather than masked by an empty title.

import type { Task } from "./state.js";

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
