import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideStart } from '../../pcp/pcp_start.ts';

const idle = { active_task_id: null, ready_tasks: [], next_id: 7 };

test('blocks when a task is already active', () => {
  const stack = { ...idle, active_task_id: 'T003' };
  assert.deepEqual(decideStart(stack, 'new thing'), { kind: 'blocked', activeId: 'T003' });
});

test('advances the ready queue instead of minting a new id when idle', () => {
  // Regression B020: after a pivot with no new_task, active is null but the queue
  // still holds T075/T077. pcp_start must activate T075, not create T078.
  const stack = {
    active_task_id: null,
    ready_tasks: [
      { id: 'T075', title: 'live CSV ingestion boundary' },
      { id: 'T077', title: 'effects extraction' },
    ],
    next_id: 78,
  };
  assert.deepEqual(decideStart(stack, 'ignored title'), {
    kind: 'advance', id: 'T075', title: 'live CSV ingestion boundary',
  });
});

test('creates the next numbered task when idle with an empty queue', () => {
  assert.deepEqual(decideStart(idle, 'brand new work'), {
    kind: 'create', id: 'T007', title: 'brand new work',
  });
});

test('does not mutate the stack it is given', () => {
  const stack = { active_task_id: null, ready_tasks: [{ id: 'T075', title: 'x' }], next_id: 78 };
  const snapshot = structuredClone(stack);
  decideStart(stack, 'y');
  assert.deepEqual(stack, snapshot);
});
