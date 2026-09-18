import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastEventSummary } from '../../pcp/task_state.ts';
import { renderTasks } from '../../pcp/status_view.ts';

// E1/B014 reduced: C1 already delivered active/queue/backlog in the tasks view; the remaining
// delta is a "last event" line. lastEventSummary is pure; renderTasks takes it as an optional
// last parameter so existing 4-arg calls are unchanged.
const stack = { active_stack: ['T150'], active_task_id: 'T150', ready_tasks: [] };
const tasks = [{ id: 'T150', type: 'main', title: 'Sprint', done: false }];

test('lastEventSummary is null when there are no events', () => {
  assert.equal(lastEventSummary([]), null);
});

test('lastEventSummary summarises the last event', () => {
  const events = [
    { e: 'created', id: 'T001', type: 'main', title: 'First', ts: 1 },
    { e: 'done', id: 'T001', ts: 2 },
  ];
  assert.match(lastEventSummary(events), /Completed task \[T001\]/);
});

test('renderTasks shows the last event when provided', () => {
  const out = renderTasks(stack, tasks, null, [], 'Completed task [T149]');
  assert.match(out, /🕐 Last: Completed task \[T149\]/);
});

test('renderTasks omits the last event when absent', () => {
  const out = renderTasks(stack, tasks, null, []);
  assert.doesNotMatch(out, /🕐 Last:/);
});
