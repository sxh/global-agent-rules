import * as fs from "node:fs";
import * as path from "node:path";

export interface Stack {
  next_id: number;
  backlog_next_id: number;
  active_stack: string[];
  active_task_id: string | null;
  ready_tasks: { id: string; title: string }[];
}

export interface PcpEvent {
  e:
    | "created"
    | "sub"
    | "done"
    | "pivoted"
    | "resume_set"
    | "project_context"
    | "backlog_add"
    | "backlog_promote"
    | "backlog_dismiss";
  id?: string;
  type?: "main" | "sub";
  title?: string;
  parent?: string;
  prompt?: string;
  summary?: string;
  detail?: string;
  reason?: string;
  backlog_id?: string;
  task_id?: string;
  ts: number;
}

export interface Task {
  id: string;
  type: "main" | "sub";
  title: string;
  parent?: string;
  done: boolean;
  resume_prompt?: string;
  pivoted?: boolean;
  pivot_reason?: string;
}

export interface BacklogItem {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "promoted" | "dismissed";
  promoted_to?: string;
}

export interface ProjectData {
  name: string;
  summary: string;
  detail: string | null;
  extra: string | null;
  key_files: string[];
  status: string | null;
  updated_at: string;
}

export interface HandoffOptions {
  audience?: string;
  focus?: string;
  include_backlog?: boolean;
  max_recent_events?: number;
  max_worklog_entries?: number;
}

export function pcpDir(dir: string): string {
  return path.join(dir, ".opencode", "pcp");
}

export function ensureDir(dir: string): void {
  const d = pcpDir(dir);
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function readStack(dir: string): Stack {
  const p = path.join(pcpDir(dir), "stack.json");
  if (!fs.existsSync(p)) {
    return { next_id: 1, backlog_next_id: 1, active_stack: [], active_task_id: null, ready_tasks: [] };
  }
  try {
    const s = JSON.parse(fs.readFileSync(p, "utf8")) as Stack;
    if (s.backlog_next_id === undefined) s.backlog_next_id = 1;
    if (s.ready_tasks === undefined) s.ready_tasks = [];
    return s;
  } catch {
    return { next_id: 1, backlog_next_id: 1, active_stack: [], active_task_id: null, ready_tasks: [] };
  }
}

export function writeStack(dir: string, s: Stack): void {
  fs.writeFileSync(
    path.join(pcpDir(dir), "stack.json"),
    JSON.stringify(s, null, 2),
  );
}

export function appendEvent(dir: string, event: PcpEvent): void {
  fs.appendFileSync(
    path.join(pcpDir(dir), "events.jsonl"),
    JSON.stringify(event) + "\n",
  );
}

export function mdToHtml(md: string, title: string): string {
  const body = md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/\n{2,}/g, "<br><br>")
    .replace(/---/g, "<hr>");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6}
h1{border-bottom:2px solid #e1e4e8;padding-bottom:8px}h2{color:#24292f;margin-top:24px}
code{background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:0.9em}
li{margin:4px 0}blockquote{border-left:4px solid #dfe2e5;margin:0;padding:0 16px;color:#57606a}
hr{border:none;border-top:1px solid #d0d7de;margin:24px 0}
ul{padding-left:20px}</style></head><body>${body}</body></html>`;
}

export function writeHtml(dir: string, name: string, md: string, title: string): void {
  fs.writeFileSync(path.join(pcpDir(dir), name), mdToHtml(md, title));
}

export function appendWorklog(dir: string, line: string): void {
  const p = path.join(pcpDir(dir), "WORKLOG.md");
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
  const header = "# PCP Worklog\n\n";
  if (!fs.existsSync(p)) fs.writeFileSync(p, header);
  fs.appendFileSync(p, `- ${ts} ${line}\n`);
  writeHtml(dir, "WORKLOG.html", fs.readFileSync(p, "utf8"), "PCP Worklog");
}

export function writeProjectFiles(dir: string, data: ProjectData): void {
  fs.writeFileSync(
    path.join(pcpDir(dir), "PROJECT.json"),
    JSON.stringify(data, null, 2),
  );

  const lines = [`# ${data.name}`, ""];
  if (data.summary) lines.push("## 摘要", data.summary, "");
  if (data.detail) lines.push("## 扫描详情", data.detail, "");
  if (data.key_files.length > 0) {
    lines.push("## 关键文件", ...data.key_files.map((file) => `- ${file}`), "");
  }
  if (data.extra) lines.push("## 补充说明", data.extra, "");
  lines.push("## 现状");
  if (data.status?.trim()) {
    lines.push(data.status.trim(), "");
  } else {
    lines.push("> 建议手动补充：当前能做什么、已知问题、下一步方向", "");
  }
  lines.push(
    "---",
    `*更新于 ${data.updated_at}，再次调用 pcp_init 可刷新*`,
  );

  const md = lines.join("\n");
  fs.writeFileSync(path.join(pcpDir(dir), "PROJECT.md"), md);
  writeHtml(dir, "PROJECT.html", md, `PCP: ${data.name}`);
}

export function readProjectJson(dir: string): ProjectData | null {
  const p = path.join(pcpDir(dir), "PROJECT.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ProjectData;
  } catch {
    return null;
  }
}

export function readProjectMd(dir: string): string | null {
  const p = path.join(pcpDir(dir), "PROJECT.md");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

export function readEventLog(dir: string): PcpEvent[] {
  const p = path.join(pcpDir(dir), "events.jsonl");
  if (!fs.existsSync(p)) return [];

  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PcpEvent];
      } catch {
        return [];
      }
    });
}

