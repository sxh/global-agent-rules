import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideBacklogAction,
  applyBacklogEvents,
  resolvePlanEntries,
} from '../../pcp/backlog_state.ts';

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

// --- resolvePlanEntries (B100) ---
// pcp_plan accepts a backlog id (e.g. "B099") in its task list. resolvePlanEntries turns that
// into the pending item's title plus its id, so the handler can emit backlog_promote; a plain
// title passes through unlinked. Reusing decideBacklogAction keeps one status guard.
test('resolves a pending backlog id to its title and id', () => {
  assert.deepEqual(resolvePlanEntries(['B001'], items), {
    kind: 'ok',
    entries: [{ title: 'Pending idea', backlogId: 'B001' }],
  });
});

test('passes plain titles through unlinked', () => {
  assert.deepEqual(resolvePlanEntries(['do a thing'], items), {
    kind: 'ok',
    entries: [{ title: 'do a thing' }],
  });
});

test('resolves a mix of titles and backlog ids in order', () => {
  assert.deepEqual(resolvePlanEntries(['A', 'B001'], items), {
    kind: 'ok',
    entries: [{ title: 'A' }, { title: 'Pending idea', backlogId: 'B001' }],
  });
});

test('rejects an unknown backlog id', () => {
  assert.deepEqual(resolvePlanEntries(['B999'], items), {
    kind: 'unknown-backlog',
    id: 'B999',
  });
});

test('rejects a non-pending backlog id with its status', () => {
  assert.deepEqual(resolvePlanEntries(['B003'], items), {
    kind: 'not-pending-backlog',
    id: 'B003',
    status: 'promoted',
  });
});

test('does not mutate the backlog it is given', () => {
  const snapshot = structuredClone(items);
  resolvePlanEntries(['B001'], items);
  assert.deepEqual(items, snapshot);
});
