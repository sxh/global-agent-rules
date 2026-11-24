import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createOverwriteGuard, gitTracked, lineCount } from '../../pcp/overwrite_guard.ts';
import { isReadTool, isWholeFileWrite, writtenPath } from '../../pcp/tool_classify.ts';

// B289: a whole-file write over a file holding eleven live tests replaced it, and the suite
// stayed green because the replacement's own tests passed. These pin the guard's decision:
// which calls it judges, which it leaves alone, and that one read is what makes a
// replacement legitimate.

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const GIT = '/usr/bin/git';
const SESSION = 'ses_test';
const KEPT = 'src/kept.ts';
const KEPT_LINES = 3;

/** A scratch git repo holding one tracked [KEPT] of three lines. */
function repo({ tracked = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'overwrite-guard-'));
  dirs.push(dir);
  const file = path.join(dir, KEPT);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  execFileSync(GIT, ['init', '-q'], { cwd: dir });
  if (tracked) execFileSync(GIT, ['add', KEPT], { cwd: dir });
  return dir;
}

/** A plain directory, so the guard's no-git path is exercised rather than assumed. */
function plainDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'overwrite-guard-plain-'));
  dirs.push(dir);
  const file = path.join(dir, KEPT);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'const a = 1;\n');
  return dir;
}

function writeCall(workspace, file = KEPT) {
  return { tool: 'write', args: { filePath: file }, workspace, sessionID: SESSION };
}

function readCall(workspace, file = KEPT) {
  return { tool: 'read', args: { filePath: file }, workspace, sessionID: SESSION };
}

/** The guard as the plugin wires it: every host-specific piece supplied, none imported. */
function watch() {
  return createOverwriteGuard({ writtenPath, isWholeFileWrite, isReadTool, isTracked: gitTracked, lineCount });
}

test('judges the whole-file write tool and nothing else', () => {
  assert.equal(isWholeFileWrite('write'), true);
  for (const tool of ['edit', 'patch', 'append', 'read', 'bash', 'grep']) {
    assert.equal(isWholeFileWrite(tool), false, tool);
  }
});

test('refuses a whole-file write over a tracked file the session never read', () => {
  const dir = repo();
  const refusal = watch().refusal(writeCall(dir));

  assert.match(refusal, /src\/kept\.ts/);
  assert.match(refusal, new RegExp(`${KEPT_LINES} lines`));
  assert.match(refusal, /read/i);
});

test('allows the same write once the session has read the file', () => {
  const dir = repo();
  const guard = watch();
  guard.recordRead(readCall(dir));

  assert.equal(guard.refusal(writeCall(dir)), null);
});

test('records reads per session, so one session does not vouch for another', () => {
  const dir = repo();
  const guard = watch();
  guard.recordRead(readCall(dir));

  assert.notEqual(guard.refusal({ ...writeCall(dir), sessionID: 'ses_other' }), null);
});

test('ignores a read that names no file, and every tool that is not a read', () => {
  const dir = repo();
  const guard = watch();
  guard.recordRead({ tool: 'read', args: {}, workspace: dir, sessionID: SESSION });
  guard.recordRead({ ...readCall(dir), tool: 'grep' });

  assert.notEqual(guard.refusal(writeCall(dir)), null);
});

test('allows a write that creates a path, because there is nothing to lose', () => {
  const dir = repo();

  assert.equal(watch().refusal(writeCall(dir, 'src/brand-new.ts')), null);
});

test('leaves an edit alone: it changes part of a file rather than replacing it', () => {
  const dir = repo();

  assert.equal(watch().refusal({ ...writeCall(dir), tool: 'edit' }), null);
});

test('leaves a file git does not track alone', () => {
  const dir = repo({ tracked: false });

  assert.equal(watch().refusal(writeCall(dir)), null);
});

test('degrades to a no-op in a directory that is not a git repo', () => {
  const dir = plainDir();

  assert.equal(watch().refusal(writeCall(dir)), null);
  // The file the write would have destroyed is still there and still intact.
  assert.equal(readFileSync(path.join(dir, KEPT), 'utf8'), 'const a = 1;\n');
});
