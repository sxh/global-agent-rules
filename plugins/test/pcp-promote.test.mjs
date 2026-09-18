import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePromote } from '../../pcp/pcp_promote.ts';

// Build the minimal stack shape decidePromote reads.
function stack(ids) {
  return { active_task_id: ids.length > 0 ? ids[ids.length - 1] : null, active_stack: ids };
}

test('enqueues a promotion from the sprint main (depth 1)', () => {
  assert.deepEqual(decidePromote(stack(['T120'])), { kind: 'enqueue', activeId: 'T120' });
});

test('enqueues a promotion from a nested subtask instead of refusing', () => {
  assert.deepEqual(decidePromote(stack(['T120', 'T135'])), { kind: 'enqueue', activeId: 'T135' });
});

test('enqueues a promotion from a deeply nested stack (no LIFO, no refusal)', () => {
  assert.deepEqual(decidePromote(stack(['T120', 'T135', 'T136'])), {
    kind: 'enqueue',
    activeId: 'T136',
  });
});

test('reports no active sprint when the stack is empty', () => {
  assert.deepEqual(decidePromote(stack([])), { kind: 'no-sprint' });
});

test('does not mutate the stack it is given', () => {
  const s = stack(['T120', 'T135']);
  const snapshot = structuredClone(s);
  decidePromote(s);
  assert.deepEqual(s, snapshot);
});
