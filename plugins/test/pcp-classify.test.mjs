import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWriteTool, isBashTool } from '../../pcp/tool_classify.ts';
import { parsePcpTaskRef } from '../../pcp/commit_ref.ts';

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

test('shell/exec commands are not classified as write tools', () => {
  for (const name of ['bash', 'shell', 'exec', 'run', 'terminal']) {
    assert.equal(isWriteTool(name), false, `${name} must not be a write tool`);
  }
});

test('file-mutation tools are classified as write tools', () => {
  for (const name of ['write', 'edit', 'patch']) {
    assert.equal(isWriteTool(name), true, `${name} must be a write tool`);
  }
});

test('shell/exec tools remain bash tools for the commit auto-done detector', () => {
  for (const name of ['bash', 'shell', 'terminal']) {
    assert.equal(isBashTool(name), true, `${name} must be a bash tool`);
  }
});

// Regression guard for task-commit binding (B088).
//
// A commit must name the task it closes via a `PCP-Task: T###` trailer. Without
// an explicit, matching reference the plugin must not auto-close the active
// task — an unrelated commit previously advanced (and mis-attributed) the queue.

test('extracts the task id from a PCP-Task trailer', () => {
  const cmd = `git commit -m "fix: thing" -m "body\n\nPCP-Task: T272"`;
  assert.deepEqual(parsePcpTaskRef(cmd), { id: 'T272' });
});

test('returns null when the commit has no PCP-Task trailer', () => {
  assert.equal(parsePcpTaskRef(`git commit -m "fix: thing"`), null);
});

test('tolerates spacing and casing variants', () => {
  assert.deepEqual(parsePcpTaskRef(`git commit -m "x\nPCP-Task:T42"`), { id: 'T42' });
  assert.deepEqual(parsePcpTaskRef(`git commit -m "x\npcp-task: T007"`), { id: 'T007' });
});
