import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitTrailerSource, extractMessageFiles } from '../../pcp/commit_ref.ts';

test('extracts every -F/--file message path from a git commit command', () => {
  assert.deepEqual(extractMessageFiles('git commit -F /tmp/msg.txt'), ['/tmp/msg.txt']);
  assert.deepEqual(extractMessageFiles('git commit --file=/tmp/msg.txt'), ['/tmp/msg.txt']);
  assert.deepEqual(extractMessageFiles('git commit --file "/tmp/a b.txt"'), ['/tmp/a b.txt']);
  assert.deepEqual(extractMessageFiles("git commit -m 'no file here'"), []);
});

test('reads a -F message file so a trailer hidden there is found', () => {
  const read = (file) => (file === '/tmp/msg.txt' ? 'subject\n\nPCP-Task: T082\n' : null);
  const src = commitTrailerSource('git commit -F /tmp/msg.txt', read);
  assert.match(src, /PCP-Task:\s*T082/);
});

test('still exposes an inline -m trailer', () => {
  const src = commitTrailerSource("git commit -m 'x' -m 'PCP-Task: T7'", () => null);
  assert.match(src, /PCP-Task:\s*T7/);
});

test('an unreadable message file yields source without a trailer', () => {
  const src = commitTrailerSource('git commit -F /missing.txt', () => null);
  assert.equal(/PCP-Task:/i.test(src), false);
});
