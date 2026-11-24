// Format the file an edit tool just wrote, so the pre-commit gate stops rediscovering
// formatting. B284 (retrospective 2026-11-23: nine preflight runs in one session failed on
// `prettier --check` after a write that was not prettier-clean, ~45s each).
//
// The decision and the run live here rather than in plugins/format.ts because opencode
// auto-discovers every export of a top-level plugins/ module as a plugin factory, and
// because a test may not import a plugins/ module (scripts/check-contract.sh sections 8, 7b).
//
// Three constraints from the incident store:
//   * the project's OWN prettier decides what is formatted — the hook never installs, downloads
//     or guesses a formatter, so a project without one degrades to a no-op (2026-10-09: a
//     project's formatter must exclude tool-generated state, and .prettierignore is that seam);
//   * only the file types the project's gate covers are touched (2026-10-24: formatting a type
//     the check does not cover rewrote unrelated docs) — prettier's own config and ignore file
//     are the only source of truth, so there is no second list here;
//   * a formatter failure never masks the edit result, and never blocks it — but it is reported
//     (B295): prettier refusing a file is the cheapest syntax check a session gets, and a
//     failure left in a discarded outcome is rediscovered two commands later, at the gate.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Prettier config filenames, per its own resolution order. */
const CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.json5",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.toml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
];

/** A formatter that hangs must not stall the tool result it follows. */
const PRETTIER_TIMEOUT_MS = 20_000;

export type FormatOutcome =
  | {
      status: "skipped";
      reason:
        | "not-a-write-tool"
        | "no-file-path"
        | "outside-workspace"
        | "not-a-file"
        | "no-prettier";
    }
  | { status: "formatted"; file: string }
  | { status: "failed"; file: string; message?: string };

export interface FormatInput {
  /** Host tool name, e.g. "write", "edit", "bash". */
  tool: string;
  /** The call's arguments, raw from the host. */
  args: unknown;
  /** The session's project directory: nothing outside it is ever formatted. */
  workspace: string;
  /** Supplied by the adapter so the one write-tool classifier is reused, not duplicated. */
  isWriteTool: (tool: string) => boolean;
  /** Supplied by the adapter for the same reason: one path extractor, in pcp/tool_classify. */
  writtenPath: (args: unknown) => string | null;
}

/** The single file path a tool call names, or null when it names none (or several). */

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Whether this directory declares itself prettier-managed: a config file, or a package.json
 *  that carries a prettier key or runs prettier from a script. */
function hasPrettierSignal(dir: string): boolean {
  if (CONFIG_FILES.some((name) => existsSync(path.join(dir, name)))) return true;

  const pkg = path.join(dir, "package.json");
  if (!existsSync(pkg)) return false;
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkg, "utf8"));
    if (!parsed || typeof parsed !== "object") return false;
    const record = parsed as Record<string, unknown>;
    if ("prettier" in record) return true;
    const scripts = record.scripts;
    if (!scripts || typeof scripts !== "object") return false;
    return Object.values(scripts as Record<string, unknown>).some(
      (value) => typeof value === "string" && value.includes("prettier"),
    );
  } catch {
    return false;
  }
}

/**
 * The project's own prettier binary for this file, or null.
 *
 * Walk from the file's directory up to the workspace, taking the nearest installed binary and
 * whether any directory on that path declares prettier. Both are required: a binary that lives
 * in the tree does not make the project's gate a prettier run.
 */
export function resolvePrettier(
  file: string,
  workspace: string,
): string | null {
  const root = path.resolve(workspace);
  const start = path.dirname(path.resolve(file));
  if (!isInside(root, start)) return null;

  let binary: string | null = null;
  let signal = false;
  let dir = start;
  for (;;) {
    if (!binary) {
      const candidate = path.join(dir, "node_modules", ".bin", "prettier");
      if (existsSync(candidate)) binary = candidate;
    }
    if (!signal) signal = hasPrettierSignal(dir);
    if (dir === root) break;
    dir = path.dirname(dir);
  }

  return binary && signal ? binary : null;
}

function isExistingFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/** The one line of a formatter's complaint worth showing, or null when it said nothing. */
function firstLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line === undefined ? null : line.slice(0, 300);
}

/** Run prettier on one file. Never throws: a formatter failure is reported, not raised. */
export function runPrettier(
  binary: string,
  file: string,
  cwd: string,
): FormatOutcome {
  const result = spawnSync(
    binary,
    ["--write", file],
    {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: PRETTIER_TIMEOUT_MS,
      encoding: "utf8",
    },
  );
  if (result.error || result.status !== 0) {
    const message = firstLine(result.stderr ?? "");
    return message ? { status: "failed", file, message } : { status: "failed", file };
  }
  return { status: "formatted", file };
}

/**
 * [output] with a line added when formatting failed, or null when there is nothing to add
 * (B295).
 *
 * The write itself is never blocked — a formatter failure must not mask the edit result —
 * but it must not be swallowed either. A file prettier refuses usually does not parse, so
 * the notice names the file and carries prettier's own complaint: the session learns about
 * the syntax error here, not at the next gate run.
 */
export function formatNotice(output: string, outcome: FormatOutcome): string | null {
  if (outcome.status !== "failed") return null;
  const detail = outcome.message ? `: ${outcome.message}` : "";
  return (
    `${output}\n\nformat-on-write: prettier could not format ${outcome.file}${detail}\n` +
    "The file may not parse. Fix it before continuing — the project's format gate will fail on it."
  );
}

/**
 * Format the file a just-completed tool call wrote, when there is one to format.
 *
 * Called from the `tool.execute.after` hook, so it must be quick, silent and side-effect-free
 * outside the written file.
 */
export function formatWrittenFile(input: FormatInput): FormatOutcome {
  const { tool, args, workspace, isWriteTool, writtenPath } = input;
  const root = path.resolve(workspace);

  if (!isWriteTool(tool)) return { status: "skipped", reason: "not-a-write-tool" };

  const named = writtenPath(args);
  if (!named) return { status: "skipped", reason: "no-file-path" };

  const file = path.resolve(root, named);
  if (!isInside(root, file)) {
    return { status: "skipped", reason: "outside-workspace" };
  }

  if (!isExistingFile(file)) {
    return { status: "skipped", reason: "not-a-file" };
  }

  const binary = resolvePrettier(file, root);
  if (!binary) return { status: "skipped", reason: "no-prettier" };

  return runPrettier(binary, file, root);
}
