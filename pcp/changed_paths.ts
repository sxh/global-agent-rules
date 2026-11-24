// The files the working tree has changed, which is what the active task has opened.
//
// Two guards ask this question — the tools (pcp_capture, pcp_done) and the
// commit-trailer auto-close in hooks.ts — so the git read lives here once. The
// parsing is exported because it is the part that can be wrong: porcelain lines
// carry two status columns, render a rename as `old -> new`, and quote a path that
// holds special characters.

import { execFileSync } from "node:child_process";

/** The path on a `git status --porcelain` line, with a rename reduced to its target. */
export function porcelainPath(line: string): string | null {
  if (line.length < 4) return null;
  const target = line.slice(3);
  const arrow = target.indexOf(" -> ");
  const name = arrow === -1 ? target : target.slice(arrow + 4);
  const unquoted = name.replace(/^"|"$/g, "");
  return unquoted.length === 0 ? null : unquoted;
}

/**
 * Files the working tree has changed, repo-relative.
 *
 * The PCP flow closes a task before committing it, so the staged and untracked work
 * is the task's diff at the moment either guard asks. A directory this cannot read
 * (no git, no repo) yields nothing: the guards never refuse on a guess.
 */
export function changedPaths(dir: string): string[] {
  try {
    const output = execFileSync("git", ["-C", dir, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split("\n")
      .map(porcelainPath)
      .filter((name): name is string => name !== null);
  } catch {
    return [];
  }
}
