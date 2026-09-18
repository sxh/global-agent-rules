import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideTaskDone } from '../../pcp/pcp_done.ts';

// The done/advance rule was inline in pcp_done and duplicated in the autoDoneTask hook.
// decideTaskDone is the single pure rule; the handlers keep their own events and messages.
const stack = (active_stack, ready = []) => ({
  active_stack,
  active_task_id: active_stack.length > 0 ? active_stack[active_stack.length - 1] : null,
  ready_tasks: ready,
});

test('reports no task when nothing is active', () => {
  assert.deepEqual(decideTaskDone(stack([])), { kind: 'no-task' });
});

test('returns to the parent when a subtask completes', () => {
  assert.deepEqual(decideTaskDone(stack(['T150', 'T151'])), { kind: 'sub-return', parentId: 'T150' });
});

test('returns to the immediate parent at deeper nesting', () => {
  assert.deepEqual(decideTaskDone(stack(['T150', 'T151', 'T152'])), {
    kind: 'sub-return',
    parentId: 'T151',
  });
});

test('advances from the queue when a main task completes', () => {
  assert.deepEqual(
    decideTaskDone(stack(['T150'], [
      { id: 'T151', title: 'Next' },
      { id: 'T152', title: 'Later' },
    ])),
    { kind: 'advance', nextId: 'T151', nextTitle: 'Next', remaining: 1 },
  );
});

test('reports remaining 0 when the advancing task is the last', () => {
  assert.deepEqual(
    decideTaskDone(stack(['T150'], [{ id: 'T151', title: 'Last' }])),
    { kind: 'advance', nextId: 'T151', nextTitle: 'Last', remaining: 0 },
  );
});

test('reports all-done when there is no parent and no queue', () => {
  assert.deepEqual(decideTaskDone(stack(['T150'])), { kind: 'all-done' });
});

test('does not mutate the stack it is given', () => {
  const s = stack(['T150'], [{ id: 'T151', title: 'Next' }]);
  const snapshot = structuredClone(s);
  decideTaskDone(s);
  assert.deepEqual(s, snapshot);
});
