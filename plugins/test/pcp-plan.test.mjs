import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEvents } from '../../pcp/task_flow.ts';

// B100: pcp_plan must consume backlog ids — for every planned task that resolves from a
// backlog item, the handler appends a backlog_promote event so the item stops being pending.
// planEvents is the pure event list the handler appends; pinning it keeps the emission unit-
// tested without importing plugins/pcp.ts (which node --test cannot load).

test('planEvents emits a created event per task, in order', () => {
  assert.deepEqual(
    planEvents(
      [
        { id: 'T005', title: 'A' },
        { id: 'T006', title: 'B' },
      ],
      1234,
    ),
    [
      { e: 'created', id: 'T005', type: 'main', title: 'A', ts: 1234 },
      { e: 'created', id: 'T006', type: 'main', title: 'B', ts: 1234 },
    ],
  );
});

test('planEvents emits backlog_promote for an id-linked task', () => {
  assert.deepEqual(planEvents([{ id: 'T005', title: 'A', backlogId: 'B099' }], 1234), [
    { e: 'created', id: 'T005', type: 'main', title: 'A', ts: 1234 },
    { e: 'backlog_promote', backlog_id: 'B099', task_id: 'T005', ts: 1234 },
  ]);
});

test('planEvents emits no backlog_promote for plain title tasks', () => {
  const events = planEvents([{ id: 'T005', title: 'A' }, { id: 'T006', title: 'B' }], 7);
  assert.equal(events.filter((e) => e.e === 'backlog_promote').length, 0);
});

test('planEvents emits all created events before the backlog_promote events', () => {
  const events = planEvents(
    [
      { id: 'T005', title: 'A', backlogId: 'B099' },
      { id: 'T006', title: 'B' },
    ],
    0,
  );
  assert.deepEqual(events.map((e) => e.e), ['created', 'created', 'backlog_promote']);
});
