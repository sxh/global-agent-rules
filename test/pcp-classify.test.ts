import { describe, expect, test } from "bun:test";
import { isWriteTool, isBashTool } from "../plugins/pcp.js";

// Regression guard for the PCP auto-start hook.
//
// autoCreateTask() runs on "tool.execute.before" for any tool classified as a
// write tool whenever no task is active. If shell/exec commands are classified
// as writes, then after a commit auto-closes the active task, the very next
// shell command (even a read-only `git status`) re-creates a task titled with
// the session title — an endless run of identical duplicate tasks.
//
// Shell/exec commands must therefore only be recognised by isBashTool() (used
// by the commit auto-done detector), never by isWriteTool().

describe("pcp tool classification", () => {
  test("shell/exec commands are not classified as write tools", () => {
    for (const name of ["bash", "shell", "exec", "run", "terminal"]) {
      expect(isWriteTool(name)).toBe(false);
    }
  });

  test("file-mutation tools are classified as write tools", () => {
    for (const name of ["write", "edit", "patch"]) {
      expect(isWriteTool(name)).toBe(true);
    }
  });

  test("shell/exec tools remain bash tools for the commit auto-done detector", () => {
    for (const name of ["bash", "shell", "terminal"]) {
      expect(isBashTool(name)).toBe(true);
    }
  });
});
