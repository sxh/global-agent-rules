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
// Pure/library modules were moved out of plugins/ (opencode treats every named export in
// every top-level .ts there as a plugin, so libraries must not live in that directory).
const libDir = join(pluginDir, '..', 'pcp');
const FILES = [
  ['pcp.ts', pluginDir],
  ['state.ts', libDir],
  ['backlog_state.ts', libDir],
  ['task_state.ts', libDir],
  ['pcp_rename.ts', libDir],
  ['pcp_rule.ts', libDir],
];

for (const [file, dir] of FILES) {
  test(`${file} has no Han characters (English-only PCP output)`, () => {
    const source = readFileSync(join(dir, file), 'utf8');
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
