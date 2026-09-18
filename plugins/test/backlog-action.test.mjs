import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBacklogAction, applyBacklogEvents } from '../../pcp/backlog_state.ts';

// pcp_promote / pcp_dismiss / pcp_backlog_done each duplicated the same backlog lookup and
// status guard. decideBacklogAction is the single pure implementation; each verb keeps its
// own message wording. (pcp_done is task lifecycle, not a backlog action, and is untouched.)
const items = [
  { id: 'B001', title: 'Pending idea', status: 'pending' },
  { id: 'B002', title: 'Old', status: 'done' },
  { id: 'B003', title: 'Promoted', status: 'promoted', promoted_to: 'T001' },
  { id: 'B004', title: 'Nope', status: 'dismissed' },
];

test('returns the item when it is pending', () => {
  const d = decideBacklogAction(items, 'B001');
  assert.equal(d.kind, 'ok');
  assert.equal(d.item.id, 'B001');
});

test('reports an unknown id', () => {
  assert.deepEqual(decideBacklogAction(items, 'B999'), { kind: 'unknown', id: 'B999' });
});

test('reports a non-pending item with its status', () => {
  assert.deepEqual(decideBacklogAction(items, 'B002'), {
    kind: 'not-pending',
    id: 'B002',
    status: 'done',
  });
  assert.deepEqual(decideBacklogAction(items, 'B003'), {
    kind: 'not-pending',
    id: 'B003',
    status: 'promoted',
  });
  assert.deepEqual(decideBacklogAction(items, 'B004'), {
    kind: 'not-pending',
    id: 'B004',
    status: 'dismissed',
  });
});

test('does not mutate the backlog it is given', () => {
  const snapshot = structuredClone(items);
  decideBacklogAction(items, 'B001');
  assert.deepEqual(items, snapshot);
});

test('operates on a replayed backlog', () => {
  const replayed = applyBacklogEvents([
    { e: 'backlog_add', id: 'B010', title: 'X', ts: 1 },
    { e: 'backlog_done', backlog_id: 'B010', ts: 2 },
  ]);
  assert.deepEqual(decideBacklogAction(replayed, 'B010'), {
    kind: 'not-pending',
    id: 'B010',
    status: 'done',
  });
});
