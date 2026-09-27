import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { misplacedStateWarning, misplacedMessagePart } from '../../pcp/misplaced_state.ts';

// Hermetic: real temp directories, no real .opencode/pcp touched.
function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pcp-misplaced-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Create <base>/<rel>/.opencode/pcp ; rel === '' means base itself.
function stateDir(base, rel) {
  mkdirSync(join(base, rel, '.opencode', 'pcp'), { recursive: true });
}

test('no warning when the session directory holds its own PCP state', () => {
  withTemp((dir) => {
    stateDir(dir, '');
    assert.equal(misplacedStateWarning(dir), null);
  });
});

test('warns and names the child when the session directory is the parent of the state', () => {
  withTemp((dir) => {
    stateDir(dir, 'java');
    const warning = misplacedStateWarning(dir);
    assert.ok(warning, 'expected a warning when a child holds the state');
    assert.ok(
      warning.includes(join(dir, 'java')),
      `warning should name the child state directory, got: ${warning}`,
    );
    assert.match(warning, /opencode/i);
  });
});

test('no warning when neither the session directory nor its children hold state', () => {
  withTemp((dir) => {
    mkdirSync(join(dir, 'java'));
    assert.equal(misplacedStateWarning(dir), null);
  });
});

test('a session directory that holds its own state is not flagged even if a child also has state', () => {
  withTemp((dir) => {
    stateDir(dir, '');
    stateDir(dir, 'java');
    assert.equal(misplacedStateWarning(dir), null);
  });
});

test('builds a synthetic text part carrying the warning when misplaced', () => {
  withTemp((dir) => {
    stateDir(dir, 'java');
    const part = misplacedMessagePart(dir, 's1', 'm1');
    assert.ok(part, 'expected a part when misplaced');
    assert.equal(part.type, 'text');
    assert.equal(part.synthetic, true);
    assert.equal(part.sessionID, 's1');
    assert.equal(part.messageID, 'm1');
    assert.ok(part.text.includes(join(dir, 'java')));
  });
});

test('builds no part when the session directory holds its own state', () => {
  withTemp((dir) => {
    stateDir(dir, '');
    assert.equal(misplacedMessagePart(dir, 's1', 'm1'), null);
  });
});
