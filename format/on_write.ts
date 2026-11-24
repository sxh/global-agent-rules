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
//   * a formatter failure is silent: it must never mask the edit result.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Arguments a host tool uses to name the file it wrote. */
const PATH_KEYS = [
  "filePath",
  "file_path",
  "filepath",
  "path",
  "file",
  "target_file",
  "targetFile",
];

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
  | { status: "failed"; file: string };

export interface FormatInput {
  /** Host tool name, e.g. "write", "edit", "bash". */
  tool: string;
  /** The call's arguments, raw from the host. */
  args: unknown;
  /** The session's project directory: nothing outside it is ever formatted. */
  workspace: string;
  /** Supplied by the adapter so the one write-tool classifier is reused, not duplicated. */
  isWriteTool: (tool: string) => boolean;
}

/** The single file path a tool call names, or null when it names none (or several). */
export function writtenPath(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

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

/** Run prettier on one file. Never throws: a formatter failure is reported, not raised. */
export function runPrettier(
  binary: string,
  file: string,
  cwd: string,
): FormatOutcome {
  const result = spawnSync(
    binary,
    ["--write", "--log-level", "silent", file],
    { cwd, stdio: "ignore", timeout: PRETTIER_TIMEOUT_MS },
  );
  if (result.error || result.status !== 0) return { status: "failed", file };
  return { status: "formatted", file };
}

/**
 * Format the file a just-completed tool call wrote, when there is one to format.
 *
 * Called from the `tool.execute.after` hook, so it must be quick, silent and side-effect-free
 * outside the written file.
 */
export function formatWrittenFile(input: FormatInput): FormatOutcome {
  const { tool, args, workspace, isWriteTool } = input;
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
