import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNPLANNED_EDIT_WARNING,
  applyUnplannedEditWarning,
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

const base = {
  activeTaskId: null,
  readyTaskCount: 0,
  warned: false,
  pcpManaged: true,
  output: 'edited',
};

test('applies the warning to the output once', () => {
  assert.deepEqual(applyUnplannedEditWarning(base), {
    output: `edited${UNPLANNED_EDIT_WARNING}`,
    warned: true,
  });
});

test('leaves the output alone when already warned', () => {
  assert.deepEqual(applyUnplannedEditWarning({ ...base, warned: true }), {
    output: 'edited',
    warned: true,
  });
});

test('leaves a non-PCP project alone', () => {
  assert.deepEqual(applyUnplannedEditWarning({ ...base, pcpManaged: false }), {
    output: 'edited',
    warned: false,
  });
});

test('leaves the output alone when a task is active or queued', () => {
  assert.deepEqual(
    applyUnplannedEditWarning({ ...base, activeTaskId: 'T001' }),
    { output: 'edited', warned: false },
  );
  assert.deepEqual(
    applyUnplannedEditWarning({ ...base, readyTaskCount: 1 }),
    { output: 'edited', warned: false },
  );
});
