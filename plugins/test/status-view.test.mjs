import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTasks, renderBacklog, renderHistory } from '../../pcp/status_view.ts';

// The three read-only views (pcp_status / pcp_backlog / pcp_history) collapse into these
// pure renderers so their formatting is testable without importing the plugin. Assert on
// key content lines, not byte-exact strings, so emoji/spacing changes stay cheap.

const task = (id, title, extra = {}) => ({ id, type: 'main', title, done: false, ...extra });
const stack = (active, ready = []) => ({
  active_stack: active ? [active] : [],
  active_task_id: active,
  ready_tasks: ready,
});

test('renderTasks shows the active stack, queue and backlog count', () => {
  const out = renderTasks(
    stack('T150', [{ id: 'T151', title: 'Queued' }]),
    [task('T150', 'Sprint')],
    null,
    [{ id: 'B001', title: 'Idea' }],
  );
  assert.match(out, /\[main\] T150 Sprint {2}← current/);
  assert.match(out, /⏳ Queue \(1\)/);
  assert.match(out, /T151: Queued/);
  assert.match(out, /📋 Backlog: 1 item\(s\) pending review/);
});

test('renderTasks handles no active task with a queue and backlog', () => {
  const out = renderTasks(
    stack(null, [{ id: 'T151', title: 'Queued' }]),
    [],
    null,
    [{ id: 'B001', title: 'Idea' }],
  );
  assert.match(out, /No active task\./);
  assert.match(out, /⏳ 1 queued task\(s\) waiting:/);
  assert.match(out, /Backlog has 1 item\(s\) pending review; see pcp_backlog\./);
  assert.match(out, /have the planner lay out tasks/);
});

test('renderTasks prefixes the project baseline when present', () => {
  const out = renderTasks(stack('T150'), [task('T150', 'Sprint')], 'aircraft web', []);
  assert.match(out, /^\[Project\] aircraft web/);
});

test('renderBacklog reports an empty backlog', () => {
  assert.equal(renderBacklog([]), '📋 Backlog is empty.');
});

test('renderBacklog lists pending items and their detail', () => {
  const out = renderBacklog([
    { id: 'B001', title: 'Idea', status: 'pending' },
    { id: 'B002', title: 'With detail', detail: 'more context', status: 'pending' },
  ]);
  assert.match(out, /📋 Backlog \(2\):/);
  assert.match(out, /B001: Idea/);
  assert.match(out, /B002: With detail/);
  assert.match(out, /more context/);
});

test('renderHistory lists sprints, in-progress, queue and full backlog', () => {
  const tasks = [
    task('T001', 'Sprint A', { done: true }),
    task('T002', 'Sprint B', { done: true, pivoted: true, pivot_reason: 'better idea' }),
    task('T150', 'Sprint C'),
  ];
  const out = renderHistory(
    tasks,
    stack('T150', [{ id: 'T151', title: 'Queued' }]),
    [
      { id: 'B001', title: 'Idea', status: 'pending' },
      { id: 'B002', title: 'Old', status: 'done' },
    ],
    20,
  );
  assert.match(out, /=== Completed sprints ===/);
  assert.match(out, /✅ T001 {2}Sprint A/);
  assert.match(out, /🔄 T002 {2}Sprint B {2}\(pivot: better idea\)/);
  assert.match(out, /=== In progress ===/);
  assert.match(out, /📌 \[main\] T150 {2}Sprint C {2}← current/);
  assert.match(out, /=== Queue ===/);
  assert.match(out, /⏳ T151 {2}Queued/);
  assert.match(out, /=== Backlog ===/);
  assert.match(out, /📝 B001 {2}Idea/);
  assert.match(out, /✅ B002 {2}Old \(done\)/);
});

test('renderHistory honours the limit on completed sprints', () => {
  const tasks = [
    task('T001', 'A', { done: true }),
    task('T002', 'B', { done: true }),
    task('T003', 'C', { done: true }),
  ];
  const out = renderHistory(tasks, stack(null), [], 1);
  assert.doesNotMatch(out, /T001/);
  assert.doesNotMatch(out, /T002/);
  assert.match(out, /T003/);
});

test('renderHistory reports no records when everything is empty', () => {
  assert.equal(renderHistory([], stack(null), [], 20), 'No records yet.');
});
