import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNPLANNED_EDIT_WARNING,
  unplannedEditWarning,
} from '../../pcp/unplanned_edit.ts';

test('warns when no task is active and none is queued', () => {
  assert.equal(unplannedEditWarning(null, 0), UNPLANNED_EDIT_WARNING);
  assert.match(unplannedEditWarning(undefined, 0), /No active task/);
});

test('stays silent when a task is active', () => {
  assert.equal(unplannedEditWarning('T001', 0), null);
});

test('stays silent when a queued task can be auto-advanced', () => {
  assert.equal(unplannedEditWarning(null, 1), null);
});