export function replayEvents(dir: string): Task[] {
  const tasks = new Map<string, Task>();

  for (const event of readEventLog(dir)) {
    if (event.e === "created" && event.id) {
      tasks.set(event.id, {
        id: event.id,
        type: event.type ?? "main",
        title: event.title ?? "",
        done: false,
      });
    } else if (event.e === "sub" && event.id) {
      tasks.set(event.id, {
        id: event.id,
        type: "sub",
        title: event.title ?? "",
        parent: event.parent,
        done: false,
      });
    } else if ((event.e === "done" || event.e === "pivoted") && event.id) {
      const task = tasks.get(event.id);
      if (task) {
        task.done = true;
        if (event.e === "pivoted") task.pivoted = true;
        if (event.reason) task.pivot_reason = event.reason;
      }
    } else if (event.e === "resume_set" && event.id) {
      const task = tasks.get(event.id);
      if (task) task.resume_prompt = event.prompt;
    }
  }

  return Array.from(tasks.values());
}

export function replayBacklog(dir: string): BacklogItem[] {
  const items = new Map<string, BacklogItem>();

  for (const event of readEventLog(dir)) {
    if (event.e === "backlog_add" && event.id) {
      items.set(event.id, {
        id: event.id,
        title: event.title ?? "",
        detail: event.detail,
        status: "pending",
      });
    } else if (event.e === "backlog_promote" && event.backlog_id) {
      const item = items.get(event.backlog_id);
      if (item) {
        item.status = "promoted";
        item.promoted_to = event.task_id;
      }
    } else if (event.e === "backlog_dismiss" && event.backlog_id) {
      const item = items.get(event.backlog_id);
      if (item) item.status = "dismissed";
    }
  }

  return Array.from(items.values());
}

export function getPendingBacklog(dir: string): BacklogItem[] {
  return replayBacklog(dir).filter((item) => item.status === "pending");
}

export function getTask(tasks: Task[], id: string): Task | undefined {
  return tasks.find((task) => task.id === id);
}

export function readProjectContext(dir: string): string | null {
  let latest: string | null = null;
  for (const event of readEventLog(dir)) {
    if (event.e === "project_context" && event.summary) {
      latest = event.summary;
    }
  }
  return latest;
}

function tryRead(p: string, maxChars = 400): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8").trim().slice(0, maxChars);
  } catch {
    return null;
  }
}

