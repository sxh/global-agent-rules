import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noActiveTask, noActiveSprint, noReadyTask } from '../../pcp/guidance.ts';

// E2/B015: a blocked action must name a concrete next step, so a user who hits "no active task"
// is not left stuck. NEXT_STEP is any PCP verb that unblocks them.
const NEXT_STEP = /pcp_plan|pcp_start|pcp_status/;

test('noActiveTask names a way to start work', () => {
  assert.match(noActiveTask(), NEXT_STEP);
});

test('noActiveSprint names how to begin one', () => {
  assert.match(noActiveSprint(), NEXT_STEP);
});

test('noReadyTask names the id and where to look', () => {
  assert.match(noReadyTask('T999'), /\[T999\]/);
  assert.match(noReadyTask('T999'), /pcp_status/);
});
