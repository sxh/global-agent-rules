import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PCP_RULE } from '../pcp_rule.ts';

test('PCP_RULE states the batch-loading guidance in both languages', () => {
  assert.match(PCP_RULE, /pcp_plan/);
  assert.match(PCP_RULE, /pcp_promote/);
  assert.match(PCP_RULE, /批量/);
  assert.match(PCP_RULE, /Batch-load/);
});

test('PCP_RULE states the post-pivot queue-advance guidance in both languages', () => {
  assert.match(PCP_RULE, /pcp_start/);
  assert.match(PCP_RULE, /pivot/i);
  assert.match(PCP_RULE, /队列/);
  assert.match(PCP_RULE, /queue/i);
});

test('PCP_RULE keeps the commit-trailer requirement', () => {
  assert.match(PCP_RULE, /PCP-Task/);
});
