// Classify a tool call for PCP's auto-lifecycle hooks and the tool guards.
//
// These live in pcp/ rather than plugins/ because opencode auto-discovers
// plugins/*.{ts,js} and invokes every export of such a module as a plugin
// factory. A helper exported there is called with a plugin-input object and
// throws (the 2026-09-18 unstartable-opencode incident). See
// scripts/check-contract.sh section 8.

const WRITE_PATTERNS = ["write", "edit", "patch", "create", "apply"];
const BASH_PATTERNS = ["bash", "shell", "exec", "run", "terminal"];
const READ_PATTERNS = ["read", "view", "cat"];
/** A whole-file write replaces the file; these tools change part of one instead. */
const PARTIAL_WRITE_PATTERNS = ["edit", "patch", "append", "insert", "replace"];

/** The arguments a tool uses to name the one file it acts on. */
const PATH_KEYS = [
  "filePath",
  "file_path",
  "filepath",
  "path",
  "file",
  "target_file",
  "targetFile",
];

export function isWriteTool(name: string): boolean {
  const n = name.toLowerCase();
  return WRITE_PATTERNS.some((p) => n.includes(p));
}

export function isBashTool(name: string): boolean {
  const n = name.toLowerCase();
  return BASH_PATTERNS.some((p) => n.includes(p));
}

export function isReadTool(name: string): boolean {
  const n = name.toLowerCase();
  return READ_PATTERNS.some((p) => n.includes(p));
}

/** Whether the call replaces a whole file, rather than editing part of it (B289). */
export function isWholeFileWrite(name: string): boolean {
  const n = name.toLowerCase();
  return isWriteTool(n) && !PARTIAL_WRITE_PATTERNS.some((p) => n.includes(p));
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
