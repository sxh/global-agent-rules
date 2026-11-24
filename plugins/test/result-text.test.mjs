import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resultText } from '../../pcp/result_text.ts';

// A V2 tool result carries structured content; the after-hooks reason about the text in
// it. One flattening rule serves the PCP warning and the format failure notice, so a
// second copy cannot disagree with it.

test('returns a plain string result as it stands', () => {
  assert.equal(resultText('wrote a.ts'), 'wrote a.ts');
});

test('joins the text parts of a structured result in order', () => {
  assert.equal(
    resultText([
      { type: 'text', text: 'wrote a.ts' },
      { type: 'text', text: '1 file changed' },
    ]),
    'wrote a.ts1 file changed',
  );
});

test('skips a part that carries no text, such as a file attachment', () => {
  assert.equal(
    resultText([
      { type: 'text', text: 'wrote a.ts' },
      { type: 'file', uri: 'file:///a.ts', mime: 'text/plain' },
    ]),
    'wrote a.ts',
  );
});

test('reports nothing for a result that carries no content at all', () => {
  for (const content of [undefined, null, {}, 42]) {
    assert.equal(resultText(content), '');
  }
});
