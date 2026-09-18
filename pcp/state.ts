import * as fs from "node:fs";
import * as path from "node:path";

import { applyBacklogEvents, pendingBacklog } from "./backlog_state.js";
import { applyTaskEvents, formatEventSummary } from "./task_state.js";
import { parseStackStrict, recoverStackFromEvents } from "./stack_state.js";

export interface Stack {
  next_id: number;
  backlog_next_id: number;
  active_stack: string[];
  active_task_id: string | null;
  ready_tasks: { id: string; title: string }[];
  last_done_ts?: number;
}

export interface PcpEvent {
  e:
    | "created"
    | "sub"
    | "done"
    | "pivoted"
    | "renamed"
    | "resume_set"
    | "project_context"
    | "backlog_add"
    | "backlog_promote"
    | "backlog_done"
    | "backlog_dismiss"
    | "backlog_demote";
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
  status: "pending" | "promoted" | "done" | "dismissed";
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
  const recover = () => recoverStackFromEvents(replayEvents(dir));
  if (!fs.existsSync(p)) {
    return recover();
  }
  try {
    return parseStackStrict(fs.readFileSync(p, "utf8")) ?? recover();
  } catch {
    return recover();
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

export function appendWorklog(dir: string, line: string): void {
  const p = path.join(pcpDir(dir), "WORKLOG.md");
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
  const header = "# PCP Worklog\n\n";
  if (!fs.existsSync(p)) fs.writeFileSync(p, header);
  fs.appendFileSync(p, `- ${ts} ${line}\n`);
}

export function writeProjectFiles(dir: string, data: ProjectData): void {
  fs.writeFileSync(
    path.join(pcpDir(dir), "PROJECT.json"),
    JSON.stringify(data, null, 2),
  );

  const lines = [`# ${data.name}`, ""];
  if (data.summary) lines.push("## Summary", data.summary, "");
  if (data.detail) lines.push("## Scan details", data.detail, "");
  if (data.key_files.length > 0) {
    lines.push("## Key files", ...data.key_files.map((file) => `- ${file}`), "");
  }
  if (data.extra) lines.push("## Notes", data.extra, "");
  lines.push("## Current state");
  if (data.status?.trim()) {
    lines.push(data.status.trim(), "");
  } else {
    lines.push("> To fill in manually: what it can do now, known issues, next steps", "");
  }
  lines.push(
    "---",
    `*Updated ${data.updated_at}; call pcp_init again to refresh*`,
  );

  const md = lines.join("\n");
  fs.writeFileSync(path.join(pcpDir(dir), "PROJECT.md"), md);
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
  return applyTaskEvents(readEventLog(dir));
}

export function replayBacklog(dir: string): BacklogItem[] {
  return applyBacklogEvents(readEventLog(dir));
}

export function getPendingBacklog(dir: string): BacklogItem[] {
  return pendingBacklog(replayBacklog(dir));
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
  if (entries.length > 0) detail.push(`Entry points: ${entries.slice(0, 3).join(", ")}`);

  const summary = facts.filter(Boolean).join(" ").slice(0, 100) || path.basename(dir);
  return { summary, detail: detail.join("\n"), key_files: entries.slice(0, 5) };
}

function extractProjectStatus(projectJson: ProjectData | null, projectMd: string | null): string | null {
  if (projectJson?.status?.trim()) return projectJson.status.trim();
  if (!projectMd) return null;

  // Match the English heading and the legacy Chinese one (\u73b0\u72b6) so
  // PROJECT.md files written before the English-only change are still read.
  const statusMatch = projectMd.match(/## (?:\u73b0\u72b6|Current state)\n([\s\S]*?)(?=\n## |\n---|\n*$)/);
  if (!statusMatch?.[1]) return null;

  const cleaned = statusMatch[1]
    .replace(/^>\s?/gm, "")
    .trim();
  if (
    !cleaned ||
    cleaned.includes("To fill in manually:") ||
    cleaned.includes("\u5efa\u8bae\u624b\u52a8\u8865\u5145")
  ) {
    return null;
  }
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
    `- Generated: ${new Date().toISOString()}`,
  ];

  if (audience) lines.push(`- Audience: ${audience}`);
  if (focus) lines.push(`- Focus: ${focus}`);
  lines.push("");

  lines.push("## Project overview");
  if (projectJson?.name) lines.push(`- Project: ${projectJson.name}`);
  if (projectJson?.summary ?? projectContext) {
    lines.push(`- Summary: ${projectJson?.summary ?? projectContext ?? ""}`);
  }
  if (projectStatus) lines.push(`- Current state: ${projectStatus}`);
  if (keyFiles.length > 0) {
    lines.push(`- Key files: ${keyFiles.join(", ")}`);
  }
  lines.push("");

  lines.push("## Current tasks");
  if (mainTask) {
    lines.push(`- Main task: [${mainTask.id}] ${mainTask.title}`);
  } else {
    lines.push("- Main task: none");
  }
  if (activeTask) {
    lines.push(`- Active task: [${activeTask.id}] ${activeTask.title}`);
  } else {
    lines.push("- Active task: none");
  }
  if (parentTask?.resume_prompt) {
    lines.push(`- Return-to-main prompt: ${parentTask.resume_prompt}`);
  }
  if (stack.ready_tasks.length > 0) {
    lines.push("- Queued tasks:");
    for (const task of stack.ready_tasks) {
      lines.push(`  - [${task.id}] ${task.title}`);
    }
  } else {
    lines.push("- Queued tasks: none");
  }
  lines.push("");

  lines.push("## Progress");
  const completedTasks = tasks.filter((task) => task.done).slice(-5);
  if (completedTasks.length > 0) {
    lines.push("- Recently completed:");
    for (const task of completedTasks) {
      lines.push(`  - [${task.id}] ${task.title}`);
    }
  } else {
    lines.push("- Recently completed: none yet");
  }
  if (recentWorklog.length > 0) {
    lines.push("- Recent worklog:");
    lines.push(...recentWorklog.map((entry) => `  ${entry}`));
  }
  lines.push("");

  lines.push("## Outstanding work");
  if (activeTask) {
    lines.push(`- Continue active task [${activeTask.id}] ${activeTask.title}`);
  }
  if (stack.ready_tasks[0]) {
    lines.push(`- After the active task, advance to [${stack.ready_tasks[0].id}] ${stack.ready_tasks[0].title}`);
  }
  if (!activeTask && stack.ready_tasks.length === 0) {
    lines.push("- No active task; plan the next round and call pcp_plan.");
  }
  lines.push("");

  if (include_backlog) {
    lines.push("## Backlog (pending)");
    if (pendingBacklog.length > 0) {
      for (const item of pendingBacklog) {
        const detailSuffix = item.detail ? ` — ${item.detail}` : "";
        lines.push(`- [${item.id}] ${item.title}${detailSuffix}`);
      }
    } else {
      lines.push("- none");
    }
    lines.push("");
  }

  lines.push("## Recent key events");
  if (recentEvents.length > 0) {
    lines.push(...recentEvents);
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("## Suggested next steps");
  if (activeTask) {
    lines.push(`1. Finish the active task [${activeTask.id}] ${activeTask.title} first.`);
  } else if (stack.ready_tasks[0]) {
    lines.push(`1. Start from the queue head [${stack.ready_tasks[0].id}] ${stack.ready_tasks[0].title}.`);
  } else {
    lines.push("1. Have the planner produce the next round, then call pcp_plan.");
  }
  if (stack.ready_tasks[0] && activeTask) {
    lines.push(`2. After the active task, advance to [${stack.ready_tasks[0].id}] ${stack.ready_tasks[0].title}.`);
  } else if (pendingBacklog[0]) {
    lines.push(`2. Evaluate whether backlog head [${pendingBacklog[0].id}] ${pendingBacklog[0].title} enters the next round.`);
  } else {
    lines.push("2. If switching tools mid-way, hand this file to the next AI first.");
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
