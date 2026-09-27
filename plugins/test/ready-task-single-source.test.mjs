import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// B099 / T188: ReadyTask (the PCP ready-queue task shape) had two identical declarations —
// pcp/pcp_reorder.ts and pcp/task_flow.ts. It is the projection of Stack.ready_tasks, so it is
// owned by the shared Stack type and lives once in pcp/state.ts. Source-reading, consistent with
// plan-sprint-terminology.test.mjs and english-only.test.mjs.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pcpDir = join(repoRoot, 'pcp');

const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const declarationRe = /\b(?:interface|type)\s+ReadyTask\b/;

const declaringFiles = () =>
  readdirSync(pcpDir)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => declarationRe.test(read(join('pcp', f))))
    .sort();

test('pcp/state.ts exports the single ReadyTask declaration', () => {
  assert.match(read('pcp/state.ts'), /export\s+interface\s+ReadyTask\b/);
});

test('ReadyTask is declared in exactly one pcp/ module', () => {
  assert.deepEqual(declaringFiles(), ['state.ts']);
});

test('pcp_reorder.ts and task_flow.ts import ReadyTask from state.ts as a type', () => {
  for (const rel of ['pcp/pcp_reorder.ts', 'pcp/task_flow.ts']) {
    assert.match(
      read(rel),
      /import\s+type\s*\{[^}]*\bReadyTask\b[^}]*\}\s*from\s*["'].*state\.js["']/,
      `${rel} should import ReadyTask from ./state.js`,
    );
  }
});
