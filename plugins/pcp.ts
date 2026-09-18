import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  appendEvent,
  appendWorklog,
  ensureDir,
  getPendingBacklog,
  getTask,
  readProjectContext,
  readProjectMd,
  readStack,
  replayBacklog,
  replayEvents,
  scanProject,
  writeHandoff,
  writeProjectFiles,
  writeStack,
} from "./state.js";
import type { ProjectData, Stack, Task } from "./state.js";
import { commitTrailerSource } from "./commit_ref.js";
import { decideStart } from "./pcp_start.js";
import { decidePromote } from "./pcp_promote.js";
import { PCP_RULE } from "./pcp_rule.js";

// ──────────────────────────────────────────────
// Tool name classifiers
// ──────────────────────────────────────────────

const WRITE_PATTERNS = ["write", "edit", "patch", "create", "apply"];
const BASH_PATTERNS  = ["bash", "shell", "exec", "run", "terminal"];

export function isWriteTool(name: string): boolean {
  const n = name.toLowerCase();
  return WRITE_PATTERNS.some((p) => n.includes(p));
}

export function isBashTool(name: string): boolean {
  const n = name.toLowerCase();
  return BASH_PATTERNS.some((p) => n.includes(p));
}

// PCP_TASK_BINDING_FIX (local patch — re-apply if this file is re-downloaded from pcp-skills):
// Fallback closure path. The preferred path (B077/P4) is to call pcp_done before the closing
// commit, which writes the PCP state so it can be staged into that same commit. This hook then
// only auto-closes a task when the commit names it explicitly via a `PCP-Task: T###` trailer.
// Without a matching reference the queue is left unchanged, so an unrelated commit can no longer
// silently advance (or mis-attribute) the active task.
export function parsePcpTaskRef(cmd: string): { id: string } | null {
  const m = /PCP-Task:\s*(T\d+)/i.exec(cmd);
  return m ? { id: m[1] } : null;
}

// ──────────────────────────────────────────────
// Context builders (token budget: ≤3 / ≤5 lines)
// ──────────────────────────────────────────────

// PCP behavioral rule — always injected to ALL agents via system.transform.
//
// PCP_CACHE_FIX (local patch — re-apply if this file is re-downloaded from pcp-skills):
// This rule is the ONLY thing injected into the system prompt. It is a constant, so the system
// array is byte-identical on every request and llama.cpp's prompt cache stays warm for the whole
// session. Volatile state used to be appended alongside it, which put changing values at the very
// front of each request: any change (PCP advances the active task on every commit) invalidated the
// prefix and forced a full re-prefill of the entire conversation — measured at ~140s for 37k
// tokens on the M1 Pro. Task state is available on demand via pcp_status / pcp_backlog.
// Do NOT reintroduce changing values here.

