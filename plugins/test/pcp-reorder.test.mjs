import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReorder, reorderOutcome } from '../../pcp/pcp_reorder.ts';

// The Hannants case: T155 (the blocking fix) sits behind T151-T154 and there is no
// reorder verb. This spec defines the pure decision the pcp_reorder tool will call.
const ORDER = ['T151', 'T152', 'T153', 'T154', 'T155', 'T156'];

function stack(order = ORDER, activeId = 'T150') {
  return {
    active_task_id: activeId,
    ready_tasks: order.map((id) => ({ id, title: `title ${id}` })),
  };
}

const ids = (decision) => decision.order.map((t) => t.id);

test('top moves a queued task to the head', () => {
  const d = decideReorder(stack(), 'T155', { kind: 'top' });
  assert.equal(d.kind, 'reorder');
  assert.deepEqual(ids(d), ['T155', 'T151', 'T152', 'T153', 'T154', 'T156']);
});

test('before moves a task in front of another', () => {
  const d = decideReorder(stack(), 'T151', { kind: 'before', id: 'T153' });
  assert.deepEqual(ids(d), ['T152', 'T151', 'T153', 'T154', 'T155', 'T156']);
});

test('after moves a task behind another', () => {
  const d = decideReorder(stack(), 'T151', { kind: 'after', id: 'T153' });
  assert.deepEqual(ids(d), ['T152', 'T153', 'T151', 'T154', 'T155', 'T156']);
});

test('before/after work when moving a task later in the list', () => {
  const d = decideReorder(stack(), 'T156', { kind: 'before', id: 'T152' });
  assert.deepEqual(ids(d), ['T151', 'T156', 'T152', 'T153', 'T154', 'T155']);
});

test('position is 1-based (position 1 is the head)', () => {
  assert.deepEqual(ids(decideReorder(stack(), 'T156', { kind: 'position', position: 1 })), [
    'T156', 'T151', 'T152', 'T153', 'T154', 'T155',
  ]);
  assert.deepEqual(ids(decideReorder(stack(), 'T151', { kind: 'position', position: 3 })), [
    'T152', 'T153', 'T151', 'T154', 'T155', 'T156',
  ]);
});

test('reports no active sprint when there is none', () => {
  assert.deepEqual(decideReorder(stack(ORDER, null), 'T155', { kind: 'top' }), { kind: 'no-sprint' });
});

test('reports an unknown task id', () => {
  assert.deepEqual(decideReorder(stack(), 'T999', { kind: 'top' }), {
    kind: 'unknown-task',
    id: 'T999',
  });
});

test('reports an unknown anchor id', () => {
  assert.deepEqual(decideReorder(stack(), 'T155', { kind: 'before', id: 'T999' }), {
    kind: 'unknown-anchor',
    id: 'T999',
  });
});

test('rejects an anchor that is the task itself', () => {
  assert.deepEqual(decideReorder(stack(), 'T152', { kind: 'before', id: 'T152' }), {
    kind: 'same-anchor',
    id: 'T152',
  });
});

test('rejects a position outside 1..length', () => {
  assert.deepEqual(decideReorder(stack(), 'T155', { kind: 'position', position: 0 }), {
    kind: 'bad-position',
    position: 0,
  });
  assert.deepEqual(decideReorder(stack(), 'T155', { kind: 'position', position: 99 }), {
    kind: 'bad-position',
    position: 99,
  });
});

test('does not mutate the stack it is given', () => {
  const s = stack();
  const snapshot = structuredClone(s);
  decideReorder(s, 'T155', { kind: 'top' });
  assert.deepEqual(s, snapshot);
});

test('reorder outcome reports the new queue order', () => {
  const d = decideReorder(stack(), 'T155', { kind: 'top' });
  assert.match(reorderOutcome(d, 'T155'), /T155, T151, T152/);
});

test('reorder outcome for no-sprint mentions starting a sprint', () => {
  const d = decideReorder(stack(ORDER, null), 'T155', { kind: 'top' });
  assert.match(reorderOutcome(d, 'T155'), /sprint/i);
});
