import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureRefusal,
  closeRefusal,
  itemsCreatedSince,
  taskStartedAt,
  touchedPathsNamed,
  unrecordedDeferrals,
} from '../../pcp/deferral.ts';

// A task that opens a file and then records the leftover as a backlog item has not
// finished the work; the item is a deferral, and a deferral without a reason is a
// private decision. These two guards (pcp_capture, pcp_done) share this module's
// judgement, so the rule is written once and tested against examples rather than
// against a tool call.

const TOUCHED = [
  'packages/web/src/components/project/ProjectDetailComponents.tsx',
  'packages/web/src/components/project/PaintSummary.tsx',
  'packages/web/src/hooks/useDisclosure.ts',
];

test('names a touched file by its full path', () => {
  const text = 'ProjectDetailComponents.tsx renders the header';

  assert.deepEqual(touchedPathsNamed(text, TOUCHED), [
    'packages/web/src/components/project/ProjectDetailComponents.tsx',
  ]);
});

test('names a touched file by its basename, the way a note about it reads', () => {
  assert.deepEqual(touchedPathsNamed('the region in PaintSummary', TOUCHED), [
    'packages/web/src/components/project/PaintSummary.tsx',
  ]);
});

test('reports every touched file the text names, in the order they were touched', () => {
  const text = 'PaintSummary and useDisclosure both need it';

  assert.deepEqual(touchedPathsNamed(text, TOUCHED), [
    'packages/web/src/components/project/PaintSummary.tsx',
    'packages/web/src/hooks/useDisclosure.ts',
  ]);
});

test('ignores a basename too common to prove which file was meant', () => {
  const touched = ['packages/web/src/index.ts', 'packages/functions/src/types.ts'];

  assert.deepEqual(touchedPathsNamed('update index.ts and types.ts', touched), []);
});

test('still matches a generic basename when the note gives its path', () => {
  const touched = ['packages/web/src/index.ts'];

  assert.deepEqual(touchedPathsNamed('packages/web/src/index.ts loses the export', touched), touched);
});

test('matches nothing when the note is about unrelated work', () => {
  assert.deepEqual(touchedPathsNamed('add a deploy workflow', TOUCHED), []);
});

test('matches nothing when the task touched no files', () => {
  assert.deepEqual(touchedPathsNamed('PaintSummary', []), []);
});

test('finds the moment the task began from the event log', () => {
  const events = [
    { e: 'created', id: 'T001', ts: 100 },
    { e: 'done', id: 'T001', ts: 200 },
    { e: 'created', id: 'T002', ts: 300 },
    { e: 'sub', id: 'T003', parent: 'T002', ts: 400 },
  ];

  assert.equal(taskStartedAt(events, 'T002'), 300);
  assert.equal(taskStartedAt(events, 'T003'), 400);
  assert.equal(taskStartedAt(events, 'T999'), null);
  assert.equal(taskStartedAt(events, null), null);
});

test('ranks items added during the task, and only those', () => {
  const events = [
    { e: 'backlog_add', id: 'B001', title: 'Older idea', ts: 50 },
    { e: 'created', id: 'T002', ts: 300 },
    { e: 'backlog_add', id: 'B002', title: 'Found while working', detail: 'in PaintSummary', ts: 350 },
  ];

  assert.deepEqual(
    itemsCreatedSince(events, taskStartedAt(events, 'T002')).map((item) => item.id),
    ['B002'],
  );
});

test('cannot attribute anything when the task start is unknown, so it blocks nothing', () => {
  const events = [{ e: 'backlog_add', id: 'B001', title: 'in PaintSummary', ts: 350 }];

  assert.deepEqual(itemsCreatedSince(events, null), []);
});

