import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
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

// ──────────────────────────────────────────────
// Tool name classifiers
// ──────────────────────────────────────────────

const WRITE_PATTERNS = ["write", "edit", "patch", "create", "apply", "bash", "shell", "exec", "run"];
const BASH_PATTERNS  = ["bash", "shell", "exec", "run", "terminal"];

function isWriteTool(name: string): boolean {
  const n = name.toLowerCase();
  return WRITE_PATTERNS.some((p) => n.includes(p));
}

function isBashTool(name: string): boolean {
  const n = name.toLowerCase();
  return BASH_PATTERNS.some((p) => n.includes(p));
}

// ──────────────────────────────────────────────
// Context builders (token budget: ≤3 / ≤5 lines)
// ──────────────────────────────────────────────

// PCP behavioral rule — always injected to ALL agents via system.transform
const PCP_RULE = `[PCP规则] 任务语言：跟随用户沟通语言(用户说中文→中文任务,说English→English tasks); 任务粒度：每个Task=具体可交付物(≤2h,有完成标准),禁止创建项目目标/Sprint容器类大任务; pcp_sub仅用于临时绕行(做完立即返回),禁止用pcp_sub执行队列中的Task; 【完成审查】任务完成时如有产出文件→列出清单问"需要审查吗？"→需要则按类型展示(.md→pandoc转PDF给路径,.json→格式化关键字段,.txt→短文件直接贴/长文件摘要,代码→git diff关键变更)→确认后再pcp_done,不需要则直接pcp_done; "以后/顺便/记一下X"→pcp_capture; 收到todolist/计划→先扫描项目已有代码和产出文件,已完成的工作不建任务→pcp_plan(tasks)加载后展示清单等用户确认再执行; "本来/原本/改成/发现更好"→确认是否pcp_pivot; 无任务→引导做plan`;

function buildShortContext(
  stack: Stack,
  tasks: Task[],
  projectCtx: string | null,
  pendingBacklogCount: number,
): string {
  const lines: string[] = [PCP_RULE];
  const readyCount = stack.ready_tasks.length;

  if (stack.active_task_id) {
    const active = getTask(tasks, stack.active_task_id);
    if (active) {
      if (stack.active_stack.length === 1) {
        lines.push(`📌 主线: ${active.title} [${active.id}]`);
      } else {
        const mainTask = getTask(tasks, stack.active_stack[0]);
        if (mainTask) lines.push(`📌 主线: ${mainTask.title} [${mainTask.id}]`);
        lines.push(`⤷ 当前: ${active.title} [${active.id}] (子任务) — git commit 后返回主线`);
      }
    }
    if (readyCount > 0) lines.push(`⏳ 队列: ${readyCount} 个任务待执行`);
  } else {
    if (projectCtx) lines.push(`[项目] ${projectCtx.slice(0, 60)}`);
    if (pendingBacklogCount > 0) {
      lines.push(`📋 Backlog: ${pendingBacklogCount} 项待回顾 — pcp_backlog 查看`);
    }
    lines.push(`💡 无任务 — 建议做plan后pcp_plan加载`);
  }

  return lines.slice(0, 5).join("\n");
}

