import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBacklogEvents, pendingBacklog } from '../backlog_state.ts';

const add = (id, title) => ({ e: 'backlog_add', id, title, ts: 1 });

test('a backlog_done event marks the item done and drops it from pending', () => {
  const items = applyBacklogEvents([
    add('B001', 'first'),
    add('B002', 'second'),
    { e: 'backlog_done', backlog_id: 'B001', ts: 2 },
  ]);
  assert.equal(items.find((i) => i.id === 'B001')?.status, 'done');
  assert.deepEqual(pendingBacklog(items).map((i) => i.id), ['B002']);
});

test('a done item is kept in history, not deleted', () => {
  const items = applyBacklogEvents([
    add('B001', 'first'),
    { e: 'backlog_done', backlog_id: 'B001', ts: 2 },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'first');
});

test('backlog_done only affects the targeted item', () => {
  const items = applyBacklogEvents([
    add('B001', 'first'),
    add('B002', 'second'),
    { e: 'backlog_done', backlog_id: 'B002', ts: 2 },
  ]);
  assert.deepEqual(pendingBacklog(items).map((i) => i.id), ['B001']);
});

test('promote and dismiss still drive the lifecycle', () => {
  const items = applyBacklogEvents([
    add('B001', 'first'),
    add('B002', 'second'),
    add('B003', 'third'),
    { e: 'backlog_promote', backlog_id: 'B001', task_id: 'T010', ts: 2 },
    { e: 'backlog_dismiss', backlog_id: 'B002', ts: 3 },
  ]);
  assert.equal(items.find((i) => i.id === 'B001')?.status, 'promoted');
  assert.equal(items.find((i) => i.id === 'B001')?.promoted_to, 'T010');
  assert.equal(items.find((i) => i.id === 'B002')?.status, 'dismissed');
  assert.deepEqual(pendingBacklog(items).map((i) => i.id), ['B003']);
});