export function scanProject(dir: string): { summary: string; detail: string; key_files: string[] } {
  const facts: string[] = [];
  const detail: string[] = [];

  const pkg = tryRead(path.join(dir, "package.json"));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg) as {
        name?: string;
        description?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      if (parsed.name) facts.push(parsed.name);
      if (parsed.description) facts.push(parsed.description);
      const deps = { ...parsed.dependencies, ...parsed.devDependencies };
      const frameworks = ["next", "react", "vue", "svelte", "express", "fastify", "hono"]
        .filter((framework) => deps?.[framework] || deps?.[`@${framework}/core`]);
      if (frameworks.length > 0) facts.push(`(${frameworks.join(", ")})`);
    } catch {
      // ignore malformed package manifest
    }
  }

  for (const manifest of [
    ["pyproject.toml", /^name\s*=\s*"(.+)"/m, /^description\s*=\s*"(.+)"/m],
    ["go.mod", /^module\s+(\S+)/m, null],
    ["Cargo.toml", /^name\s*=\s*"(.+)"/m, /^description\s*=\s*"(.+)"/m],
  ] as [string, RegExp, RegExp | null][]) {
    const content = tryRead(path.join(dir, manifest[0]));
    if (!content) continue;
    const name = manifest[1]?.exec(content)?.[1];
    const desc = manifest[2]?.exec(content)?.[1];
    if (name) facts.push(name);
    if (desc) facts.push(desc);
  }

  for (const name of ["README.md", "README.rst", "README.txt", "README"]) {
    const content = tryRead(path.join(dir, name), 800);
    if (!content) continue;
    const paragraphs = content
      .replace(/^#+.*/gm, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .split(/\n\n+/)
      .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
      .filter((paragraph) => paragraph.length > 20 && !paragraph.startsWith("```"));
    if (paragraphs[0]) {
      detail.push(`README: ${paragraphs[0].slice(0, 200)}`);
    }
    break;
  }

  const claudeMd = tryRead(path.join(dir, "CLAUDE.md"), 500);
  if (claudeMd) {
    const firstPara = claudeMd
      .split(/\n\n+/)
      .find((paragraph) => paragraph.trim().length > 20 && !paragraph.startsWith("#"));
    if (firstPara) detail.push(`CLAUDE.md: ${firstPara.trim().slice(0, 150)}`);
  }

  const entries = [
    "src/index.ts", "src/main.ts", "src/app.ts",
    "src/index.tsx", "app/page.tsx", "pages/index.tsx",
    "src/main.py", "main.py", "app.py",
    "main.go", "cmd/main.go",
    "src/main.rs", "src/lib.rs",
  ].filter((entry) => fs.existsSync(path.join(dir, entry)));
  if (entries.length > 0) detail.push(`入口: ${entries.slice(0, 3).join(", ")}`);

  const summary = facts.filter(Boolean).join(" ").slice(0, 100) || path.basename(dir);
  return { summary, detail: detail.join("\n"), key_files: entries.slice(0, 5) };
}

