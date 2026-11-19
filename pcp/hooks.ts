// Shared PCP lifecycle hooks.
//
// The plugin adapters (V1 plugins/pcp.ts today, a V2 port later) own only the hook
// wiring; the decisions and side effects live here so both hosts run the same code.
// Nothing in this module imports a plugin API, and every function returns data
// instead of mutating a host-specific event object.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  appendEvent,
  ensureDir,
  getPendingBacklog,
  getTask,
  pcpDir,
  readProjectContext,
  readProjectMd,
  readStack,
  replayEvents,
  writeStack,
} from "./state.js";
import type { Stack, Task } from "./state.js";
import { commitTrailerSource, parsePcpTaskRef } from "./commit_ref.js";
import { decideTaskDone } from "./pcp_done.js";
import { decideAutoCreate } from "./task_flow.js";
import { isBashTool, isWriteTool } from "./tool_classify.js";
import { applyUnplannedEditWarning } from "./unplanned_edit.js";
import { misplacedStateWarning } from "./misplaced_state.js";

/** What the adapter must supply: resolving a session to its project directory. */
export interface HookDeps {
  /** Project directory for the session, falling back to the plugin's own directory. */
  sessionDir(sessionID: string): Promise<string>;
}

// ──────────────────────────────────────────────
// Context builder (token budget: ≤6 lines)
// ──────────────────────────────────────────────