function buildResumeContext(
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
// Plugin
// ──────────────────────────────────────────────

export const PCPPlugin: Plugin = async ({ directory, client }) => {
  console.log("PCP initialized");

  // ── Session helpers (cached to avoid repeated API calls) ────

  const sessionDirCache = new Map<string, string>();

  async function getSessionDir(sessionID: string): Promise<string> {
    const cached = sessionDirCache.get(sessionID);
    if (cached) return cached;
    try {
      const resp = await client.session.get({ path: { id: sessionID } });
      const dir: string = (resp.data as any)?.directory ?? directory;
      sessionDirCache.set(sessionID, dir);
      return dir;
    } catch {
      return directory;
    }
  }

  async function resolveTitle(sessionID: string): Promise<string> {
    try {
      const resp = await client.session.get({ path: { id: sessionID } });
      const title: string = (resp.data as any)?.title?.trim() ?? "";
      if (title) return title.slice(0, 60);

      const msgsResp = await client.session.messages({ path: { id: sessionID } });
      const messages: any[] = (msgsResp.data as any) ?? [];
      const userMsgs = messages.filter((m: any) => m.info?.role === "user");
      const last = userMsgs[userMsgs.length - 1];
      if (last) {
        const text = (last.parts ?? [])
          .filter((p: any) => p.type === "text" && !p.synthetic)
          .map((p: any) => p.text ?? "")
          .join(" ")
          .trim();
        if (text) return text.slice(0, 60);
      }
    } catch {}
    return "Untitled task";
  }

  // ── Auto-lifecycle internals ─────────────────

  function autoCreateTask(dir: string, title: string): void {
    ensureDir(dir);
    const stack = readStack(dir);
    if (stack.active_task_id) return;

    // Guard: skip creation if a task was just done within the last 1s
    // This prevents the main-line auto-re-instantiation loop
    if (stack.last_done_ts && Date.now() - stack.last_done_ts < 1000) {
      return;
    }

    // Auto-advance from ready queue if available
    if (stack.ready_tasks.length > 0) {
      const next = stack.ready_tasks.shift()!;
      stack.active_stack = [next.id];
      stack.active_task_id = next.id;
      writeStack(dir, stack);
      console.log(`[PCP] auto-advanced to ${next.id}: ${next.title}`);
      return;
    }

    // No ready tasks → create ad-hoc task
    const id = `T${String(stack.next_id).padStart(3, "0")}`;
    appendEvent(dir, { e: "created", id, type: "main", title, ts: Date.now() });
    stack.active_stack = [id];
    stack.active_task_id = id;
    stack.next_id++;
    writeStack(dir, stack);
    console.log(`[PCP] auto-started ${id}: ${title}`);
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
    stack.active_stack.pop();

    if (stack.active_stack.length > 0) {
      // Return to parent task (sub-task done)
      stack.active_task_id = stack.active_stack[stack.active_stack.length - 1];
    } else if (stack.ready_tasks.length > 0) {
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

  return {
    // ── Tools ──────────────────────────────────

    tool: {
      /**
       * Scan the project and establish a baseline context.
       * Call once when first introducing PCP to an existing project.
       */
      pcp_init: tool({
        description:
          "Scan the project (README, package.json, entry files, etc.) and establish a baseline context. " +
          "Call once when first introducing PCP to an existing project. From then on the context is injected automatically every session.",
        args: {
          extra: tool.schema
            .string()
            .optional()
            .describe(
              "Optional: extra notes (completed features, current milestone, etc.) appended after the automatic scan result",
            ),
        },
        async execute({ extra }, context) {
          const dir = context.directory;
          ensureDir(dir);

          const { summary, detail, key_files } = scanProject(dir);
          const full = extra ? `${summary}；${extra}` : summary;

          appendEvent(dir, {
            e: "project_context",
            summary: full,
            ts: Date.now(),
          });

          // Generate PROJECT.md + PROJECT.json
          const projectData: ProjectData = {
            name: summary.split("；")[0] || path.basename(dir),
            summary: full,
            detail: detail || null,
            extra: extra || null,
            key_files,
            status: null,
            updated_at: new Date().toISOString().slice(0, 10),
          };
          writeProjectFiles(dir, projectData);
          appendWorklog(dir, `📦 pcp_init: project baseline established`);

          const lines = [
            `✅ PCP project baseline established`,
            ``,
            `📦 Project summary: ${full}`,
          ];
          if (detail) {
            lines.push(``, `Scan details:`, ...detail.split("\n").map((l) => `  ${l}`));
          }
          lines.push(
            ``,
            `📝 Generated .opencode/pcp/PROJECT.md — consider filling in the "Current state" section`,
            `🌐 Browser preview: .opencode/pcp/PROJECT.html`,
            `📝 Initialized .opencode/pcp/WORKLOG.md — later operations are recorded automatically`,
            ``,
            `This context is injected automatically on every turn and compaction.`,
            `Call pcp_init again to refresh.`,
          );

          return lines.join("\n");
        },
      }),

      pcp_start: tool({
        description:
          "Manually start a concrete task (when there are several, prefer batch-loading with pcp_plan). " +
          "[Granularity] The title must be a concrete deliverable, doable in ≤2 hours, with an acceptance criterion. " +
          "Do not use this tool to create project goals or broad direction descriptions (e.g. 'build XX system'). " +
          "If a task is already active, it will prompt you to finish it first.",
        args: {
          title: tool.schema.string().describe("Sprint title"),
        },
        async execute({ title }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          // B020: never mint a new id while the ready queue holds work. After a
          // pivot with no new_task the active slot is empty but the queue is not;
          // the old code created a duplicate T-id instead of activating the head.
          const decision = decideStart(stack, title);

          if (decision.kind === "blocked") {
            const tasks = replayEvents(dir);
            const active = getTask(tasks, decision.activeId);
            return [
              `⚠️ Sprint [${decision.activeId}: ${active?.title ?? ""}] is still in progress.`,
              ``,
              `Finish the current sprint first:`,
              `  1. git commit the current changes (this closes the sprint automatically)`,
              `  2. then call pcp_start again to begin "${title}"`,
            ].join("\n");
          }

          let id: string;
          let startedTitle: string;
          let advanced = false;

          if (decision.kind === "advance") {
            // Activate the queued head; the handler owns the mutation (decideStart is pure).
            stack.ready_tasks.shift();
            id = decision.id;
            startedTitle = decision.title;
            advanced = true;
            stack.active_stack = [id];
            stack.active_task_id = id;
            writeStack(dir, stack);
            console.log(`[PCP] pcp_start advanced to queued ${id}: ${startedTitle}`);
          } else {
            id = decision.id;
            startedTitle = title;
            appendEvent(dir, { e: "created", id, type: "main", title, ts: Date.now() });
            stack.active_stack = [id];
            stack.active_task_id = id;
            stack.next_id++;
            writeStack(dir, stack);
          }

          const lines = [
            advanced
              ? `⏭️ Sprint [${id}] started from queue: ${startedTitle}`
              : `✅ Sprint [${id}] started: ${startedTitle}`,
          ];

          // Surface backlog items
          const pending = getPendingBacklog(dir);
          if (pending.length > 0) {
            lines.push(``, `📋 Backlog has ${pending.length} item(s) pending review:`);
            for (const item of pending) {
              lines.push(`  ${item.id}: ${item.title}`);
            }
            lines.push(``, `Use the \`pcp-sprint-review\` skill to decide whether to add them to this sprint, or just start working.`);
          }

          return lines.join("\n");
        },
      }),

      pcp_plan: tool({
        description:
          "Load a list of planned tasks. The first task starts immediately (doing); the rest queue in order (ready). " +
          "If a task is already active, new tasks append to the end of the queue. " +
          "When the user gives a todolist or plan document, parse it into an ordered task list before calling this tool. " +
          "[Task quality] Each task title must be concrete and verifiable: state the files/goal, expected result, or acceptance condition; avoid vague descriptions. " +
          "Example: 'src/fetcher.py: restrict china_ai sources + keyword allowlist (emit 3 matching samples)' beats 'improve source filtering'.",
        args: {
          tasks: tool.schema
            .array(tool.schema.string())
            .describe("Ordered list of task titles, e.g. ['implement login page', 'add form validation', 'wire up API']"),
        },
        async execute({ tasks }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (tasks.length === 0) return "❌ Task list is empty";

          const created: { id: string; title: string }[] = [];
          for (const title of tasks) {
            const id = `T${String(stack.next_id).padStart(3, "0")}`;
            appendEvent(dir, { e: "created", id, type: "main", title, ts: Date.now() });
            created.push({ id, title });
            stack.next_id++;
          }

          if (stack.active_task_id) {
            // Active task exists → all new tasks append to ready queue
            const activeTasks = replayEvents(dir);
            const activeTask = getTask(activeTasks, stack.active_task_id);
            stack.ready_tasks = [...stack.ready_tasks, ...created];
            writeStack(dir, stack);
            return [
              `📋 ${created.length} task(s) added to the queue (awaiting confirmation):`,
              ...created.map((t) => `  ⏳ ${t.id}: ${t.title}`),
              ``,
              `⚠️  The main task is still active: ${activeTask?.title ?? stack.active_task_id}`,
              `👉 Suggestion: call pcp_done to close the current task and the queue will auto-advance;`,
              `   or finish the current task and let the queue advance naturally.`,
              `   [Do NOT] use pcp_sub to manually re-execute queued tasks.`,
            ].join("\n");
          }

          // No active task → first = doing, rest = ready
          const [first, ...rest] = created;
          stack.active_stack = [first.id];
          stack.active_task_id = first.id;
          stack.ready_tasks = [...stack.ready_tasks, ...rest];
          writeStack(dir, stack);

          appendWorklog(dir, `📋 Plan loaded ${created.length} task(s): ${created.map(t => t.id).join(", ")}`);
          const lines = [`📋 Plan loaded (${created.length} task(s)), awaiting confirmation:`];
          lines.push(`  📌 ${first.id}: ${first.title}`);
          for (const t of rest) {
            lines.push(`  ⏳ ${t.id}: ${t.title}`);
          }

          const pending = getPendingBacklog(dir);
          if (pending.length > 0) {
            lines.push(``, `📋 Backlog has ${pending.length} item(s) pending review — see pcp_backlog`);
          }

          lines.push(``, `⏸ Start executing? Adjust task descriptions here, then reply "confirm".`);

          return lines.join("\n");
        },
      }),

      pcp_sub: tool({
        description:
          "Start a subtask (pushed on top of the current task). After git commit it pops back to the main line.",
        args: {
          title: tool.schema.string().describe("Subtask title"),
        },
        async execute({ title }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (!stack.active_task_id) {
            return "❌ No active main task; write some code to trigger auto-start first";
          }

          const parentId = stack.active_task_id;
          const id = `T${String(stack.next_id).padStart(3, "0")}`;

          const tasks = replayEvents(dir);
          const parentTitle = getTask(tasks, parentId)?.title ?? parentId;
          const resumePrompt = `About to start subtask [${title}]; when done, continue the main task: ${parentTitle}.`;

          appendEvent(dir, {
            e: "resume_set",
            id: parentId,
            prompt: resumePrompt,
            ts: Date.now(),
          });
          appendEvent(dir, { e: "sub", id, parent: parentId, title, ts: Date.now() });

          stack.active_stack.push(id);
          stack.active_task_id = id;
          stack.next_id++;
          writeStack(dir, stack);

          return `✅ Subtask [${id}] started: ${title}\n\nAfter git commit it returns to the main line automatically`;
        },
      }),

      pcp_done: tool({
        description:
          "Complete the current task. Call this before the closing commit: it writes the PCP state, " +
          "so you can stage .opencode/pcp in that same commit (one commit per task). A git commit " +
          "with a `PCP-Task` trailer also closes the active task, as a fallback. If the queue has a " +
          "next task it advances automatically; when all are done it prompts for a new plan.",
        args: {},
        async execute(_args, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (!stack.active_task_id) return "❌ No active task";

          const doneId = stack.active_task_id;
          const tasks = replayEvents(dir);
          const doneTask = getTask(tasks, doneId);
          appendEvent(dir, { e: "done", id: doneId, ts: Date.now() });
          appendWorklog(dir, `✅ [${doneId}] ${doneTask?.title ?? doneId}`);
          stack.active_stack.pop();

          // Case 1: sub-task done → return to parent
          if (stack.active_stack.length > 0) {
            const parentId = stack.active_stack[stack.active_stack.length - 1];
            stack.active_task_id = parentId;
            writeStack(dir, stack);

            const parentTask = getTask(tasks, parentId);
            if (parentTask) {
              return `Subtask [${doneTask?.title ?? doneId}] complete.\nContinue the main task: ${parentTask.title}.`;
            }
            return `✅ [${doneId}] complete; back to [${parentId}]`;
          }

          // Case 2: main task done → try auto-advance from ready queue
          if (stack.ready_tasks.length > 0) {
            const next = stack.ready_tasks.shift()!;
            stack.active_stack = [next.id];
            stack.active_task_id = next.id;
            writeStack(dir, stack);

            const remaining = stack.ready_tasks.length;
            const lines = [
              `✅ [${doneId}] ${doneTask?.title ?? ""} complete!`,
              ``,
              `⏭️ Auto-advancing → [${next.id}] ${next.title}`,
            ];
            if (remaining > 0) {
              lines.push(`   (${remaining} more task(s) queued)`);
            } else {
              lines.push(`   (this is the last planned task)`);
            }
            return lines.join("\n");
          }

          // Case 3: all tasks done
          stack.active_task_id = null;
          writeStack(dir, stack);

          const pending = getPendingBacklog(dir);
          const lines = [`🎉 All planned tasks are complete!`];
          if (pending.length > 0) {
            lines.push(
              ``,
              `📋 Backlog has ${pending.length} item(s) pending review:`,
              ...pending.map((item) => `  ${item.id}: ${item.title}`),
            );
          }
          lines.push(``, `💡 Suggestion: have the planner lay out the next round, then load it with pcp_plan.`);
          return lines.join("\n");
        },
      }),

      pcp_pivot: tool({
        description:
          "When a better direction appears mid-way, abandon the current task and record why. " +
          "Unlike pcp_done, pivot means the task was not completed but was superseded by a better approach, and the reason is kept in history. " +
          "When the user says \"originally / was going to ... now / changed to / found something better\", confirm before calling.",
        args: {
          reason: tool.schema.string().describe("Pivot reason, e.g. \"found that generating the press release directly is more efficient\""),
          new_task: tool.schema
            .string()
            .optional()
            .describe("Optional: title of a new task to start immediately"),
          drop_queue: tool.schema
            .boolean()
            .optional()
            .describe("Optional: also clear the remaining task queue (use when the whole plan changes; default false)"),
        },
        async execute({ reason, new_task, drop_queue = false }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (!stack.active_task_id) return "❌ No active task";

          const pivotId = stack.active_task_id;
          const tasks = replayEvents(dir);
          const pivotTask = getTask(tasks, pivotId);

          // Record pivot event (not "done")
          appendEvent(dir, { e: "pivoted", id: pivotId, reason, ts: Date.now() });
          appendWorklog(dir, `🔄 [${pivotId}] ${pivotTask?.title ?? pivotId} → pivot: ${reason}`);
          stack.active_stack.pop();

          const droppedQueue = drop_queue ? stack.ready_tasks.splice(0) : [];

          const lines = [
            `🔄 [${pivotId}] ${pivotTask?.title ?? ""} → pivot`,
            `   Reason: ${reason}`,
          ];

          if (droppedQueue.length > 0) {
            lines.push(`   Cleared ${droppedQueue.length} queued task(s)`);
          }

          if (new_task) {
            // Start new task immediately
            const id = `T${String(stack.next_id).padStart(3, "0")}`;
            appendEvent(dir, { e: "created", id, type: "main", title: new_task, ts: Date.now() });
            stack.active_stack = [id];
            stack.active_task_id = id;
            stack.next_id++;
            writeStack(dir, stack);
            lines.push(``, `⏭️ New direction → [${id}] ${new_task}`);
            if (stack.ready_tasks.length > 0) {
              lines.push(`   (${stack.ready_tasks.length} task(s) still queued)`);
            }
          } else {
            stack.active_task_id =
              stack.active_stack.length > 0
                ? stack.active_stack[stack.active_stack.length - 1]
                : null;
            writeStack(dir, stack);
            lines.push(``, `💡 Call pcp_start or pcp_plan to begin the new direction.`);
          }

          return lines.join("\n");
        },
      }),

      pcp_status: tool({
        description: "View the current task stack, queue, project baseline, and backlog status.",
        args: {},
        async execute(_args, context) {
          const dir = context.directory;
          const stack = readStack(dir);
          const projectCtx = readProjectContext(dir);
          const lines: string[] = [];

          if (projectCtx) lines.push(`[Project] ${projectCtx}`);

          if (!stack.active_task_id) {
            lines.push("No active task.");
            if (stack.ready_tasks.length > 0) {
              lines.push(`\n⏳ ${stack.ready_tasks.length} queued task(s) waiting:`);
              for (const t of stack.ready_tasks) {
                lines.push(`  ${t.id}: ${t.title}`);
              }
            }
            const pending = getPendingBacklog(dir);
            if (pending.length > 0) {
              lines.push(`📋 Backlog has ${pending.length} item(s) pending review; see pcp_backlog.`);
            }
            lines.push(`\n💡 Suggestion: have the planner lay out tasks, then load them with pcp_plan.`);
            return lines.join("\n");
          }

          const tasks = replayEvents(dir);
          lines.push("Current task stack:");

          for (let i = 0; i < stack.active_stack.length; i++) {
            const id = stack.active_stack[i];
            const task = getTask(tasks, id);
            const isCurrent = id === stack.active_task_id;
            const prefix = i === 0 ? "[main]" : "[sub]";
            lines.push(
              `  ${prefix} ${id} ${task?.title ?? id}${isCurrent ? "  ← current" : ""}`,
            );
          }

          if (stack.ready_tasks.length > 0) {
            lines.push(`\n⏳ Queue (${stack.ready_tasks.length}):`);
            for (const t of stack.ready_tasks) {
              lines.push(`  ${t.id}: ${t.title}`);
            }
          }

          const pending = getPendingBacklog(dir);
          if (pending.length > 0) {
            lines.push(`📋 Backlog: ${pending.length} item(s) pending review`);
          }

          return lines.join("\n");
        },
      }),

      pcp_handoff: tool({
        description:
          "Generate HANDOFF.md on demand for AI tools without shared memory (ChatGPT, Claude Code, OpenCode, etc.). " +
          "Content comes from PCP's current tasks, queue, backlog, PROJECT.md, and WORKLOG.md.",
        args: {
          audience: tool.schema
            .string()
            .optional()
            .describe("Optional: the tool or audience taking over, e.g. Claude Code / ChatGPT"),
          focus: tool.schema
            .string()
            .optional()
            .describe("Optional: this handoff's focus, e.g. \"continue fixing the handoff tests\""),
          include_backlog: tool.schema
            .boolean()
            .optional()
            .describe("Whether to include pending backlog items; default true"),
        },
        async execute({ audience, focus, include_backlog = true }, context) {
          const dir = context.directory;
          const { path: handoffPath, markdown } = writeHandoff(dir, {
            audience,
            focus,
            include_backlog,
          });

          appendWorklog(
            dir,
            `🤝 Generated HANDOFF.md${focus ? ` (focus: ${focus})` : ""}`,
          );

          const preview = markdown
            .split("\n")
            .slice(0, 12)
            .join("\n");

          return [
            `🤝 Handoff document generated: ${handoffPath}`,
            "",
            "Purpose: compress the current PCP state into context that can be handed directly to the next AI.",
            "Content: current tasks, progress, outstanding items, backlog, recent events, suggested next steps.",
            "",
            "Preview:",
            preview,
          ].join("\n");
        },
      }),

      // ── Backlog tools ───────────────────────────

      pcp_capture: tool({
        description:
          "Record a temporary idea or requirement to the backlog without executing it now. " +
          "Call immediately when the user says \"do X later\", \"also add X\", \"want to do X someday\", or \"note X\". " +
          "Review them together at sprint end via the pcp-sprint-review skill.",
        args: {
          title: tool.schema.string().describe("Requirement or idea title"),
          detail: tool.schema.string().optional().describe("Optional: additional notes"),
        },
        async execute({ title, detail }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);
          const id = `B${String(stack.backlog_next_id).padStart(3, "0")}`;

          appendEvent(dir, { e: "backlog_add", id, title, detail, ts: Date.now() });
          stack.backlog_next_id++;
          writeStack(dir, stack);

          return `📝 Logged to backlog: [${id}] ${title}\nThe current sprint continues; review at sprint end.`;
        },
      }),

      pcp_backlog: tool({
        description: "View all pending items in the backlog.",
        args: {},
        async execute(_args, context) {
          const dir = context.directory;
          const pending = getPendingBacklog(dir);

          if (pending.length === 0) return "📋 Backlog is empty.";

          const lines = [`📋 Backlog (${pending.length}):`];
          for (const item of pending) {
            lines.push(`  ${item.id}: ${item.title}`);
            if (item.detail) lines.push(`       ${item.detail}`);
          }
          return lines.join("\n");
        },
      }),

      pcp_promote: tool({
        description:
          "Add a backlog item to the current sprint. It is appended to the ready queue and " +
          "runs in FIFO order after the active task. Used during sprint review.",
        args: {
          backlog_id: tool.schema.string().describe("Backlog item ID (e.g. B001)"),
          title: tool.schema.string().optional().describe("Optional: override the task title"),
        },
        async execute({ backlog_id, title }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          // PCP_PROMOTE_ENQUEUE_FIX: append the promoted item to the sprint queue
          // instead of nesting it on the active stack. Nesting reversed repeated
          // promotions (LIFO, B074/T135) and forced a refusal while a subtask was
          // active. Enqueuing preserves FIFO order and works at any depth.
          const decision = decidePromote(stack);
          if (decision.kind === "no-sprint") {
            return `❌ No active sprint; call pcp_start to begin one first`;
          }

          const backlog = replayBacklog(dir);
          const item = backlog.find((b) => b.id === backlog_id);
          if (!item) return `❌ Backlog item ${backlog_id} not found`;
          if (item.status !== "pending") return `❌ ${backlog_id} is ${item.status} and cannot be added`;

          const taskTitle = title || item.title;
          const id = `T${String(stack.next_id).padStart(3, "0")}`;

          appendEvent(dir, { e: "created", id, type: "main", title: taskTitle, ts: Date.now() });
          appendEvent(dir, { e: "backlog_promote", backlog_id, task_id: id, ts: Date.now() });

          stack.ready_tasks.push({ id, title: taskTitle });
          stack.next_id++;
          writeStack(dir, stack);

          return `✅ [${backlog_id}] queued as [${id}]: ${taskTitle} (runs after the active task [${decision.activeId}])`;
        },
      }),

      pcp_dismiss: tool({
        description: "Dismiss a backlog item (not doing it this time, and stop reminding).",
        args: {
          backlog_id: tool.schema.string().describe("Backlog item ID (e.g. B001)"),
        },
        async execute({ backlog_id }, context) {
          const dir = context.directory;
          ensureDir(dir);

          const backlog = replayBacklog(dir);
          const item = backlog.find((b) => b.id === backlog_id);
          if (!item) return `❌ Backlog item ${backlog_id} not found`;
          if (item.status !== "pending") return `ℹ️ ${backlog_id} is already ${item.status}`;

          appendEvent(dir, { e: "backlog_dismiss", backlog_id, ts: Date.now() });
          return `❌ [${backlog_id}] dismissed: ${item.title}`;
        },
      }),

      pcp_backlog_done: tool({
        description:
          "Mark a backlog item done when it was completed outside pcp_promote (e.g. an ad-hoc " +
          "detour). Unlike pcp_dismiss, this records that the item was actually delivered.",
        args: {
          backlog_id: tool.schema.string().describe("Backlog item ID (e.g. B001)"),
        },
        async execute({ backlog_id }, context) {
          const dir = context.directory;
          ensureDir(dir);

          const backlog = replayBacklog(dir);
          const item = backlog.find((b) => b.id === backlog_id);
          if (!item) return `❌ Backlog item ${backlog_id} not found`;
          if (item.status !== "pending") return `ℹ️ ${backlog_id} is already ${item.status}`;

          appendEvent(dir, { e: "backlog_done", backlog_id, ts: Date.now() });
          return `✅ [${backlog_id}] marked done: ${item.title}`;
        },
      }),

      pcp_history: tool({
        description: "View all historical sprints (completed + in progress) and the full backlog record.",
        args: {
          limit: tool.schema
            .number()
            .optional()
            .describe("Maximum completed sprints to show (default 20)"),
        },
        async execute({ limit = 20 }, context) {
          const dir = context.directory;
          const tasks = replayEvents(dir);
          const backlog = replayBacklog(dir);
          const stack = readStack(dir);

          const lines: string[] = [];

          // Completed main sprints
          const done = tasks
            .filter((t) => t.done && t.type === "main")
            .slice(-limit);
          if (done.length > 0) {
            lines.push("=== Completed sprints ===");
            for (const t of done) {
              const isPivoted = (t as any).pivoted;
              const pivotReason = (t as any).pivot_reason;
              const icon = isPivoted ? "🔄" : "✅";
              const suffix = isPivoted && pivotReason ? `  (pivot: ${pivotReason})` : "";
              lines.push(`  ${icon} ${t.id}  ${t.title}${suffix}`);
            }
          }

          // Active stack
          if (stack.active_task_id) {
            lines.push("\n=== In progress ===");
            for (let i = 0; i < stack.active_stack.length; i++) {
              const id = stack.active_stack[i];
              const t = getTask(tasks, id);
              const isCurrent = id === stack.active_task_id;
              const prefix = i === 0 ? "[main]" : "[sub]";
              lines.push(
                `  📌 ${prefix} ${id}  ${t?.title ?? id}${isCurrent ? "  ← current" : ""}`,
              );
            }
          }

          // Ready queue
          if (stack.ready_tasks.length > 0) {
            lines.push("\n=== Queue ===");
            for (const t of stack.ready_tasks) {
              lines.push(`  ⏳ ${t.id}  ${t.title}`);
            }
          }

          // Full backlog
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
        },
      }),
    },

    // ── Auto-lifecycle hooks ────────────────────

    "tool.execute.before": async (input, _output) => {
      try {
        const { tool: toolName, sessionID } = input;
        if (toolName.startsWith("pcp_")) return;
        if (!isWriteTool(toolName)) return;

        const dir = await getSessionDir(sessionID);
        const stack = readStack(dir);
        if (stack.active_task_id) return;

        const title = await resolveTitle(sessionID);
        autoCreateTask(dir, title);
      } catch {
        // silent
      }
    },

    "tool.execute.after": async (input, _output) => {
      try {
        const { tool: toolName, sessionID, args } = input;
        if (!isBashTool(toolName)) return;

        const cmd: string =
          typeof args?.command === "string" ? args.command :
          typeof args?.cmd === "string" ? args.cmd :
          typeof args?.input === "string" ? args.input : "";

        if (!/git\s+commit/.test(cmd)) return;

        const dir = await getSessionDir(sessionID);

        // PCP_COMMIT_FILE_FIX (local patch — re-apply if this file is re-downloaded from pcp-skills):
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
          return;
        }

        autoDoneTask(dir, taskRef.id);
      } catch {
        // silent
      }
    },

    // ── Context injection hooks ─────────────────

    // Constant only — see the PCP_CACHE_FIX note on PCP_RULE above. Anything that changes between
    // turns belongs at the *end* of the request (a message), never in the system array.
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        if (!output.system.includes(PCP_RULE)) output.system.push(PCP_RULE);
      } catch {
        // silent
      }
    },

    "experimental.session.compacting": async (input, output) => {
      try {
        const dir = await getSessionDir(input.sessionID);
        const stack = readStack(dir);
        const tasks = replayEvents(dir);
        const projectCtx = readProjectContext(dir);
        const pendingCount = getPendingBacklog(dir).length;
        const ctx = buildResumeContext(stack, tasks, projectCtx, pendingCount, dir);
        if (ctx) output.context.push(ctx);
      } catch {
        // silent
      }
    },
  };
};

export default PCPPlugin;
