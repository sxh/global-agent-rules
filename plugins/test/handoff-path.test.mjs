import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { handoffPath } from '../../pcp/handoff_path.ts';

// A handoff describes one project and several projects are live at once, so the
// file belongs in that project's root. Writing it into .opencode/pcp/ instead
// means every session has to move it, and whichever copy is stale wins by
// accident. writeHandoff calls this helper; the call site is the wiring.
test('places the handoff in the project root, not in the pcp state directory', () => {
  const dir = path.join('/tmp', 'some-project');

  assert.equal(handoffPath(dir), path.join(dir, 'HANDOFF.md'));
  assert.ok(!handoffPath(dir).includes(`${path.sep}.opencode${path.sep}`), 'not inside .opencode');
});
