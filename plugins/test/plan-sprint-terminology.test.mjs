import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Terminology contract: the PCP flow that selects backlog items for the next
// sprint is "plan sprint", not "sprint review". Its skill id is pcp-plan-sprint.
// (Source-reading, consistent with english-only.test.mjs and pcp-rule.test.mjs.)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

// The user-facing tool prose lives in pcp/tools.ts; plugins/pcp.ts is the host adapter.
// Both are read together so the terminology contract covers wherever the prose sits.
const pcpSource = () => read('plugins/pcp.ts') + '\n' + read('pcp/tools.ts');

test('the PCP tool source no longer references the old pcp-sprint-review skill id', () => {
  assert.doesNotMatch(pcpSource(), /pcp-sprint-review/);
});

test('the PCP tool source points users at pcp-plan-sprint with planning wording', () => {
  const source = pcpSource();
  assert.match(source, /pcp-plan-sprint/);
  assert.match(source, /plan sprint/i);
});

test('PCP user-facing prose drops the "sprint review" term', () => {
  assert.doesNotMatch(pcpSource(), /sprint review/i);
});

test('the skill is renamed to pcp-plan-sprint', () => {
  assert.equal(existsSync(join(repoRoot, 'skills/pcp-sprint-review/SKILL.md')), false);
  assert.match(read('skills/pcp-plan-sprint/SKILL.md'), /^name:\s*pcp-plan-sprint$/m);
});

test('pcp-setup installs and references pcp-plan-sprint, not the old id', () => {
  const setup = read('skills/pcp-setup/SKILL.md');
  assert.doesNotMatch(setup, /pcp-sprint-review/);
  assert.match(setup, /pcp-plan-sprint/);
});
