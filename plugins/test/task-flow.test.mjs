import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideSubStart,
  decidePlan,
  decidePivot,
  decideAutoCreate,
} from '../../pcp/task_flow.ts';

// B020: the last inline transitions in plugins/pcp.ts (pcp_sub, pcp_plan, pcp_pivot,
// autoCreateTask) move into pure decisions. Each test pins one branch; the handlers keep their
// own events, messages and mutations.

// --- pcp_sub ---
test('decideSubStart refuses without an active task', () => {
  assert.deepEqual(decideSubStart({ active_task_id: null, next_id: 5 }, 'x', null), {
    kind: 'no-active',
  });
});

test('decideSubStart allocates the subtask id and a resume prompt', () => {
  const d = decideSubStart({ active_task_id: 'T150', next_id: 151 }, 'Fix bug', 'Main task');
  assert.equal(d.kind, 'start');
  assert.equal(d.parentId, 'T150');
  assert.equal(d.newId, 'T151');
  assert.match(d.resumePrompt, /Fix bug/);
  assert.match(d.resumePrompt, /Main task/);
});

// --- pcp_plan ---
test('decidePlan reports an empty list', () => {
  assert.deepEqual(decidePlan({ active_task_id: null, next_id: 1 }, []), { kind: 'empty' });
});

test('decidePlan starts the first and queues the rest when idle', () => {
  assert.deepEqual(decidePlan({ active_task_id: null, next_id: 5 }, ['A', 'B']), {
    kind: 'start',
    first: { id: 'T005', title: 'A' },
    rest: [{ id: 'T006', title: 'B' }],
  });
});

test('decidePlan enqueues everything when a task is active', () => {
  assert.deepEqual(decidePlan({ active_task_id: 'T150', next_id: 5 }, ['A', 'B']), {
    kind: 'enqueue',
    created: [
      { id: 'T005', title: 'A' },
      { id: 'T006', title: 'B' },
    ],
  });
});

// --- pcp_pivot ---
test('decidePivot refuses without an active task', () => {
  assert.deepEqual(decidePivot({ active_task_id: null, next_id: 5 }), { kind: 'no-active' });
});

test('decidePivot without a new task allocates no id', () => {
  assert.deepEqual(decidePivot({ active_task_id: 'T150', next_id: 5 }), {
    kind: 'pivot',
    pivotId: 'T150',
    newId: null,
  });
});

test('decidePivot with a new task allocates its id', () => {
  assert.deepEqual(decidePivot({ active_task_id: 'T150', next_id: 5 }, 'New direction'), {
    kind: 'pivot',
    pivotId: 'T150',
    newId: 'T005',
  });
});

// --- autoCreateTask ---
test('decideAutoCreate skips when a task is already active', () => {
  const stack = { active_task_id: 'T150', ready_tasks: [], next_id: 5, last_done_ts: 0 };
  assert.deepEqual(decideAutoCreate(stack, 10_000), { kind: 'skip-active' });
});

test('decideAutoCreate skips just after a task was done', () => {
  const stack = { active_task_id: null, ready_tasks: [], next_id: 5, last_done_ts: 10_000 };
  assert.deepEqual(decideAutoCreate(stack, 10_500), { kind: 'skip-recent' });
});

test('decideAutoCreate advances from the ready queue', () => {
  const stack = {
    active_task_id: null,
    ready_tasks: [{ id: 'T151', title: 'Next' }],
    next_id: 152,
    last_done_ts: 0,
  };
  assert.deepEqual(decideAutoCreate(stack, 10_000), {
    kind: 'advance',
    next: { id: 'T151', title: 'Next' },
  });
});

test('decideAutoCreate creates a new task when idle with an empty queue', () => {
  const stack = { active_task_id: null, ready_tasks: [], next_id: 5, last_done_ts: undefined };
  assert.deepEqual(decideAutoCreate(stack, 10_000), { kind: 'create', newId: 'T005' });
});
