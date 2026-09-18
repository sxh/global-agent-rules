import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseStack } from '../../pcp/stack_state.ts';

// Compatibility corpus for the stack reader. Every fixture mirrors a shape found in the A0
// inventory of ~/projects: all 18 state dirs are schema v0 (no schema_version), only
// stack.json + events.jsonl are universal, and some dirs predate fields like
// backlog_next_id / ready_tasks. The pure parseStack is the exact logic readStack uses.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', 'stack', name), 'utf8');

const EMPTY = {
  next_id: 1,
  backlog_next_id: 1,
  active_stack: [],
  active_task_id: null,
  ready_tasks: [],
};

test('parses the full v0 shape', () => {
  const s = parseStack(fixture('full-v0.json'));
  assert.equal(s.next_id, 157);
  assert.equal(s.backlog_next_id, 82);
  assert.deepEqual(s.active_stack, ['T150']);
  assert.equal(s.active_task_id, 'T150');
  assert.deepEqual(s.ready_tasks.map((t) => t.id), ['T151', 'T152']);
  assert.equal(s.last_done_ts, 1789734677368);
});

test('defaults fields missing from a legacy stack', () => {
  const s = parseStack(fixture('legacy-missing-fields.json'));
  assert.equal(s.next_id, 5);
  assert.equal(s.backlog_next_id, 1);
  assert.deepEqual(s.ready_tasks, []);
  assert.equal(s.active_task_id, 'T001');
});

test('parses an empty stack (active null)', () => {
  const s = parseStack(fixture('empty-stack.json'));
  assert.equal(s.active_task_id, null);
  assert.deepEqual(s.active_stack, []);
  assert.deepEqual(s.ready_tasks, []);
});

test('parses a minimal single-task stack', () => {
  const s = parseStack(fixture('minimal-single-task.json'));
  assert.deepEqual(s.active_stack, ['T001']);
  assert.equal(s.active_task_id, 'T001');
});

test('tolerates unknown/forward-compatible fields', () => {
  const s = parseStack(fixture('extra-fields.json'));
  assert.equal(s.active_task_id, 'T001');
  assert.equal(s.schema_version, 1);
  assert.equal(s.future_field, 'ignored');
});

test('falls back to empty defaults on corrupt JSON', () => {
  assert.deepEqual(parseStack(fixture('corrupt.json')), EMPTY);
});

test('returns fresh defaults so callers cannot share mutated state', () => {
  const first = parseStack('{ nope');
  first.ready_tasks.push({ id: 'TX', title: 'leak' });
  assert.deepEqual(parseStack('{ nope'), EMPTY);
});
