// Shared PCP tool implementations.
//
// Every tool body lives here, free of any plugin-API type, so the V1 plugin
// (plugins/pcp.ts) and a future V2 port register the same code. A tool is
// {name, description, args (a zod raw shape), run(args, env)}; `env.dir` is the
// session's project directory, which each host supplies its own way (V1 tool
// context `directory`, V2 the session record).

import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";

// `zod` is the schema language on both sides: V1's tool() takes a zod raw shape, and V2
// accepts a zod object as a StandardSchemaV1 input. It is currently satisfied by
// @opencode-ai/plugin's hoisted dependency (4.1.8); declare it in package.json when the V2
// dependency (@opencode/plugin) is added, so the coupling is explicit.

import {
  appendEvent,
  appendWorklog,
  ensureDir,
  getPendingBacklog,
  getTask,
  readEventLog,
  readProjectContext,
  readStack,
  replayBacklog,
  replayEvents,
  scanProject,
  writeHandoff,
  writeProjectFiles,
  writeStack,
} from "./state.js";
import type { ProjectData } from "./state.js";
import { decideStart } from "./pcp_start.js";
import { decidePromote } from "./pcp_promote.js";
import { decideRename, renameOutcome } from "./pcp_rename.js";
import { runReorder } from "./pcp_reorder.js";
import { decideBacklogAction, resolvePlanEntries } from "./backlog_state.js";
import { noActiveSprint, noActiveTask, noReadyTask } from "./guidance.js";
import { decideTaskDone } from "./pcp_done.js";
import { itemsCreatedSince, taskStartedAt, touchedPathsNamed, unrecordedDeferrals } from "./deferral.js";
import {
  decideDemote,
  decidePivot,
  decidePlan,
  decideSubStart,
  decideSwap,
  planEvents,
} from "./task_flow.js";
import { lastEventSummary } from "./task_state.js";
import { renderBacklog, renderHistory, renderTasks } from "./status_view.js";

export interface ToolEnv {
  /** Project directory the session runs in. */
  dir: string;
  sessionID?: string;
}

export interface PcpTool {
  name: string;
  description: string;
  args: z.ZodRawShape;
  run: (args: any, env: ToolEnv) => string | Promise<string>;
}

// Keeps each `run` body fully typed from its own `args` shape while the exported
// list stays uniform for the hosts. The cast is the single untyped seam.
function defineTool<A extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  args: A;
  run: (args: z.infer<z.ZodObject<A>>, env: ToolEnv) => string | Promise<string>;
}): PcpTool {
  return def as unknown as PcpTool;
}

/** The path on a `git status --porcelain` line, with a rename reduced to its target. */
function porcelainPath(line: string): string | null {
  if (line.length < 4) return null;
  const target = line.slice(3);
  const arrow = target.indexOf(" -> ");
  const name = arrow === -1 ? target : target.slice(arrow + 4);
  return name.replace(/^"|"$/g, "");
}

/**
 * Files the working tree has changed, which is what the active task has opened.
 *
 * The PCP flow closes a task before committing it, so the staged and untracked work
 * is the task's diff at the moment either guard asks. A repo this cannot read (no
 * git, no directory) yields nothing: the guards never refuse on a guess.
 */
