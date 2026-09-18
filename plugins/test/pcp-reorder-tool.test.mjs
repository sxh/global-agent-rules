import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorFromArgs, runReorder } from '../../pcp/pcp_reorder.ts';

// The tool handler's untested part: turning tool args into an anchor, then applying the
// decision. runReorder takes injected effects so the queue write and audit log are
// observable without importing the plugin (whose runtime `.js` specifiers node cannot
// resolve) or touching a real .opencode/pcp directory.
const ORDER = ['T151', 'T152', 'T153', 'T154', 'T155', 'T156'];

function stack(order = ORDER, activeId = 'T150') {
  return {
    active_task_id: activeId,
    ready_tasks: order.map((id) => ({ id, title: `title ${id}` })),
  };
}

function spies() {
  const calls = [];
  return {
    calls,
    writeOrder: (order) => calls.push(['write', order.map((t) => t.id)]),
    log: (message) => calls.push(['log', message]),
  };
}

test('anchorFromArgs parses each anchor form', () => {
  assert.deepEqual(anchorFromArgs({ id: 'T155', top: true }), { kind: 'top' });
  assert.deepEqual(anchorFromArgs({ id: 'T155', position: 2 }), { kind: 'position', position: 2 });
  assert.deepEqual(anchorFromArgs({ id: 'T155', before: 'T151' }), { kind: 'before', id: 'T151' });
  assert.deepEqual(anchorFromArgs({ id: 'T155', after: 'T151' }), { kind: 'after', id: 'T151' });
});

test('anchorFromArgs rejects zero anchors', () => {
  assert.equal(anchorFromArgs({ id: 'T155' }), null);
});

test('anchorFromArgs rejects more than one anchor', () => {
  assert.equal(anchorFromArgs({ id: 'T155', top: true, position: 1 }), null);
});

test('anchorFromArgs treats top: false as absent', () => {
  assert.equal(anchorFromArgs({ id: 'T155', top: false }), null);
});

test('runReorder writes the reordered queue, logs once, and does not mutate the stack', () => {
  const s = stack();
  const snapshot = structuredClone(s);
  const sp = spies();

  const message = runReorder(s, { id: 'T155', top: true }, sp);

  assert.deepEqual(sp.calls[0], ['write', ['T155', 'T151', 'T152', 'T153', 'T154', 'T156']]);
  assert.equal(sp.calls.filter((c) => c[0] === 'log').length, 1);
  assert.match(message, /T155, T151, T152/);
  assert.deepEqual(s, snapshot);
});

test('runReorder writes nothing for a bad anchor set', () => {
  const sp = spies();
  const message = runReorder(stack(), { id: 'T155' }, sp);
  assert.equal(sp.calls.length, 0);
  assert.match(message, /exactly one anchor/);
});

test('runReorder writes nothing for an unknown task', () => {
  const sp = spies();
  const message = runReorder(stack(), { id: 'T999', top: true }, sp);
  assert.equal(sp.calls.length, 0);
  assert.match(message, /No ready task \[T999\]/);
  assert.match(message, /pcp_status/);
});

test('runReorder writes nothing without an active sprint', () => {
  const sp = spies();
  const message = runReorder(stack(ORDER, null), { id: 'T155', top: true }, sp);
  assert.equal(sp.calls.length, 0);
  assert.match(message, /sprint/i);
});
