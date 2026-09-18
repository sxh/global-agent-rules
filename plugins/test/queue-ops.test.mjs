import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSwap, decideDemote } from '../../pcp/task_flow.ts';

// B021: two queue verbs that were missing. pcp_swap pauses the active task and promotes a queued
// one in its place; pcp_demote removes a queued task (back to the backlog). Both are pure; the
// handlers own the events, the snapshot rewrite and the backlog status.
const ready = (...ids) => ids.map((id) => ({ id, title: `title ${id}` }));
const stack = (active, readyTasks = []) => ({
  active_stack: active ? [active] : [],
  active_task_id: active,
  ready_tasks: readyTasks,
});

// --- pcp_swap ---
test('decideSwap refuses without an active task', () => {
  assert.deepEqual(decideSwap(stack(null, ready('T151')), 'T151', null), { kind: 'no-sprint' });
});

test('decideSwap refuses while a subtask is active', () => {
  const nested = { active_stack: ['T150', 'T151'], active_task_id: 'T151', ready_tasks: ready('T152') };
  assert.deepEqual(decideSwap(nested, 'T152', 'Sub'), { kind: 'nested' });
});

test('decideSwap reports an unknown queued id', () => {
  assert.deepEqual(decideSwap(stack('T150', ready('T151')), 'T999', 'Main'), {
    kind: 'unknown-task',
    id: 'T999',
  });
});

test('decideSwap reports the task is already active', () => {
  assert.deepEqual(decideSwap(stack('T150', ready('T151')), 'T150', 'Main'), { kind: 'same-task' });
});

test('decideSwap promotes the queued task and pauses the active one at the head', () => {
  const d = decideSwap(stack('T150', ready('T151', 'T152')), 'T151', 'Main');
  assert.deepEqual(d, {
    kind: 'swap',
    newActive: { id: 'T151', title: 'title T151' },
    order: [
      { id: 'T150', title: 'Main' },
      { id: 'T152', title: 'title T152' },
    ],
  });
});

// --- pcp_demote ---
test('decideDemote refuses without an active task', () => {
  assert.deepEqual(decideDemote(stack(null, ready('T151')), 'T151'), { kind: 'no-sprint' });
});

test('decideDemote reports an unknown queued id', () => {
  assert.deepEqual(decideDemote(stack('T150', ready('T151')), 'T999'), {
    kind: 'unknown-task',
    id: 'T999',
  });
});

test('decideDemote refuses to demote the active task', () => {
  assert.deepEqual(decideDemote(stack('T150', ready('T151')), 'T150'), {
    kind: 'active',
    id: 'T150',
  });
});

test('decideDemote removes the queued task and keeps the rest in order', () => {
  assert.deepEqual(decideDemote(stack('T150', ready('T151', 'T152')), 'T151'), {
    kind: 'demote',
    id: 'T151',
    order: [{ id: 'T152', title: 'title T152' }],
  });
});
