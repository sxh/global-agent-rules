import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTaskEvents, formatEventSummary } from '../task_state.ts';

const created = (id, title) => ({ e: 'created', id, type: 'main', title, ts: 1 });

test('a renamed event updates the task title in place', () => {
  const tasks = applyTaskEvents([
    created('T001', 'Listing backlog items'),
    { e: 'renamed', id: 'T001', title: 'PCP: add pcp_rename verb', ts: 2 },
  ]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'PCP: add pcp_rename verb');
});

test('a renamed event does not resurrect an unknown task', () => {
  // B079: the auto-created task was mis-named; renaming must target a real task only.
  const tasks = applyTaskEvents([
    created('T001', 'first'),
    { e: 'renamed', id: 'T999', title: 'ghost', ts: 2 },
  ]);
  assert.deepEqual(
    tasks.map((t) => t.id),
    ['T001'],
  );
});

test('renaming preserves done and pivot state', () => {
  const tasks = applyTaskEvents([
    created('T001', 'first'),
    { e: 'done', id: 'T001', ts: 2 },
    { e: 'renamed', id: 'T001', title: 'second', ts: 3 },
  ]);
  assert.equal(tasks[0].title, 'second');
  assert.equal(tasks[0].done, true);
});

test('a renamed event without a title leaves the title unchanged', () => {
  // Guards against a malformed event log blanking a real task title.
  const tasks = applyTaskEvents([
    created('T001', 'keep me'),
    { e: 'renamed', id: 'T001', ts: 2 },
  ]);
  assert.equal(tasks[0].title, 'keep me');
});

test('replays a sub event as a child task', () => {
  const tasks = applyTaskEvents([
    created('T001', 'parent'),
    { e: 'sub', id: 'T002', title: 'detour', parent: 'T001', ts: 2 },
  ]);
  assert.deepEqual(tasks.find((t) => t.id === 'T002'), {
    id: 'T002',
    type: 'sub',
    title: 'detour',
    parent: 'T001',
    done: false,
  });
});

test('a pivoted event closes the task and records the reason', () => {
  const tasks = applyTaskEvents([
    created('T001', 'first'),
    { e: 'pivoted', id: 'T001', reason: 'superseded', ts: 2 },
  ]);
  assert.equal(tasks[0].done, true);
  assert.equal(tasks[0].pivoted, true);
  assert.equal(tasks[0].pivot_reason, 'superseded');
});

test('a resume_set event records the resume prompt', () => {
  const tasks = applyTaskEvents([
    created('T001', 'first'),
    { e: 'resume_set', id: 'T001', prompt: 'continue at T114', ts: 2 },
  ]);
  assert.equal(tasks[0].resume_prompt, 'continue at T114');
});

test('lifecycle events for an unknown id are ignored', () => {
  const tasks = applyTaskEvents([
    created('T001', 'first'),
    { e: 'done', id: 'T999', ts: 2 },
    { e: 'resume_set', id: 'T999', prompt: 'x', ts: 3 },
  ]);
  assert.deepEqual(
    tasks.map((t) => t.id),
    ['T001'],
  );
  assert.equal(tasks[0].done, false);
});

test('formatEventSummary renders each event type', () => {
  const cases = [
    [{ e: 'created', id: 'T001', title: 'first', ts: 1 }, 'Created main task [T001] first'],
    [{ e: 'sub', id: 'T002', title: 'detour', ts: 2 }, 'Created subtask [T002] detour'],
    [{ e: 'done', id: 'T001', ts: 3 }, 'Completed task [T001]'],
    [{ e: 'pivoted', id: 'T001', reason: 'superseded', ts: 4 }, 'Task [T001] pivoted: superseded'],
    [{ e: 'renamed', id: 'T001', title: 'new name', ts: 5 }, 'Renamed task [T001] new name'],
    [{ e: 'resume_set', id: 'T001', prompt: 'continue', ts: 6 }, 'Updated resume prompt [T001] continue'],
    [{ e: 'project_context', summary: 'java', ts: 7 }, 'Updated project baseline: java'],
    [{ e: 'backlog_add', id: 'B001', title: 'idea', ts: 8 }, 'Logged backlog [B001] idea'],
    [{ e: 'backlog_promote', backlog_id: 'B001', task_id: 'T010', ts: 9 }, 'Promoted backlog [B001] into task [T010]'],
    [{ e: 'backlog_done', backlog_id: 'B001', ts: 10 }, 'Marked backlog [B001] done'],
    [{ e: 'backlog_dismiss', backlog_id: 'B001', ts: 11 }, 'Dismissed backlog [B001]'],
  ];
  for (const [event, expected] of cases) {
    assert.equal(formatEventSummary(event), expected, `event ${event.e}`);
  }
});

test('a pivoted event without a reason uses the fallback text', () => {
  assert.equal(
    formatEventSummary({ e: 'pivoted', id: 'T001', ts: 1 }),
    'Task [T001] pivoted: no reason given',
  );
});

test('an unknown event type falls back to its name', () => {
  assert.equal(formatEventSummary({ e: 'future_thing', ts: 1 }), 'future_thing');
});
