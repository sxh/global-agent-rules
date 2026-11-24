import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { changedPaths, porcelainPath } from '../../pcp/changed_paths.ts';

// Both deferral guards read the working tree, so the parsing that decides what a
// changed file is called is worth pinning: a missed path means the guard cannot see
// the file the task opened.

test('reads the path from a porcelain line', () => {
  assert.equal(porcelainPath(' M packages/web/src/App.tsx'), 'packages/web/src/App.tsx');
  assert.equal(porcelainPath('?? scripts/probe.ts'), 'scripts/probe.ts');
});

test('reduces a rename to the name the file has now', () => {
  assert.equal(porcelainPath('R  old/Name.tsx -> new/Name.tsx'), 'new/Name.tsx');
});

test('unquotes a path git had to escape', () => {
  assert.equal(porcelainPath(' M "docs/a file.md"'), 'docs/a file.md');
});

test('ignores a line too short to carry a path', () => {
  assert.equal(porcelainPath(''), null);
  assert.equal(porcelainPath(' M'), null);
});

test('lists what a real repo has changed, including untracked files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'changed-paths-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(path.join(dir, 'tracked.txt'), 'one\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=t@e.st', '-c', 'user.name=T', 'commit', '-qm', 'base'], { cwd: dir });
    writeFileSync(path.join(dir, 'tracked.txt'), 'two\n');
    writeFileSync(path.join(dir, 'fresh.txt'), 'new\n');

    assert.deepEqual(changedPaths(dir).sort(), ['fresh.txt', 'tracked.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports nothing where git cannot read the directory, rather than guessing', () => {
  assert.deepEqual(changedPaths(path.join(tmpdir(), 'not-a-repo-000000000000')), []);
});
