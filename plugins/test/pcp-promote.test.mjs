import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePromote } from '../pcp_promote.ts';

// Build the minimal stack shape decidePromote reads.
function stack(ids) {
  return { active_task_id: ids.length > 0 ? ids[ids.length - 1] : null, active_stack: ids };
}

test('decidePromote allows promotion from the sprint main (depth 1)', () => {
  assert.deepEqual(decidePromote(stack(['T120'])), { kind: 'allow', activeId: 'T120' });
});

test('decidePromote refuses to nest a promotion under an active subtask', () => {
  const decision = decidePromote(stack(['T120', 'T135']));
  assert.equal(decision.kind, 'nested');
  assert.equal(decision.activeId, 'T135');
  assert.equal(decision.rootId, 'T120');
  assert.equal(decision.depth, 2);
});

test('decidePromote refuses repeated promotion (depth >= 3) and points at the sprint root', () => {
  const decision = decidePromote(stack(['T120', 'T135', 'T136']));
  assert.equal(decision.kind, 'nested');
  assert.equal(decision.activeId, 'T136');
  assert.equal(decision.rootId, 'T120');
  assert.equal(decision.depth, 3);
});

test('decidePromote reports no active sprint when the stack is empty', () => {
  assert.deepEqual(decidePromote(stack([])), { kind: 'no-sprint' });
});