function changedPaths(dir: string): string[] {
  try {
    const output = execFileSync("git", ["-C", dir, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split("\n")
      .map(porcelainPath)
      .filter((name): name is string => name !== null && name.length > 0);
  } catch {
    return [];
  }
}

export const PCP_TOOLS: PcpTool[] = [
  defineTool({
    name: "pcp_init",
    description:
      "Scan the project (README, package.json, entry files, etc.) and establish a baseline context. " +
      "Call once when first introducing PCP to an existing project. From then on the context is injected automatically every session.",
    args: {
      extra: z
        .string()
        .optional()
        .describe(
          "Optional: extra notes (completed features, current milestone, etc.) appended after the automatic scan result",
        ),
    },
    run({ extra }, env) {
      const dir = env.dir;
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
        `📝 Initialized .opencode/pcp/WORKLOG.md — later operations are recorded automatically`,
        ``,
        `This context is injected automatically on every turn and compaction.`,
        `Call pcp_init again to refresh.`,
      );

      return lines.join("\n");
    },
  }),

  defineTool({
    name: "pcp_start",
    description:
      "Manually start a concrete task (when there are several, prefer batch-loading with pcp_plan). " +
      "[Granularity] The title must be a concrete deliverable, doable in ≤2 hours, with an acceptance criterion. " +
      "Do not use this tool to create project goals or broad direction descriptions (e.g. 'build XX system'). " +
      "If a task is already active, it will prompt you to finish it first.",
    args: {
      title: z.string().describe("Sprint title"),
    },
    run({ title }, env) {
      const dir = env.dir;
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
        lines.push(``, `Use the \`pcp-plan-sprint\` skill to plan sprint work — decide whether to add them to this sprint, or just start working.`);
      }

      return lines.join("\n");
    },
  }),

  defineTool({
    name: "pcp_plan",
    description:
      "Load a list of planned tasks. The first task starts immediately (doing); the rest queue in order (ready). " +
      "If a task is already active, new tasks append to the end of the queue. " +
      "An entry may be a backlog id (e.g. 'B049') instead of a title: the pending item's title is used and the item is linked to the created task, so it stops being pending (passing the id inside a longer title does NOT link it — pass the id as its own entry). " +
      "When the user gives a todolist or plan document, parse it into an ordered task list before calling this tool. " +
      "[Task quality] Each task title must be concrete and verifiable: state the files/goal, expected result, or acceptance condition; avoid vague descriptions. " +
      "Example: 'src/fetcher.py: restrict china_ai sources + keyword allowlist (emit 3 matching samples)' beats 'improve source filtering'.",
    args: {
      tasks: z
        .array(z.string())
        .describe("Ordered list of task titles or backlog ids, e.g. ['implement login page', 'B049', 'wire up API']"),
    },
    run({ tasks }, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);

      const resolution = resolvePlanEntries(tasks, replayBacklog(dir));
      if (resolution.kind === "unknown-backlog") {
        return `❌ Backlog item ${resolution.id} not found`;
      }
      if (resolution.kind === "not-pending-backlog") {
        return `❌ ${resolution.id} is ${resolution.status} and cannot be planned`;
      }

      const allocation = decidePlan(stack, resolution.entries);
      if (allocation.kind === "empty") return "❌ Task list is empty";

      const created =
        allocation.kind === "enqueue"
          ? allocation.created
          : [allocation.first, ...allocation.rest];

      // planEvents also emits backlog_promote for entries that came from a backlog id, so
      // those items stop being pending (B100).
      for (const event of planEvents(created, Date.now())) {
        appendEvent(dir, event);
      }
      stack.next_id += created.length;

      if (allocation.kind === "enqueue") {
        // Active task exists → all new tasks append to ready queue
        const activeTask = getTask(replayEvents(dir), stack.active_task_id ?? "");
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
      stack.active_stack = [allocation.first.id];
      stack.active_task_id = allocation.first.id;
      stack.ready_tasks = [...stack.ready_tasks, ...allocation.rest];
      writeStack(dir, stack);

      appendWorklog(dir, `📋 Plan loaded ${created.length} task(s): ${created.map(t => t.id).join(", ")}`);
      const lines = [`📋 Plan loaded (${created.length} task(s)), awaiting confirmation:`];
      lines.push(`  📌 ${allocation.first.id}: ${allocation.first.title}`);
      for (const t of allocation.rest) {
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

  defineTool({
    name: "pcp_sub",
    description:
      "Start a subtask (pushed on top of the current task). After git commit it pops back to the main line.",
    args: {
      title: z.string().describe("Subtask title"),
    },
    run({ title }, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);

      const tasks = replayEvents(dir);
      const parentTitle = stack.active_task_id
        ? getTask(tasks, stack.active_task_id)?.title ?? stack.active_task_id
        : null;
      const decision = decideSubStart(stack, title, parentTitle);
      if (decision.kind === "no-active") {
        return "❌ No active main task; write some code to trigger auto-start first";
      }

      appendEvent(dir, {
        e: "resume_set",
        id: decision.parentId,
        prompt: decision.resumePrompt,
        ts: Date.now(),
      });
      appendEvent(dir, { e: "sub", id: decision.newId, parent: decision.parentId, title, ts: Date.now() });

      stack.active_stack.push(decision.newId);
      stack.active_task_id = decision.newId;
      stack.next_id++;
      writeStack(dir, stack);

      return `✅ Subtask [${decision.newId}] started: ${title}\n\nAfter git commit it returns to the main line automatically`;
    },
  }),

  // PCP_RENAME_FIX (forked locally; not re-downloaded):
  defineTool({
    name: "pcp_rename",
    description:
      "Rename a task. Defaults to the active task; pass `id` to rename another (e.g. a " +
      "mis-named auto-created task). The new title is required and must be non-empty.",
    args: {
      id: z
        .string()
        .optional()
        .describe("Optional: task id to rename (defaults to the active task)"),
      title: z.string().describe("New task title"),
    },
    run({ id, title }, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);
      const tasks = replayEvents(dir);

      const decision = decideRename(tasks, id ?? null, stack.active_task_id, title);
      const { event, message } = renameOutcome(decision);
      if (event) appendEvent(dir, { ...event, ts: Date.now() });

      return message;
    },
  }),

  defineTool({
    name: "pcp_done",
    description:
      "Complete the current task. Call this before the closing commit: it writes the PCP state, " +
      "so you can stage .opencode/pcp in that same commit (one commit per task). A git commit " +
      "with a `PCP-Task` trailer also closes the active task, as a fallback. If the queue has a " +
      "next task it advances automatically; when all are done it prompts for a new plan.",
    args: {},
    run(_args, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);

      if (!stack.active_task_id) return noActiveTask();

      const doneId = stack.active_task_id;
      const tasks = replayEvents(dir);
      const doneTask = getTask(tasks, doneId);

      // A task that recorded work on a file it changed has not finished: closing it
      // would leave the code as it is and the queue looking like the work is planned.
      const events = readEventLog(dir);
      const deferred = unrecordedDeferrals(
        itemsCreatedSince(events, taskStartedAt(events, doneId)),
        changedPaths(dir),
      );
      if (deferred.length > 0) {
        return [
          "✖ pcp_done refused: this task recorded work on files it changed.",
          ...deferred.flatMap((item) => [
            `    [${item.id}] ${item.title}`,
            ...item.paths.map((file) => `        ${file}`),
          ]),
          "",
          "Finish it in this task. If it genuinely cannot be finished now, the item must",
          "carry a recorded reason: dismiss this entry and capture it again with",
          "defer_reason. Nothing was closed and no state was written.",
        ].join("\n");
      }

      appendEvent(dir, { e: "done", id: doneId, ts: Date.now() });
      appendWorklog(dir, `✅ [${doneId}] ${doneTask?.title ?? doneId}`);

      const decision = decideTaskDone(stack);
      stack.active_stack.pop();

      // Subtask done → return to parent
      if (decision.kind === "sub-return") {
        stack.active_task_id = decision.parentId;
        writeStack(dir, stack);

        const parentTask = getTask(tasks, decision.parentId);
        if (parentTask) {
          return `Subtask [${doneTask?.title ?? doneId}] complete.\nContinue the main task: ${parentTask.title}.`;
        }
        return `✅ [${doneId}] complete; back to [${decision.parentId}]`;
      }

      // Main task done → auto-advance from the ready queue
      if (decision.kind === "advance") {
        const next = stack.ready_tasks.shift()!;
        stack.active_stack = [next.id];
        stack.active_task_id = next.id;
        writeStack(dir, stack);

        const lines = [
          `✅ [${doneId}] ${doneTask?.title ?? ""} complete!`,
          ``,
          `⏭️ Auto-advancing → [${next.id}] ${next.title}`,
        ];
        if (decision.remaining > 0) {
          lines.push(`   (${decision.remaining} more task(s) queued)`);
        } else {
          lines.push(`   (this is the last planned task)`);
        }
        return lines.join("\n");
      }

      // All tasks done
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

  defineTool({
    name: "pcp_pivot",
    description:
      "When a better direction appears mid-way, abandon the current task and record why. " +
      "Unlike pcp_done, pivot means the task was not completed but was superseded by a better approach, and the reason is kept in history. " +
      "When the user says \"originally / was going to ... now / changed to / found something better\", confirm before calling.",
    args: {
      reason: z.string().describe("Pivot reason, e.g. \"found that generating the press release directly is more efficient\""),
      new_task: z
        .string()
        .optional()
        .describe("Optional: title of a new task to start immediately"),
      drop_queue: z
        .boolean()
        .optional()
        .describe("Optional: also clear the remaining task queue (use when the whole plan changes; default false)"),
    },
    run({ reason, new_task, drop_queue = false }, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);

      const decision = decidePivot(stack, new_task);
      if (decision.kind === "no-active") return noActiveTask();

      const pivotId = decision.pivotId;
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

      if (decision.newId && new_task) {
        // Start new task immediately
        appendEvent(dir, { e: "created", id: decision.newId, type: "main", title: new_task, ts: Date.now() });
        stack.active_stack = [decision.newId];
        stack.active_task_id = decision.newId;
        stack.next_id++;
        writeStack(dir, stack);
        lines.push(``, `⏭️ New direction → [${decision.newId}] ${new_task}`);
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

  defineTool({
    name: "pcp_status",
    description:
      "View PCP state. `view: tasks` (default) shows the active stack, queue and a backlog " +
      "count; `view: backlog` lists pending backlog items; `view: history` lists completed " +
      "sprints, in-progress tasks, queue and the full backlog. `pcp_backlog` and " +
      "`pcp_history` remain as aliases.",
    args: {
      view: z
        .string()
        .optional()
        .describe("tasks (default) | backlog | history"),
      limit: z
        .number()
        .optional()
        .describe("For view: history — max completed sprints to show (default 20)"),
    },
    run({ view = "tasks", limit = 20 }, env) {
      const dir = env.dir;
      if (view === "backlog") return renderBacklog(getPendingBacklog(dir));
      if (view === "history") {
        return renderHistory(replayEvents(dir), readStack(dir), replayBacklog(dir), limit);
      }
      return renderTasks(
        readStack(dir),
        replayEvents(dir),
        readProjectContext(dir),
        getPendingBacklog(dir),
        lastEventSummary(readEventLog(dir)),
      );
    },
  }),

  defineTool({
    name: "pcp_handoff",
    description:
      "Generate HANDOFF.md in the project root, on demand, for AI tools without shared memory (ChatGPT, Claude Code, OpenCode, etc.). " +
      "Content comes from PCP's current tasks, queue, backlog, PROJECT.md, and WORKLOG.md.",
    args: {
      audience: z
        .string()
        .optional()
        .describe("Optional: the tool or audience taking over, e.g. Claude Code / ChatGPT"),
      focus: z
        .string()
        .optional()
        .describe("Optional: this handoff's focus, e.g. \"continue fixing the handoff tests\""),
      include_backlog: z
        .boolean()
        .optional()
        .describe("Whether to include pending backlog items; default true"),
    },
    run({ audience, focus, include_backlog = true }, env) {
      const dir = env.dir;
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

  defineTool({
    name: "pcp_capture",
    description:
      "Record a temporary idea or requirement to the backlog without executing it now. " +
      "Call immediately when the user says \"do X later\", \"also add X\", \"want to do X someday\", or \"note X\". " +
      "Plan sprint work together at sprint end via the pcp-plan-sprint skill. " +
      "Refused when the item names a file the active task already changed, unless defer_reason explains why that work cannot be finished now.",
    args: {
      title: z.string().describe("Requirement or idea title"),
      detail: z.string().optional().describe("Optional: additional notes"),
      defer_reason: z
        .string()
        .optional()
        .describe(
          "Only for work on a file the active task already changed: what genuinely prevents finishing it now. Recorded with the item.",
        ),
    },
    run({ title, detail, defer_reason }, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);

      const named = touchedPathsNamed(`${title}\n${detail ?? ""}`, changedPaths(dir));
      if (named.length > 0 && (defer_reason ?? "").trim() === "") {
        return [
          "✖ pcp_capture refused: this names a file the active task has already changed.",
          ...named.map((file) => `    ${file}`),
          "",
          "A finding in code this task opened belongs to this task: fix it now, or pass",
          "defer_reason naming what genuinely prevents it. Nothing was recorded.",
          "Capturing it is not scheduling it — the code would stay as this task left it.",
        ].join("\n");
      }

      const id = `B${String(stack.backlog_next_id).padStart(3, "0")}`;

      appendEvent(dir, { e: "backlog_add", id, title, detail, reason: defer_reason, ts: Date.now() });
      stack.backlog_next_id++;
      writeStack(dir, stack);

      return `📝 Logged to backlog: [${id}] ${title}\nThe current sprint continues; review at sprint end.`;
    },
  }),

  defineTool({
    name: "pcp_backlog",
    description: "View all pending items in the backlog. Alias for pcp_status with view: backlog.",
    args: {},
    run(_args, env) {
      return renderBacklog(getPendingBacklog(env.dir));
    },
  }),

  defineTool({
    name: "pcp_promote",
    description:
      "Add a backlog item to the current sprint. It is appended to the ready queue and " +
      "runs in FIFO order after the active task. Used during sprint planning.",
    args: {
      backlog_id: z.string().describe("Backlog item ID (e.g. B001)"),
      title: z.string().optional().describe("Optional: override the task title"),
    },
    run({ backlog_id, title }, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);

      // PCP_PROMOTE_ENQUEUE_FIX: append the promoted item to the sprint queue
      // instead of nesting it on the active stack. Nesting reversed repeated
      // promotions (LIFO, B074/T135) and forced a refusal while a subtask was
      // active. Enqueuing preserves FIFO order and works at any depth.
      const decision = decidePromote(stack);
      if (decision.kind === "no-sprint") {
        return noActiveSprint();
      }

      const action = decideBacklogAction(replayBacklog(dir), backlog_id);
      if (action.kind === "unknown") return `❌ Backlog item ${backlog_id} not found`;
      if (action.kind === "not-pending") {
        return `❌ ${backlog_id} is ${action.status} and cannot be added`;
      }

      const taskTitle = title || action.item.title;
      const id = `T${String(stack.next_id).padStart(3, "0")}`;

      appendEvent(dir, { e: "created", id, type: "main", title: taskTitle, ts: Date.now() });
      appendEvent(dir, { e: "backlog_promote", backlog_id, task_id: id, ts: Date.now() });

      stack.ready_tasks.push({ id, title: taskTitle });
      stack.next_id++;
      writeStack(dir, stack);

      return `✅ [${backlog_id}] queued as [${id}]: ${taskTitle} (runs after the active task [${decision.activeId}])`;
    },
  }),

  defineTool({
    name: "pcp_reorder",
    description:
      "Reorder a ready (queued) task so a blocking item can jump the strict FIFO queue. " +
      "Pass exactly one anchor: `top`, `position` (1-based), `before` <id>, or `after` <id>. " +
      "Only the ready queue changes; the active task and backlog are untouched.",
    args: {
      id: z.string().describe("Ready task id to move (e.g. T155)"),
      top: z.boolean().optional().describe("Move to the head of the queue"),
      position: z.number().optional().describe("1-based target position"),
      before: z.string().optional().describe("Move directly before this ready task id"),
      after: z.string().optional().describe("Move directly after this ready task id"),
    },
    run(args, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);
      return runReorder(stack, args, {
        writeOrder: (order) => {
          stack.ready_tasks = order;
          writeStack(dir, stack);
        },
        log: (message) => appendWorklog(dir, message),
      });
    },
  }),

  defineTool({
    name: "pcp_swap",
    description:
      "Pause the active main task and promote a queued task in its place. The paused task " +
      "moves to the head of the queue. Only allowed when a main task (not a subtask) is active.",
    args: { id: z.string().describe("Queued task id to promote into the active slot") },
    run({ id }, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);
      const activeTitle = stack.active_task_id
        ? getTask(replayEvents(dir), stack.active_task_id)?.title ?? stack.active_task_id
        : null;

      const decision = decideSwap(stack, id, activeTitle);
      if (decision.kind === "no-sprint") return noActiveSprint();
      if (decision.kind === "nested") {
        return "❌ Cannot swap while a subtask is active; complete the subtask first.";
      }
      if (decision.kind === "unknown-task") return noReadyTask(decision.id);
      if (decision.kind === "same-task") return `❌ [${id}] is already the active task.`;

      const pausedId = stack.active_task_id ?? "";
      stack.active_task_id = decision.newActive.id;
      stack.active_stack = [decision.newActive.id];
      stack.ready_tasks = decision.order;
      writeStack(dir, stack);
      appendWorklog(dir, `🔁 Swapped [${pausedId}] (paused) with [${decision.newActive.id}]`);

      return `🔁 [${decision.newActive.id}] is now active; [${pausedId}] paused at the head of the queue.`;
    },
  }),

  defineTool({
    name: "pcp_demote",
    description:
      "Remove a queued task from the sprint and return its backlog item to pending. " +
      "Cannot demote the active task (use pcp_done or pcp_swap).",
    args: { id: z.string().describe("Queued task id to demote") },
    run({ id }, env) {
      const dir = env.dir;
      ensureDir(dir);
      const stack = readStack(dir);

      const decision = decideDemote(stack, id);
      if (decision.kind === "no-sprint") return noActiveSprint();
      if (decision.kind === "unknown-task") return noReadyTask(decision.id);
      if (decision.kind === "active") {
        return `❌ [${id}] is the active task; use pcp_done or pcp_swap instead.`;
      }

      stack.ready_tasks = decision.order;
      writeStack(dir, stack);

      // Return the originating backlog item to pending, if this task came from one.
      const item = replayBacklog(dir).find((b) => b.promoted_to === id);
      if (item) {
        appendEvent(dir, { e: "backlog_demote", backlog_id: item.id, ts: Date.now() });
        appendWorklog(dir, `↩️ Demoted [${id}] back to backlog [${item.id}]`);
        return `↩️ [${id}] removed from the queue; backlog [${item.id}] is pending again.`;
      }

      appendWorklog(dir, `↩️ Demoted [${id}] (removed from the queue)`);
      return `↩️ [${id}] removed from the queue.`;
    },
  }),

  defineTool({
    name: "pcp_dismiss",
    description: "Dismiss a backlog item (not doing it this time, and stop reminding).",
    args: {
      backlog_id: z.string().describe("Backlog item ID (e.g. B001)"),
    },
    run({ backlog_id }, env) {
      const dir = env.dir;
      ensureDir(dir);

      const action = decideBacklogAction(replayBacklog(dir), backlog_id);
      if (action.kind === "unknown") return `❌ Backlog item ${backlog_id} not found`;
      if (action.kind === "not-pending") return `ℹ️ ${backlog_id} is already ${action.status}`;

      appendEvent(dir, { e: "backlog_dismiss", backlog_id, ts: Date.now() });
      return `❌ [${backlog_id}] dismissed: ${action.item.title}`;
    },
  }),

  defineTool({
    name: "pcp_backlog_done",
    description:
      "Mark a backlog item done when it was completed outside pcp_promote (e.g. an ad-hoc " +
      "detour). Unlike pcp_dismiss, this records that the item was actually delivered.",
    args: {
      backlog_id: z.string().describe("Backlog item ID (e.g. B001)"),
    },
    run({ backlog_id }, env) {
      const dir = env.dir;
      ensureDir(dir);

      const action = decideBacklogAction(replayBacklog(dir), backlog_id);
      if (action.kind === "unknown") return `❌ Backlog item ${backlog_id} not found`;
      if (action.kind === "not-pending") return `ℹ️ ${backlog_id} is already ${action.status}`;

      appendEvent(dir, { e: "backlog_done", backlog_id, ts: Date.now() });
      return `✅ [${backlog_id}] marked done: ${action.item.title}`;
    },
  }),

  defineTool({
    name: "pcp_history",
    description:
      "View all historical sprints (completed + in progress) and the full backlog record. " +
      "Alias for pcp_status with view: history.",
    args: {
      limit: z
        .number()
        .optional()
        .describe("Maximum completed sprints to show (default 20)"),
    },
    run({ limit = 20 }, env) {
      const dir = env.dir;
      return renderHistory(replayEvents(dir), readStack(dir), replayBacklog(dir), limit);
    },
  }),
];