function buildResumeContext(
  stack: Stack,
  tasks: Task[],
  projectCtx: string | null,
  pendingBacklogCount: number,
  dir?: string,
): string {
  const lines: string[] = [];

  if (projectCtx) {
    lines.push(`[项目] ${projectCtx.slice(0, 80)}`);
  }

  // Inject PROJECT.md "现状" section if available
  if (dir) {
    const projectMd = readProjectMd(dir);
    if (projectMd) {
      const statusMatch = projectMd.match(/## 现状\n([\s\S]*?)(?=\n## |---|\n*$)/);
      if (statusMatch?.[1]?.trim() && !statusMatch[1].includes("pcp_init 自动生成")) {
        lines.push(`[现状] ${statusMatch[1].trim().slice(0, 150)}`);
      }
    }
  }

  if (stack.active_task_id) {
    lines.push("当前任务栈：");
    for (let i = 0; i < Math.min(stack.active_stack.length, 3); i++) {
      const id = stack.active_stack[i];
      const task = getTask(tasks, id);
      const isCurrent = id === stack.active_task_id;
      const prefix = i === 0 ? "[主]" : "[子]";
      lines.push(
        `  ${prefix} ${id} ${task?.title ?? id}${isCurrent ? "  ← 当前" : ""}`,
      );
    }
  }

  if (stack.ready_tasks.length > 0) {
    lines.push(`⏳ 队列: ${stack.ready_tasks.map(t => `${t.id}:${t.title}`).join(", ")}`);
  }

  if (pendingBacklogCount > 0) {
    lines.push(`📋 Backlog: ${pendingBacklogCount} 项待回顾`);
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
    return "未命名任务";
  }

  // ── Auto-lifecycle internals ─────────────────

  function autoCreateTask(dir: string, title: string): void {
    ensureDir(dir);
    const stack = readStack(dir);
    if (stack.active_task_id) return;

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

  function autoDoneTask(dir: string): void {
    const stack = readStack(dir);
    if (!stack.active_task_id) return;

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
          "扫描项目（README、package.json、入口文件等），建立项目基线上下文。" +
          "首次在现有项目中使用 PCP 时调用一次。之后每次会话都会自动注入此上下文。",
        args: {
          extra: tool.schema
            .string()
            .optional()
            .describe(
              "可选：补充说明（已完成的功能、当前里程碑等），追加到自动扫描结果后",
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
          appendWorklog(dir, `📦 pcp_init: 项目基线已建立`);

          const lines = [
            `✅ PCP 项目基线已建立`,
            ``,
            `📦 项目摘要：${full}`,
          ];
          if (detail) {
            lines.push(``, `扫描详情：`, ...detail.split("\n").map((l) => `  ${l}`));
          }
          lines.push(
            ``,
            `📝 已生成 .opencode/pcp/PROJECT.md — 建议补充"现状"部分`,
            `🌐 浏览器预览：.opencode/pcp/PROJECT.html`,
            `📝 已初始化 .opencode/pcp/WORKLOG.md — 后续操作自动记录`,
            ``,
            `此上下文将在每次对话和 compaction 时自动注入。`,
            `如需更新可再次调用 pcp_init。`,
          );

          return lines.join("\n");
        },
      }),

      pcp_start: tool({
        description:
          "手动开始一个具体任务（有多个任务时优先用 pcp_plan 批量加载）。" +
          "【任务粒度要求】标题必须是具体可交付物，≤2小时可完成，含验收标准。" +
          "禁止用此工具创建项目目标或大方向描述（如'开发XX系统'）。" +
          "若当前已有任务进行中，会提示先完成当前任务。",
        args: {
          title: tool.schema.string().describe("Sprint 标题"),
        },
        async execute({ title }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          // Guard: block if sprint already active
          if (stack.active_task_id) {
            const tasks = replayEvents(dir);
            const active = getTask(tasks, stack.active_task_id);
            return [
              `⚠️ Sprint [${stack.active_task_id}: ${active?.title ?? ""}] 还在进行中。`,
              ``,
              `请先结束当前 sprint：`,
              `  1. git commit 当前改动（会自动关闭 sprint）`,
              `  2. 然后重新调用 pcp_start 开始「${title}」`,
            ].join("\n");
          }

          // Start new sprint
          const id = `T${String(stack.next_id).padStart(3, "0")}`;
          appendEvent(dir, { e: "created", id, type: "main", title, ts: Date.now() });
          stack.active_stack = [id];
          stack.active_task_id = id;
          stack.next_id++;
          writeStack(dir, stack);

          const lines = [`✅ Sprint [${id}] 开始：${title}`];

          // Surface backlog items
          const pending = getPendingBacklog(dir);
          if (pending.length > 0) {
            lines.push(``, `📋 Backlog 中有 ${pending.length} 项待回顾：`);
            for (const item of pending) {
              lines.push(`  ${item.id}: ${item.title}`);
            }
            lines.push(``, `调用 skill \`pcp-sprint-review\` 决定是否加入本次 sprint，或直接开始工作。`);
          }

          return lines.join("\n");
        },
      }),

      pcp_plan: tool({
        description:
          "加载计划任务列表。第一个任务立即开始（doing），其余按顺序排队（ready）。" +
          "如果当前有任务在执行，新任务追加到队列末尾。" +
          "用户给出 todolist 或计划文档时，先解析为有序任务列表再调用此工具。" +
          "【任务质量标准】每个任务标题应具体可验证：含改动文件/目标、预期结果或验收条件，避免泛化描述。" +
          "例：'src/fetcher.py: 为 china_ai 限定信源列表+关键词白名单（输出匹配样本3条）' 优于 '优化信源过滤'。",
        args: {
          tasks: tool.schema
            .array(tool.schema.string())
            .describe("有序任务标题列表，如 ['实现登录页', '添加表单验证', '对接API']"),
        },
        async execute({ tasks }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (tasks.length === 0) return "❌ 任务列表为空";

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
              `📋 ${created.length} 个任务已加入队列（待确认）：`,
              ...created.map((t) => `  ⏳ ${t.id}: ${t.title}`),
              ``,
              `⚠️  当前主线任务仍在进行：${activeTask?.title ?? stack.active_task_id}`,
              `👉 建议：先调用 pcp_done 关闭当前任务，队列将自动推进；`,
              `   或继续完成当前任务后让队列自然推进。`,
              `   【不要】用 pcp_sub 手动重复执行队列中的任务。`,
            ].join("\n");
          }

          // No active task → first = doing, rest = ready
          const [first, ...rest] = created;
          stack.active_stack = [first.id];
          stack.active_task_id = first.id;
          stack.ready_tasks = [...stack.ready_tasks, ...rest];
          writeStack(dir, stack);

          appendWorklog(dir, `📋 Plan 加载 ${created.length} 个任务: ${created.map(t => t.id).join(", ")}`);
          const lines = [`📋 Plan 已加载（${created.length} 个任务），待确认：`];
          lines.push(`  📌 ${first.id}: ${first.title}`);
          for (const t of rest) {
            lines.push(`  ⏳ ${t.id}: ${t.title}`);
          }

          const pending = getPendingBacklog(dir);
          if (pending.length > 0) {
            lines.push(``, `📋 Backlog 中有 ${pending.length} 项待回顾 — pcp_backlog 查看`);
          }

          lines.push(``, `⏸ 确认开始执行？可在这里调整任务描述后回复"确认"。`);

          return lines.join("\n");
        },
      }),

      pcp_sub: tool({
        description:
          "开始一个子任务（压栈到当前任务之上）。git commit 后自动弹回主线。",
        args: {
          title: tool.schema.string().describe("子任务标题"),
        },
        async execute({ title }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (!stack.active_task_id) {
            return "❌ 没有进行中的主任务，请先写一些代码触发自动开始";
          }

          const parentId = stack.active_task_id;
          const id = `T${String(stack.next_id).padStart(3, "0")}`;

          const tasks = replayEvents(dir);
          const parentTitle = getTask(tasks, parentId)?.title ?? parentId;
          const resumePrompt = `准备进入子任务【${title}】，完成后继续主任务：${parentTitle}。`;

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

          return `✅ 子任务 [${id}] 已开始：${title}\n\ngit commit 后自动返回主线`;
        },
      }),

      pcp_done: tool({
        description:
          "手动完成当前任务（git commit 会自动触发，仅在需要手动完成时使用）。" +
          "如果队列中有下一个任务会自动推进，全部完成时提示做新 plan。",
        args: {},
        async execute(_args, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (!stack.active_task_id) return "❌ 没有进行中的任务";

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
              return `子任务【${doneTask?.title ?? doneId}】已完成。\n继续主任务：${parentTask.title}。`;
            }
            return `✅ [${doneId}] 已完成，返回 [${parentId}]`;
          }

          // Case 2: main task done → try auto-advance from ready queue
          if (stack.ready_tasks.length > 0) {
            const next = stack.ready_tasks.shift()!;
            stack.active_stack = [next.id];
            stack.active_task_id = next.id;
            writeStack(dir, stack);

            const remaining = stack.ready_tasks.length;
            const lines = [
              `✅ [${doneId}] ${doneTask?.title ?? ""} 完成！`,
              ``,
              `⏭️ 自动推进 → [${next.id}] ${next.title}`,
            ];
            if (remaining > 0) {
              lines.push(`   (还有 ${remaining} 个任务排队)`);
            } else {
              lines.push(`   (这是最后一个计划任务)`);
            }
            return lines.join("\n");
          }

          // Case 3: all tasks done
          stack.active_task_id = null;
          writeStack(dir, stack);

          const pending = getPendingBacklog(dir);
          const lines = [`🎉 所有计划任务已完成！`];
          if (pending.length > 0) {
            lines.push(
              ``,
              `📋 Backlog 中有 ${pending.length} 项待回顾：`,
              ...pending.map((item) => `  ${item.id}: ${item.title}`),
            );
          }
          lines.push(``, `💡 建议：让 planner 规划下一轮任务，然后 pcp_plan 加载。`);
          return lines.join("\n");
        },
      }),

      pcp_pivot: tool({
        description:
          "中途发现更好的方向时，放弃当前任务并记录原因。" +
          "与 pcp_done 不同：pivot 表示任务未完成但被更好的方案取代，历史中会保留原因。" +
          "检测到用户说「本来/原本/我们是要...现在/改成/发现更好」时，先确认再调用。",
        args: {
          reason: tool.schema.string().describe("pivot 原因，如「发现直接生成新闻稿更高效」"),
          new_task: tool.schema
            .string()
            .optional()
            .describe("可选：立即开始的新任务标题"),
          drop_queue: tool.schema
            .boolean()
            .optional()
            .describe("可选：是否同时清空后续任务队列（整个计划都要变时用，默认 false）"),
        },
        async execute({ reason, new_task, drop_queue = false }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (!stack.active_task_id) return "❌ 没有进行中的任务";

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
            `   原因: ${reason}`,
          ];

          if (droppedQueue.length > 0) {
            lines.push(`   已清空队列 ${droppedQueue.length} 个任务`);
          }

          if (new_task) {
            // Start new task immediately
            const id = `T${String(stack.next_id).padStart(3, "0")}`;
            appendEvent(dir, { e: "created", id, type: "main", title: new_task, ts: Date.now() });
            stack.active_stack = [id];
            stack.active_task_id = id;
            stack.next_id++;
            writeStack(dir, stack);
            lines.push(``, `⏭️ 新方向 → [${id}] ${new_task}`);
            if (stack.ready_tasks.length > 0) {
              lines.push(`   (队列还有 ${stack.ready_tasks.length} 个任务)`);
            }
          } else {
            stack.active_task_id =
              stack.active_stack.length > 0
                ? stack.active_stack[stack.active_stack.length - 1]
                : null;
            writeStack(dir, stack);
            lines.push(``, `💡 调用 pcp_start 或 pcp_plan 开始新方向。`);
          }

          return lines.join("\n");
        },
      }),

      pcp_status: tool({
        description: "查看当前任务栈、队列、项目基线和 backlog 状态。",
        args: {},
        async execute(_args, context) {
          const dir = context.directory;
          const stack = readStack(dir);
          const projectCtx = readProjectContext(dir);
          const lines: string[] = [];

          if (projectCtx) lines.push(`[项目] ${projectCtx}`);

          if (!stack.active_task_id) {
            lines.push("当前没有进行中的任务。");
            if (stack.ready_tasks.length > 0) {
              lines.push(`\n⏳ 队列中有 ${stack.ready_tasks.length} 个任务待执行：`);
              for (const t of stack.ready_tasks) {
                lines.push(`  ${t.id}: ${t.title}`);
              }
            }
            const pending = getPendingBacklog(dir);
            if (pending.length > 0) {
              lines.push(`📋 Backlog 中有 ${pending.length} 项待回顾，调用 pcp_backlog 查看。`);
            }
            lines.push(`\n💡 建议：让 planner 规划任务，然后 pcp_plan 加载。`);
            return lines.join("\n");
          }

          const tasks = replayEvents(dir);
          lines.push("当前任务栈：");

          for (let i = 0; i < stack.active_stack.length; i++) {
            const id = stack.active_stack[i];
            const task = getTask(tasks, id);
            const isCurrent = id === stack.active_task_id;
            const prefix = i === 0 ? "[主]" : "[子]";
            lines.push(
              `  ${prefix} ${id} ${task?.title ?? id}${isCurrent ? "  ← 当前" : ""}`,
            );
          }

          if (stack.ready_tasks.length > 0) {
            lines.push(`\n⏳ 队列（${stack.ready_tasks.length} 个）：`);
            for (const t of stack.ready_tasks) {
              lines.push(`  ${t.id}: ${t.title}`);
            }
          }

          const pending = getPendingBacklog(dir);
          if (pending.length > 0) {
            lines.push(`📋 Backlog: ${pending.length} 项待回顾`);
          }

          return lines.join("\n");
        },
      }),

      pcp_handoff: tool({
        description:
          "按需生成交接文档 HANDOFF.md，供 ChatGPT、Claude Code、OpenCode 等无共享记忆的 AI 工具接力使用。" +
          "内容来自 PCP 当前任务、队列、backlog、PROJECT.md 和 WORKLOG.md。",
        args: {
          audience: tool.schema
            .string()
            .optional()
            .describe("可选：接手的工具或对象，如 Claude Code / ChatGPT"),
          focus: tool.schema
            .string()
            .optional()
            .describe("可选：本次交接重点，如“继续修复 handoff 测试”"),
          include_backlog: tool.schema
            .boolean()
            .optional()
            .describe("是否包含 backlog 待决项，默认 true"),
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
            `🤝 生成 HANDOFF.md${focus ? `（重点：${focus}）` : ""}`,
          );

          const preview = markdown
            .split("\n")
            .slice(0, 12)
            .join("\n");

          return [
            `🤝 已生成交接文档：${handoffPath}`,
            "",
            "用途：把当前 PCP 状态压缩成可直接交给下一个 AI 的上下文。",
            "内容：当前任务、进展、未完成项、backlog、最近事件、下一步建议。",
            "",
            "预览：",
            preview,
          ].join("\n");
        },
      }),

      // ── Backlog tools ───────────────────────────

      pcp_capture: tool({
        description:
          "记录临时想法或需求到 backlog，不立即执行。" +
          "当用户说「后续做X」「顺便加个X」「以后想做X」「记一下X」时立即调用。" +
          "sprint 结束时通过 pcp-sprint-review skill 统一回顾。",
        args: {
          title: tool.schema.string().describe("需求或想法标题"),
          detail: tool.schema.string().optional().describe("可选：补充说明"),
        },
        async execute({ title, detail }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);
          const id = `B${String(stack.backlog_next_id).padStart(3, "0")}`;

          appendEvent(dir, { e: "backlog_add", id, title, detail, ts: Date.now() });
          stack.backlog_next_id++;
          writeStack(dir, stack);

          return `📝 已记录到 backlog: [${id}] ${title}\n当前 sprint 继续，sprint 结束时回顾。`;
        },
      }),

      pcp_backlog: tool({
        description: "查看 backlog 中所有待处理的项目。",
        args: {},
        async execute(_args, context) {
          const dir = context.directory;
          const pending = getPendingBacklog(dir);

          if (pending.length === 0) return "📋 Backlog 为空。";

          const lines = [`📋 Backlog（${pending.length} 项）：`];
          for (const item of pending) {
            lines.push(`  ${item.id}: ${item.title}`);
            if (item.detail) lines.push(`       ${item.detail}`);
          }
          return lines.join("\n");
        },
      }),

      pcp_promote: tool({
        description:
          "将 backlog 中的项目加入当前 sprint 作为子任务。sprint 回顾时使用。",
        args: {
          backlog_id: tool.schema.string().describe("Backlog 项目 ID（如 B001）"),
          title: tool.schema.string().optional().describe("可选：覆盖子任务标题"),
        },
        async execute({ backlog_id, title }, context) {
          const dir = context.directory;
          ensureDir(dir);
          const stack = readStack(dir);

          if (!stack.active_task_id) {
            return `❌ 没有进行中的 sprint，请先 pcp_start 开始一个 sprint`;
          }

          const backlog = replayBacklog(dir);
          const item = backlog.find((b) => b.id === backlog_id);
          if (!item) return `❌ 找不到 backlog 项目 ${backlog_id}`;
          if (item.status !== "pending") return `❌ ${backlog_id} 状态为 ${item.status}，无法加入`;

          const taskTitle = title || item.title;
          const id = `T${String(stack.next_id).padStart(3, "0")}`;
          const parentId = stack.active_task_id;

          const tasks = replayEvents(dir);
          const parentTitle = getTask(tasks, parentId)?.title ?? parentId;
          const resumePrompt = `来自 backlog 的子任务【${taskTitle}】，完成后继续主线：${parentTitle}。`;

          appendEvent(dir, { e: "resume_set", id: parentId, prompt: resumePrompt, ts: Date.now() });
          appendEvent(dir, { e: "sub", id, parent: parentId, title: taskTitle, ts: Date.now() });
          appendEvent(dir, { e: "backlog_promote", backlog_id, task_id: id, ts: Date.now() });

          stack.active_stack.push(id);
          stack.active_task_id = id;
          stack.next_id++;
          writeStack(dir, stack);

          return `✅ [${backlog_id}] 已加入 sprint 作为子任务 [${id}]：${taskTitle}`;
        },
      }),

      pcp_dismiss: tool({
        description: "忽略 backlog 中的某项（本次不做，也不再提醒）。",
        args: {
          backlog_id: tool.schema.string().describe("Backlog 项目 ID（如 B001）"),
        },
        async execute({ backlog_id }, context) {
          const dir = context.directory;
          ensureDir(dir);

          const backlog = replayBacklog(dir);
          const item = backlog.find((b) => b.id === backlog_id);
          if (!item) return `❌ 找不到 backlog 项目 ${backlog_id}`;
          if (item.status !== "pending") return `ℹ️ ${backlog_id} 已是 ${item.status} 状态`;

          appendEvent(dir, { e: "backlog_dismiss", backlog_id, ts: Date.now() });
          return `❌ [${backlog_id}] 已忽略：${item.title}`;
        },
      }),

      pcp_history: tool({
        description: "查看所有历史 sprint（已完成 + 进行中）和 backlog 全记录。",
        args: {
          limit: tool.schema
            .number()
            .optional()
            .describe("最多显示已完成 sprint 数（默认 20）"),
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
            lines.push("=== 已完成 Sprint ===");
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
            lines.push("\n=== 进行中 ===");
            for (let i = 0; i < stack.active_stack.length; i++) {
              const id = stack.active_stack[i];
              const t = getTask(tasks, id);
              const isCurrent = id === stack.active_task_id;
              const prefix = i === 0 ? "[主]" : "[子]";
              lines.push(
                `  📌 ${prefix} ${id}  ${t?.title ?? id}${isCurrent ? "  ← 当前" : ""}`,
              );
            }
          }

          // Ready queue
          if (stack.ready_tasks.length > 0) {
            lines.push("\n=== 队列 ===");
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
                item.status === "promoted" ? "✅" : "❌";
              const suffix =
                item.status === "promoted" ? ` → 已加入 ${item.promoted_to}` :
                item.status === "dismissed" ? " (已忽略)" : "";
              lines.push(`  ${icon} ${item.id}  ${item.title}${suffix}`);
            }
          }

          if (lines.length === 0) return "暂无记录。";
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
        autoDoneTask(dir);
      } catch {
        // silent
      }
    },

    // ── Context injection hooks ─────────────────

    "experimental.chat.system.transform": async (input, output) => {
      try {
        const dir = input.sessionID
          ? await getSessionDir(input.sessionID)
          : directory;
        const stack = readStack(dir);
        const tasks = replayEvents(dir);
        const projectCtx = readProjectContext(dir);
        const pendingCount = getPendingBacklog(dir).length;
        const ctx = buildShortContext(stack, tasks, projectCtx, pendingCount);
        if (ctx) output.system.push(ctx);
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