export function buildResumeContext(
  stack: Stack,
  tasks: Task[],
  projectCtx: string | null,
  pendingBacklogCount: number,
  dir?: string,
): string {
  const lines: string[] = [];

  if (projectCtx) {
    lines.push(`[Project] ${projectCtx.slice(0, 80)}`);
  }

  // Inject the PROJECT.md "Current state" section if available. The regex also
  // matches the legacy Chinese heading (\u73b0\u72b6) so older files still work.
  if (dir) {
    const projectMd = readProjectMd(dir);
    if (projectMd) {
      const statusMatch = projectMd.match(/## (?:\u73b0\u72b6|Current state)\n([\s\S]*?)(?=\n## |---|\n*$)/);
      if (
        statusMatch?.[1]?.trim() &&
        !statusMatch[1].includes("To fill in manually:") &&
        !statusMatch[1].includes("pcp_init \u81ea\u52a8\u751f\u6210") &&
        !statusMatch[1].includes("\u5efa\u8bae\u624b\u52a8\u8865\u5145")
      ) {
        lines.push(`[Current state] ${statusMatch[1].trim().slice(0, 150)}`);
      }
    }
  }

  if (stack.active_task_id) {
    lines.push("Current task stack:");
    for (let i = 0; i < Math.min(stack.active_stack.length, 3); i++) {
      const id = stack.active_stack[i];
      const task = getTask(tasks, id);
      const isCurrent = id === stack.active_task_id;
      const prefix = i === 0 ? "[main]" : "[sub]";
      lines.push(
        `  ${prefix} ${id} ${task?.title ?? id}${isCurrent ? "  ← current" : ""}`,
      );
    }
  }

  if (stack.ready_tasks.length > 0) {
    lines.push(`⏳ Queue: ${stack.ready_tasks.map(t => `${t.id}:${t.title}`).join(", ")}`);
  }

  if (pendingBacklogCount > 0) {
    lines.push(`📋 Backlog: ${pendingBacklogCount} item(s) pending review`);
  }

  return lines.slice(0, 6).join("\n");
}

// ──────────────────────────────────────────────
// Auto-lifecycle internals
// ──────────────────────────────────────────────

// PCP_NO_TITLE_TASK_FIX (forked locally; not re-downloaded):
// A write tool with no active task may activate the queued head, but must never invent a
// task from the session title — that produced junk tasks (e.g. "Reorder tasks: T157 before
// T156") that then blocked pcp_start.
function autoActivateQueuedTask(dir: string): void {
  ensureDir(dir);
  const stack = readStack(dir);
  const decision = decideAutoCreate(stack, Date.now());
  if (decision.kind !== "advance") return;

  const next = stack.ready_tasks.shift()!;
  stack.active_stack = [next.id];
  stack.active_task_id = next.id;
  writeStack(dir, stack);
  console.log(`[PCP] auto-advanced to ${next.id}: ${next.title}`);
}

function autoDoneTask(dir: string, expectedId?: string): void {
  const stack = readStack(dir);
  if (!stack.active_task_id) return;
  if (expectedId && expectedId !== stack.active_task_id) {
    console.log(`[PCP] commit references ${expectedId} but active task is ${stack.active_task_id}; leaving queue unchanged`);
    return;
  }

  const doneId = stack.active_task_id;
  appendEvent(dir, { e: "done", id: doneId, ts: Date.now() });

  const decision = decideTaskDone(stack);
  stack.active_stack.pop();

  if (decision.kind === "sub-return") {
    // Return to parent task (sub-task done)
    stack.active_task_id = decision.parentId;
  } else if (decision.kind === "advance") {
    // Auto-advance from ready queue
    const next = stack.ready_tasks.shift()!;
    stack.active_stack = [next.id];
    stack.active_task_id = next.id;
    console.log(`[PCP] auto-advanced to ${next.id}: ${next.title}`);
  } else {
    stack.active_task_id = null;
    stack.last_done_ts = Date.now();
  }

  writeStack(dir, stack);
  console.log(`[PCP] auto-done ${doneId} (git commit)`);
}

export interface ToolHookInput {
  /** Tool name the host is about to run (or has run). */
  tool: string;
  sessionID: string;
  /** Arguments the model supplied, for the commit-trailer check. */
  args?: unknown;
}

export interface PcpHooks {
  /** A write tool is about to run: activate the queued head when nothing is active. */
  beforeTool(input: ToolHookInput): Promise<void>;
  /**
   * A tool has finished. Returns the replacement output text when the result must be
   * amended (the unplanned-edit warning), or null when it is unchanged.
   */
  afterTool(input: ToolHookInput, output: string): Promise<string | null>;
  /** The once-per-session misplaced-state warning text, or null. */
  misplaced(sessionID: string): Promise<string | null>;
  /** The compaction resume context, or null when there is nothing to add. */
  compaction(sessionID: string): Promise<string | null>;
}

export function createPcpHooks(deps: HookDeps): PcpHooks {
  // Sessions already warned about running one level above their PCP state.
  const misplacedWarned = new Set<string>();
  // Sessions already warned that a write ran with no active or queued task.
  const unplannedEditWarned = new Set<string>();

  return {
    async beforeTool(input) {
      try {
        const { tool: toolName, sessionID } = input;
        if (toolName.startsWith("pcp_")) return;
        if (!isWriteTool(toolName)) return;

        const dir = await deps.sessionDir(sessionID);
        if (readStack(dir).active_task_id) return;

        autoActivateQueuedTask(dir);
      } catch {
        // silent
      }
    },

    async afterTool(input, output) {
      // PCP_TASK_BINDING_FIX (forked locally; not re-downloaded):
      // Fallback closure path. The preferred path (B077/P4) is to call pcp_done before the
      // closing commit, which writes the PCP state so it can be staged into that same commit.
      // This hook then only auto-closes a task when the commit names it explicitly via a
      // `PCP-Task: T###` trailer. Without a matching reference the queue is left unchanged, so
      // an unrelated commit can no longer silently advance (or mis-attribute) the active task.
      try {
        const { tool: toolName, sessionID, args } = input;
        if (toolName.startsWith("pcp_")) return null;

        // Surface an unplanned edit in the tool's own result. The before-hook
        // already auto-advances a queued task; this covers the empty-queue gap.
        if (isWriteTool(toolName)) {
          const dir = await deps.sessionDir(sessionID);
          const stack = readStack(dir);
          const result = applyUnplannedEditWarning({
            activeTaskId: stack.active_task_id,
            readyTaskCount: stack.ready_tasks.length,
            warned: unplannedEditWarned.has(sessionID),
            pcpManaged: existsSync(pcpDir(dir)),
            output,
          });
          if (result.warned) unplannedEditWarned.add(sessionID);
          return result.output === output ? null : result.output;
        }

        if (!isBashTool(toolName)) return null;

        const callArgs = (args ?? {}) as { command?: unknown; cmd?: unknown; input?: unknown };
        const cmd: string =
          typeof callArgs.command === "string" ? callArgs.command :
          typeof callArgs.cmd === "string" ? callArgs.cmd :
          typeof callArgs.input === "string" ? callArgs.input : "";

        if (!/git\s+commit/.test(cmd)) return null;

        const dir = await deps.sessionDir(sessionID);

        // PCP_COMMIT_FILE_FIX (forked locally; not re-downloaded):
        // `git commit -F <file>` keeps the message out of the command string, so parse
        // the file's contents too; a bare command match misses the trailer and
        // auto-close silently skips (B024).
        const source = commitTrailerSource(cmd, (file) => {
          try {
            const resolved = path.isAbsolute(file) ? file : path.join(dir, file);
            return readFileSync(resolved, "utf8");
          } catch {
            return null;
          }
        });

        const taskRef = parsePcpTaskRef(source);
        if (!taskRef) {
          console.log("[PCP] commit has no PCP-Task trailer; leaving active task unchanged");
          return null;
        }

        autoDoneTask(dir, taskRef.id);
        return null;
      } catch {
        return null;
      }
    },

    // Warn immediately (once per session) when opencode is running one level above its PCP state
    // — e.g. in the repo root instead of the project dir — so a divergent state is not created
    // silently. The adapter injects the returned text into the current turn: V1 as a synthetic
    // message part, the dynamic channel, because the system array is cached and must stay
    // constant (see PCP_CACHE_FIX in plugins/pcp.ts).
    async misplaced(sessionID) {
      if (misplacedWarned.has(sessionID)) return null;
      const dir = await deps.sessionDir(sessionID);
      const warning = misplacedStateWarning(dir);
      if (!warning) return null;

      misplacedWarned.add(sessionID);
      console.warn(warning);
      return warning;
    },

    async compaction(sessionID) {
      try {
        const dir = await deps.sessionDir(sessionID);
        const stack = readStack(dir);
        const tasks = replayEvents(dir);
        const projectCtx = readProjectContext(dir);
        const pendingCount = getPendingBacklog(dir).length;
        const ctx = buildResumeContext(stack, tasks, projectCtx, pendingCount, dir);
        return ctx || null;
      } catch {
        return null;
      }
    },
  };
}