test('an item the author dismissed no longer blocks the task', () => {
  const events = [
    { e: 'created', id: 'T002', ts: 300 },
    { e: 'backlog_add', id: 'B002', title: 'in PaintSummary', ts: 350 },
    { e: 'backlog_dismiss', id: 'B002', ts: 360 },
  ];

  assert.deepEqual(itemsCreatedSince(events, taskStartedAt(events, 'T002')), []);
});

test('an item promoted into the queue is a visible plan step, not a hidden deferral', () => {
  const events = [
    { e: 'created', id: 'T002', ts: 300 },
    { e: 'backlog_add', id: 'B002', title: 'in PaintSummary', ts: 350 },
    { e: 'backlog_promote', id: 'B002', backlog_id: 'B002', ts: 360 },
  ];

  assert.deepEqual(itemsCreatedSince(events, taskStartedAt(events, 'T002')), []);
});

test('an item done during the task is finished, not deferred', () => {
  const events = [
    { e: 'created', id: 'T002', ts: 300 },
    { e: 'backlog_add', id: 'B002', title: 'in PaintSummary', ts: 350 },
    { e: 'backlog_done', id: 'B002', ts: 360 },
  ];

  assert.deepEqual(itemsCreatedSince(events, taskStartedAt(events, 'T002')), []);
});

test('a deferral that names a file the task changed is the finding', () => {
  const items = [
    { id: 'B297', title: 'Project header toggle', detail: 'ProjectDetailComponents.tsx line 47' },
    { id: 'B298', title: 'design-system gate', detail: 'no file named here' },
  ];

  assert.deepEqual(unrecordedDeferrals(items, TOUCHED), [
    {
      id: 'B297',
      title: 'Project header toggle',
      paths: ['packages/web/src/components/project/ProjectDetailComponents.tsx'],
    },
  ]);
});

test('a deferral with a recorded reason is a decision, not a finding', () => {
  const items = [
    {
      id: 'B297',
      title: 'Project header toggle',
      detail: 'ProjectDetailComponents.tsx line 47',
      reason: 'blocked on the picker gaining a stable id from its owner',
    },
  ];

  assert.deepEqual(unrecordedDeferrals(items, TOUCHED), []);
});

// One message per refusal, shared by pcp_capture, pcp_done and the commit-trailer
// auto-close, so the rule is stated the same way whichever path asks.

test('the capture refusal names the file and the only way past it', () => {
  const message = captureRefusal('PaintSummary needs a note', 'see PaintSummary', TOUCHED);

  assert.match(message ?? '', /pcp_capture refused/);
  assert.match(message ?? '', /PaintSummary\.tsx/);
  assert.match(message ?? '', /defer_reason/);
  assert.match(message ?? '', /Nothing was recorded/);
});

test('the capture refusal is silent when the item names no changed file', () => {
  assert.equal(captureRefusal('add a deploy workflow', undefined, TOUCHED), null);
});

test('the close refusal names every deferral and its file', () => {
  const events = [
    { e: 'created', id: 'T411', ts: 100 },
    { e: 'backlog_add', id: 'B297', title: 'Project header toggle', detail: 'ProjectDetailComponents.tsx', ts: 200 },
    { e: 'backlog_add', id: 'B301', title: 'PaintSummary heading', detail: 'PaintSummary', ts: 210 },
  ];

  const message = closeRefusal(events, 'T411', TOUCHED);

  assert.match(message ?? '', /refuses to close this task/);
  assert.match(message ?? '', /\[B297\]/);
  assert.match(message ?? '', /\[B301\]/);
  assert.match(message ?? '', /ProjectDetailComponents\.tsx/);
  assert.match(message ?? '', /defer_reason/);
});

test('the close refusal is silent once every deferral carries a reason', () => {
  const events = [
    { e: 'created', id: 'T411', ts: 100 },
    { e: 'backlog_add', id: 'B297', title: 'Project header toggle', detail: 'ProjectDetailComponents.tsx', reason: 'needs an id from the picker', ts: 200 },
  ];

  assert.equal(closeRefusal(events, 'T411', TOUCHED), null);
});
