import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PCP_RULE } from '../../pcp/pcp_rule.ts';

// C4/B010: the always-injected rule is now a short constant trigger; the stable policy lives in
// the pcp-operations skill. These tests guard the split — the trigger points at the skill, stays
// small, keeps the non-negotiable closing line, carries no volatile state — and assert the skill
// actually received the moved policy. (The trigger must stay constant: a changing system array
// invalidates the prompt cache, see the PCP_CACHE_FIX note in plugins/pcp.ts.)
const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(here, '..', '..', 'skills', 'pcp-operations', 'SKILL.md'),
  'utf8',
);

test('PCP_RULE points agents at the pcp-operations skill', () => {
  assert.match(PCP_RULE, /pcp-operations/);
  assert.match(PCP_RULE, /skill/i);
});

test('PCP_RULE stays a short constant trigger (anti-rebloat)', () => {
  assert.ok(PCP_RULE.length <= 400, `rule is ${PCP_RULE.length} chars (limit 400)`);
});

test('PCP_RULE keeps the non-negotiable close-before-commit line', () => {
  assert.match(PCP_RULE, /pcp_done before/i);
  assert.match(PCP_RULE, /\.opencode\/pcp/);
});

test('PCP_RULE carries no volatile state', () => {
  assert.doesNotMatch(PCP_RULE, /T\d{3}/);
});

test('the pcp-operations skill carries the moved policy', () => {
  assert.match(skill, /2 ?h/, 'granularity budget');
  assert.match(skill, /granular/i);
  assert.match(skill, /pcp_sub/, 'subtask limits');
  assert.match(skill, /completion review/i);
  assert.match(skill, /pcp_capture/, 'capture triggers');
  assert.match(skill, /pcp_pivot/, 'pivot triggers');
  assert.match(skill, /no active task/i);
});
