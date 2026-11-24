// Refuse a whole-file write that would replace a tracked file this session never read (B289).
//
// 2026-11-24: a whole-file write over packages/web/src/constants.test.ts replaced a file
// holding eleven live tests. The suite stayed green — the replacement's own tests passed —
// and only the collected test count showed what had gone. A read is the cheapest statement
// of intent a tool call can make, so the guard demands one: content the session has not
// looked at is content it cannot know it is replacing.
//
// It is a guard, not a lock. An `edit` call, a path that does not exist yet, a file git does
// not track and a project without git are all left alone.
//
// Host-specific pieces arrive as dependencies, the same way format/on_write.ts takes its
// classifier: a module a test imports may not import a sibling at runtime, because node
// resolves the `.js` specifiers the host needs and not the `.ts` files the tests read.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface GuardDeps {
  /** The one file path a call names, from pcp/tool_classify. */
  writtenPath: (args: unknown) => string | null;
  /** Whether the call replaces a whole file rather than editing part of one. */
  isWholeFileWrite: (tool: string) => boolean;
  /** Whether the call reads a file, so its content becomes known to the session. */
  isReadTool: (tool: string) => boolean;
  /** Whether git tracks the file in that workspace. */
  isTracked: (file: string, cwd: string) => boolean;
  /** How many lines the file holds. */
  lineCount: (file: string) => number;
}

export interface ToolCall {
  tool: string;
  args: unknown;
  workspace: string;
  sessionID: string;
}

export interface OverwriteGuard {
  /** A read finished: the file it named may now be replaced by the same session. */
  recordRead(call: ToolCall): void;
  /** The refusal for a whole-file write, or null when the call may proceed. */
  refusal(call: ToolCall): string | null;
}

/** Whether git tracks [file] in [cwd]. Outside a repo nothing is tracked, so the guard no-ops. */
export function gitTracked(file: string, cwd: string): boolean {
  try {
    const listed = execFileSync("git", ["ls-files", "--", path.relative(cwd, file)], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return listed.trim() !== "";
  } catch {
    return false;
  }
}

/** How many lines [file] holds, or 0 when it cannot be read. */
export function lineCount(file: string): number {
  try {
    const text = readFileSync(file, "utf8");
    return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
  } catch {
    return 0;
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function createOverwriteGuard(deps: GuardDeps): OverwriteGuard {
  // Per session, because one session having read a file says nothing about another.
  const read = new Map<string, Set<string>>();

  return {
    recordRead(call) {
      if (!deps.isReadTool(call.tool)) return;
      const named = deps.writtenPath(call.args);
      if (named === null) return;
      const known = read.get(call.sessionID) ?? new Set<string>();
      known.add(path.resolve(call.workspace, named));
      read.set(call.sessionID, known);
    },

    refusal(call) {
      if (!deps.isWholeFileWrite(call.tool)) return null;
      const named = deps.writtenPath(call.args);
      if (named === null) return null;

      const root = path.resolve(call.workspace);
      const file = path.resolve(root, named);
      if (!isInside(root, file) || !isFile(file)) return null;
      if (read.get(call.sessionID)?.has(file) === true) return null;
      if (!deps.isTracked(file, call.workspace)) return null;

      const shown = path.relative(root, file);
      return (
        `overwrite-guard: ${shown} is a tracked file this session has not read ` +
        `(${deps.lineCount(file)} lines), so a whole-file write would replace it unseen.\n` +
        "Read it first — that read is the statement of intent — or use edit for the part you mean to change."
      );
    },
  };
}
