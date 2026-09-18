import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Option A: PCP reports in English only, so the plugin source files that produce
// user-facing prose must contain no Han characters. Any legacy Chinese document
// heading we still want to match for backward compatibility must be written as
// a `\u` escape, not a literal, so the source stays Han-free.
const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['pcp.ts', 'state.ts', 'backlog_state.ts', 'task_state.ts', 'pcp_rule.ts'];

for (const file of FILES) {
  test(`${file} has no Han characters (English-only PCP output)`, () => {
    const source = readFileSync(join(pluginDir, file), 'utf8');
    const offenders = source
      .split('\n')
      .map((line, index) => ({ lineNumber: index + 1, line }))
      .filter(({ line }) => /\p{Script=Han}/u.test(line));

    assert.equal(
      offenders.length,
      0,
      `${file} still has Han characters on ${offenders.length} line(s):\n` +
        offenders
          .slice(0, 10)
          .map(({ lineNumber, line }) => `  ${lineNumber}: ${line.trim()}`)
          .join('\n'),
    );
  });
}
