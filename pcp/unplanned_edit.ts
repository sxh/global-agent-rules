// Decide whether a write tool's result should carry an unplanned-edit warning.
//
// The commit-time check-pcp-task gate only proves a task existed by commit time.
// This is the edit-time counterpart: when a write tool runs with no active task
// and no queued task to auto-advance, the tool result tells the agent to start
// one before the next change. It lives in pcp/ so a test can import it without
// dragging in the plugin runtime (see plugins/pcp.ts's tool_classify note).

export const UNPLANNED_EDIT_WARNING =
    "\n\n[PCP] No active task was engaged for this edit. Call pcp_start (or pcp_plan) before the next change.";

/** The warning to append to a write tool's result, or null when a task is engaged. */
export function unplannedEditWarning(
    activeTaskId: string | null | undefined,
    readyTaskCount: number,
): string | null {
    if (activeTaskId) return null;
    if (readyTaskCount > 0) return null;
    return UNPLANNED_EDIT_WARNING;
}
