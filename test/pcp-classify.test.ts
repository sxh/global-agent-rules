import { describe, expect, test } from "bun:test";
import { isWriteTool, isBashTool, parsePcpTaskRef } from "../plugins/pcp.js";

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

// Regression guard for task-commit binding (B088).
//
// A commit must name the task it closes via a `PCP-Task: T###` trailer. Without
// an explicit, matching reference the plugin must not auto-close the active
// task — an unrelated commit previously advanced (and mis-attributed) the queue.
describe("pcp commit task reference", () => {
  test("extracts the task id from a PCP-Task trailer", () => {
    const cmd = `git commit -m "fix: thing" -m "body\n\nPCP-Task: T272"`;
    expect(parsePcpTaskRef(cmd)).toEqual({ id: "T272" });
  });

  test("returns null when the commit has no PCP-Task trailer", () => {
    expect(parsePcpTaskRef(`git commit -m "fix: thing"`)).toBeNull();
  });

  test("tolerates spacing and casing variants", () => {
    expect(parsePcpTaskRef(`git commit -m "x\nPCP-Task:T42"`)).toEqual({ id: "T42" });
    expect(parsePcpTaskRef(`git commit -m "x\npcp-task: T007"`)).toEqual({ id: "T007" });
  });
});
