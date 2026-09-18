import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverStackFromEvents } from '../../pcp/stack_state.ts';

// R1 (Future 1): stack.json stays the source of truth, but if it is lost or corrupt the task
// list must not vanish. recoverStackFromEvents rebuilds a workable stack from the event-derived
// tasks: the newest open task becomes active, the rest queue in creation order.
const t = (id, extra = {}) => ({ id, type: 'main', title: `title ${id}`, done: false, ...extra });

test('recovers an empty stack when there are no tasks', () => {
  assert.deepEqual(recoverStackFromEvents([]), {
    next_id: 1,
    backlog_next_id: 1,
    active_stack: [],
    active_task_id: null,
    ready_tasks: [],
  });
});

test('makes the newest open task active and queues the rest in order', () => {
  const s = recoverStackFromEvents([t('T001'), t('T002'), t('T003')]);
  assert.equal(s.active_task_id, 'T003');
  assert.deepEqual(s.active_stack, ['T003']);
  assert.deepEqual(s.ready_tasks.map((r) => r.id), ['T001', 'T002']);
  assert.equal(s.next_id, 4);
});

test('ignores completed tasks', () => {
  const s = recoverStackFromEvents([t('T001', { done: true }), t('T002')]);
  assert.equal(s.active_task_id, 'T002');
  assert.deepEqual(s.ready_tasks, []);
});

test('has no active task when everything is done', () => {
  const s = recoverStackFromEvents([t('T001', { done: true })]);
  assert.equal(s.active_task_id, null);
  assert.deepEqual(s.active_stack, []);
  assert.deepEqual(s.ready_tasks, []);
  assert.equal(s.next_id, 2);
});

test('next_id follows the highest numeric id, not the count', () => {
  const s = recoverStackFromEvents([t('T010'), t('T007')]);
  assert.equal(s.next_id, 11);
});
