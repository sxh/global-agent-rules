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

test('pcp.ts no longer references the old pcp-sprint-review skill id', () => {
  assert.doesNotMatch(read('plugins/pcp.ts'), /pcp-sprint-review/);
});

test('pcp.ts points users at pcp-plan-sprint with planning wording', () => {
  const source = read('plugins/pcp.ts');
  assert.match(source, /pcp-plan-sprint/);
  assert.match(source, /plan sprint/i);
});

test('pcp.ts user-facing prose drops the "sprint review" term', () => {
  assert.doesNotMatch(read('plugins/pcp.ts'), /sprint review/i);
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
