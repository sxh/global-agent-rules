import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRename } from '../pcp_rename.ts';

const tasks = [
  { id: 'T001', type: 'main', title: 'first', done: false },
  { id: 'T002', type: 'sub', title: 'second', parent: 'T001', done: false },
];

test('renames the active task by default', () => {
  assert.deepEqual(decideRename(tasks, null, 'T001', 'new title'), {
    kind: 'rename',
    id: 'T001',
    title: 'new title',
  });
});

test('an explicit id overrides the active task', () => {
  assert.deepEqual(decideRename(tasks, 'T002', 'T001', 'renamed detour'), {
    kind: 'rename',
    id: 'T002',
    title: 'renamed detour',
  });
});

test('an explicit id works when there is no active task', () => {
  // B079: the mis-named auto-created task is closed and the stack may be idle,
  // so renaming a queued/historical task must not require an active task.
  assert.deepEqual(decideRename(tasks, 'T002', null, 'renamed detour'), {
    kind: 'rename',
    id: 'T002',
    title: 'renamed detour',
  });
});

test('trims the new title', () => {
  assert.deepEqual(decideRename(tasks, null, 'T001', '  spaced  '), {
    kind: 'rename',
    id: 'T001',
    title: 'spaced',
  });
});

test('blocks when there is no target task', () => {
  assert.deepEqual(decideRename(tasks, null, null, 'x'), { kind: 'no-task' });
});

test('blocks an unknown requested id', () => {
  assert.deepEqual(decideRename(tasks, 'T999', 'T001', 'x'), {
    kind: 'unknown-task',
    id: 'T999',
  });
});

test('blocks an empty or whitespace-only title', () => {
  assert.deepEqual(decideRename(tasks, null, 'T001', '   '), { kind: 'empty-title' });
});

test('an unknown id outranks an empty title', () => {
  // Target resolution happens before title validation, so a bad id is reported
  // as such rather than masked by an empty title.
  assert.deepEqual(decideRename(tasks, 'T999', null, '  '), {
    kind: 'unknown-task',
    id: 'T999',
  });
});

test('does not mutate the tasks it is given', () => {
  const snapshot = structuredClone(tasks);
  decideRename(tasks, null, 'T001', 'changed');
  assert.deepEqual(tasks, snapshot);
});
