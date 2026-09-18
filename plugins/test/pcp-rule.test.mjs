import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PCP_RULE } from '../../pcp/pcp_rule.ts';

test('PCP_RULE states the batch-loading guidance', () => {
  assert.match(PCP_RULE, /Batch-load/);
  assert.match(PCP_RULE, /pcp_plan/);
  assert.match(PCP_RULE, /pcp_promote/);
  assert.match(PCP_RULE, /FIFO/);
});

test('PCP_RULE states the post-pivot queue-advance guidance', () => {
  assert.match(PCP_RULE, /pcp_start/);
  assert.match(PCP_RULE, /pivot/i);
  assert.match(PCP_RULE, /queue/i);
});

test('PCP_RULE states the pcp_done-first closing protocol', () => {
  assert.match(PCP_RULE, /pcp_done before/i);
  assert.match(PCP_RULE, /\.opencode\/pcp/);
  assert.match(PCP_RULE, /one commit/i);
  assert.match(PCP_RULE, /PCP-Task/);
});
