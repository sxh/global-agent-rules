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

export interface UnplannedEditInput {
    activeTaskId: string | null | undefined;
    readyTaskCount: number;
    /** The session has already been warned. */
    warned: boolean;
    /** The project has .opencode/pcp state; a plain project is left alone. */
    pcpManaged: boolean;
    output: string;
}

export interface UnplannedEditResult {
    output: string;
    /** Whether this call appended the warning (so the caller records it). */
    warned: boolean;
}

/**
 * The full wiring decision for the after-hook: warn once per session, only in a
 * PCP-managed project, and only when no active or queued task is engaged.
 */
export function applyUnplannedEditWarning(
    input: UnplannedEditInput,
): UnplannedEditResult {
    if (input.warned || !input.pcpManaged) {
        return { output: input.output, warned: input.warned };
    }
    const warning = unplannedEditWarning(
        input.activeTaskId,
        input.readyTaskCount,
    );
    if (!warning) return { output: input.output, warned: false };
    return { output: `${input.output}${warning}`, warned: true };
}