function extractProjectStatus(projectJson: ProjectData | null, projectMd: string | null): string | null {
  if (projectJson?.status?.trim()) return projectJson.status.trim();
  if (!projectMd) return null;

  const statusMatch = projectMd.match(/## 现状\n([\s\S]*?)(?=\n## |\n---|\n*$)/);
  if (!statusMatch?.[1]) return null;

  const cleaned = statusMatch[1]
    .replace(/^>\s?/gm, "")
    .trim();
  if (!cleaned || cleaned.includes("建议手动补充")) return null;
  return cleaned;
}

function readWorklogEntries(dir: string, limit: number): string[] {
  const worklogPath = path.join(pcpDir(dir), "WORKLOG.md");
  if (!fs.existsSync(worklogPath)) return [];

  return fs.readFileSync(worklogPath, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .slice(-limit);
}

function formatEventSummary(event: PcpEvent): string {
  switch (event.e) {
    case "created":
      return `创建主任务 [${event.id}] ${event.title ?? ""}`.trim();
    case "sub":
      return `创建子任务 [${event.id}] ${event.title ?? ""}`.trim();
    case "done":
      return `完成任务 [${event.id}]`;
    case "pivoted":
      return `任务 [${event.id}] pivot：${event.reason ?? "未提供原因"}`;
    case "resume_set":
      return `更新恢复提示 [${event.id}] ${event.prompt ?? ""}`.trim();
    case "project_context":
      return `更新项目基线：${event.summary ?? ""}`.trim();
    case "backlog_add":
      return `记录 backlog [${event.id}] ${event.title ?? ""}`.trim();
    case "backlog_promote":
      return `将 backlog [${event.backlog_id}] 加入任务 [${event.task_id}]`;
    case "backlog_dismiss":
      return `忽略 backlog [${event.backlog_id}]`;
    default:
      return event.e;
  }
}

export function buildHandoffMarkdown(dir: string, options: HandoffOptions = {}): string {
  const {
    audience,
    focus,
    include_backlog = true,
    max_recent_events = 8,
    max_worklog_entries = 6,
  } = options;
  const stack = readStack(dir);
  const tasks = replayEvents(dir);
  const backlog = replayBacklog(dir);
  const projectJson = readProjectJson(dir);
  const projectMd = readProjectMd(dir);
  const projectContext = readProjectContext(dir);
  const activeTask = stack.active_task_id ? getTask(tasks, stack.active_task_id) : null;
  const mainTask = stack.active_stack[0] ? getTask(tasks, stack.active_stack[0]) : null;
  const parentTask =
    stack.active_stack.length > 1
      ? getTask(tasks, stack.active_stack[stack.active_stack.length - 2]!)
      : null;
  const pendingBacklog = include_backlog
    ? backlog.filter((item) => item.status === "pending")
    : [];
  const recentEvents = readEventLog(dir)
    .slice(-max_recent_events)
    .map((event) => `- ${formatEventSummary(event)}`);
  const recentWorklog = readWorklogEntries(dir, max_worklog_entries);
  const projectStatus = extractProjectStatus(projectJson, projectMd);
  const keyFiles = projectJson?.key_files ?? [];
  const lines: string[] = [
    "# PCP Handoff",
    "",
    `- 生成时间: ${new Date().toISOString()}`,
  ];

  if (audience) lines.push(`- 接手对象: ${audience}`);
  if (focus) lines.push(`- 交接重点: ${focus}`);
  lines.push("");

  lines.push("## 项目概况");
  if (projectJson?.name) lines.push(`- 项目: ${projectJson.name}`);
  if (projectJson?.summary ?? projectContext) {
    lines.push(`- 摘要: ${projectJson?.summary ?? projectContext ?? ""}`);
  }
  if (projectStatus) lines.push(`- 现状: ${projectStatus}`);
  if (keyFiles.length > 0) {
    lines.push(`- 关键文件: ${keyFiles.join(", ")}`);
  }
  lines.push("");

  lines.push("## 当前任务");
  if (mainTask) {
    lines.push(`- 当前主线任务: [${mainTask.id}] ${mainTask.title}`);
  } else {
    lines.push("- 当前主线任务: 无");
  }
  if (activeTask) {
    lines.push(`- 当前执行任务: [${activeTask.id}] ${activeTask.title}`);
  } else {
    lines.push("- 当前执行任务: 无");
  }
  if (parentTask?.resume_prompt) {
    lines.push(`- 返回主线提示: ${parentTask.resume_prompt}`);
  }
  if (stack.ready_tasks.length > 0) {
    lines.push("- 队列中的未完成任务:");
    for (const task of stack.ready_tasks) {
      lines.push(`  - [${task.id}] ${task.title}`);
    }
  } else {
    lines.push("- 队列中的未完成任务: 无");
  }
  lines.push("");

  lines.push("## 当前进展");
  const completedTasks = tasks.filter((task) => task.done).slice(-5);
  if (completedTasks.length > 0) {
    lines.push("- 最近完成:");
    for (const task of completedTasks) {
      lines.push(`  - [${task.id}] ${task.title}`);
    }
  } else {
    lines.push("- 最近完成: 暂无");
  }
  if (recentWorklog.length > 0) {
    lines.push("- 最近 worklog:");
    lines.push(...recentWorklog.map((entry) => `  ${entry}`));
  }
  lines.push("");

  lines.push("## 未完成事项");
  if (activeTask) {
    lines.push(`- 继续当前任务 [${activeTask.id}] ${activeTask.title}`);
  }
  if (stack.ready_tasks[0]) {
    lines.push(`- 完成当前任务后推进 [${stack.ready_tasks[0].id}] ${stack.ready_tasks[0].title}`);
  }
  if (!activeTask && stack.ready_tasks.length === 0) {
    lines.push("- 当前没有活动任务，建议重新规划并调用 pcp_plan。");
  }
  lines.push("");

  if (include_backlog) {
    lines.push("## Backlog 待决项");
    if (pendingBacklog.length > 0) {
      for (const item of pendingBacklog) {
        const detailSuffix = item.detail ? ` — ${item.detail}` : "";
        lines.push(`- [${item.id}] ${item.title}${detailSuffix}`);
      }
    } else {
      lines.push("- 无");
    }
    lines.push("");
  }

  lines.push("## 最近关键事件");
  if (recentEvents.length > 0) {
    lines.push(...recentEvents);
  } else {
    lines.push("- 暂无");
  }
  lines.push("");

  lines.push("## 建议下一步");
  if (activeTask) {
    lines.push(`1. 先继续完成 [${activeTask.id}] ${activeTask.title}。`);
  } else if (stack.ready_tasks[0]) {
    lines.push(`1. 从队列首项 [${stack.ready_tasks[0].id}] ${stack.ready_tasks[0].title} 开始。`);
  } else {
    lines.push("1. 让 planner 生成下一轮计划，再调用 pcp_plan。");
  }
  if (stack.ready_tasks[0] && activeTask) {
    lines.push(`2. 当前任务完成后，推进到 [${stack.ready_tasks[0].id}] ${stack.ready_tasks[0].title}。`);
  } else if (pendingBacklog[0]) {
    lines.push(`2. 评估 backlog 首项 [${pendingBacklog[0].id}] ${pendingBacklog[0].title} 是否进入下一轮。`);
  } else {
    lines.push("2. 如需中途切换工具，先把本文件交给下一个 AI。");
  }

  return lines.join("\n");
}

export function writeHandoff(dir: string, options: HandoffOptions = {}): { path: string; markdown: string } {
  ensureDir(dir);
  const markdown = buildHandoffMarkdown(dir, options);
  const handoffPath = path.join(pcpDir(dir), "HANDOFF.md");
  fs.writeFileSync(handoffPath, markdown);
  return { path: handoffPath, markdown };
}
