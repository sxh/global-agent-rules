import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  formatNotice,
  formatWrittenFile,
  resolvePrettier,
} from '../../format/on_write.ts';
import { writtenPath } from '../../pcp/tool_classify.ts';

// B284: an edit tool leaves a file that is not prettier-clean, and the cost is discovered
// only at the gate. These tests pin the after-hook's decision: which calls it formats, which
// it leaves alone, and that a broken formatter never touches the tool result.

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'format-on-write-'));
  dirs.push(dir);
  return dir;
}

function put(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// A stand-in for the project's prettier: it rewrites `const x=` to `const x = ` and records
// the file it was asked to format. The real binary is exercised by the live session.
const PRETTIER_OK = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const file = args[args.length - 1];
if (process.env.FORMAT_ON_WRITE_LOG) fs.appendFileSync(process.env.FORMAT_ON_WRITE_LOG, file + '\\n');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/const (\\w+)=/g, 'const $1 = '));
`;

const PRETTIER_FAILS = `#!/usr/bin/env node
process.exit(1);
`;

/** A formatter that says why it gave up, the way a syntax error makes prettier do. */
const PRETTIER_COMPLAINS = `#!/usr/bin/env node
process.stderr.write("[error] a.ts: SyntaxError: Unexpected token (1:13)\\n");
process.exit(2);
`;

function installPrettier(root, body = PRETTIER_OK) {
  const bin = path.join(root, 'node_modules', '.bin', 'prettier');
  put(bin, body);
  chmodSync(bin, 0o755);
  return bin;
}

/** A prettier-managed project: a config file at the root makes the project's gate prettier. */
function managedWorkspace() {
  const ws = workspace();
  put(path.join(ws, '.prettierrc'), '{ "tabWidth": 4 }\n');
  installPrettier(ws);
  return ws;
}

const isWriteTool = (tool) => ['write', 'edit', 'patch'].includes(tool);

function format(tool, args, ws, log) {
  if (log) process.env.FORMAT_ON_WRITE_LOG = log;
  try {
    return formatWrittenFile({ tool, args, workspace: ws, isWriteTool, writtenPath });
  } finally {
    delete process.env.FORMAT_ON_WRITE_LOG;
  }
}

// ── which argument names a file ─────────────────────────────────────────────

test('extracts the file a write tool names', () => {
  for (const args of [
    { filePath: 'a.ts' },
    { path: 'a.ts' },
    { file_path: 'a.ts' },
    { file: 'a.ts' },
    { target_file: 'a.ts' },
    { targetFile: 'a.ts' },
  ]) {
    assert.equal(writtenPath(args), 'a.ts', JSON.stringify(args));
  }
});

test('reports no path when the arguments do not name a single file', () => {
  for (const args of [
    undefined,
    null,
    'a.ts',
    {},
    { filePath: '' },
    { filePath: 42 },
    { filePath: ['a.ts'] },
  ]) {
    assert.equal(writtenPath(args), null, JSON.stringify(args));
  }
});

// ── the happy path ──────────────────────────────────────────────────────────

test('formats an unformatted file a write tool just touched', () => {
  const ws = managedWorkspace();
  const file = path.join(ws, 'src', 'a.ts');
  put(file, 'const answer=42;\n');

  assert.deepEqual(format('write', { filePath: file }, ws), {
    status: 'formatted',
    file,
  });
  assert.equal(readFileSync(file, 'utf8'), 'const answer = 42;\n');
});

test('resolves a relative path against the workspace', () => {
  const ws = managedWorkspace();
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  assert.deepEqual(format('edit', { filePath: 'a.ts' }, ws), {
    status: 'formatted',
    file,
  });
});

test('uses a prettier installed above the file, as a monorepo does', () => {
  const ws = managedWorkspace();
  const file = path.join(ws, 'packages', 'web', 'src', 'a.ts');
  put(file, 'const answer=42;\n');
  const log = path.join(ws, 'format.log');

  assert.deepEqual(format('write', { filePath: file }, ws, log), {
    status: 'formatted',
    file,
  });
  assert.equal(readFileSync(log, 'utf8'), `${file}\n`);
});

test('treats a prettier script in package.json as the project being prettier-managed', () => {
  const ws = workspace();
  installPrettier(ws);
  put(
    path.join(ws, 'package.json'),
    JSON.stringify({ scripts: { lint: 'prettier --check .' } }),
  );
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  assert.equal(format('write', { filePath: file }, ws).status, 'formatted');
});

test('treats a prettier key in package.json as the project being prettier-managed', () => {
  const ws = workspace();
  installPrettier(ws);
  put(path.join(ws, 'package.json'), JSON.stringify({ prettier: { tabWidth: 4 } }));
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  assert.equal(format('write', { filePath: file }, ws).status, 'formatted');
});

// ── what it leaves alone ────────────────────────────────────────────────────

test('leaves a non-write tool alone even when it names a file', () => {
  const ws = managedWorkspace();
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  for (const tool of ['read', 'bash', 'grep']) {
    assert.deepEqual(format(tool, { filePath: file }, ws), {
      status: 'skipped',
      reason: 'not-a-write-tool',
    });
  }
  assert.equal(readFileSync(file, 'utf8'), 'const answer=42;\n');
});

test('skips a write call that names no file', () => {
  const ws = managedWorkspace();
  assert.deepEqual(format('write', {}, ws), {
    status: 'skipped',
    reason: 'no-file-path',
  });
});

test('skips a file outside the workspace', () => {
  const ws = managedWorkspace();
  const elsewhere = workspace();
  const file = path.join(elsewhere, 'a.ts');
  put(file, 'const answer=42;\n');
  const log = path.join(ws, 'format.log');

  assert.deepEqual(format('write', { filePath: file }, ws, log), {
    status: 'skipped',
    reason: 'outside-workspace',
  });
  assert.equal(readFileSync(file, 'utf8'), 'const answer=42;\n');
});

test('skips a path that is not an existing file', () => {
  const ws = managedWorkspace();
  const dir = path.join(ws, 'src');
  mkdirSync(dir);

  assert.deepEqual(format('write', { filePath: dir }, ws), {
    status: 'skipped',
    reason: 'not-a-file',
  });
  assert.deepEqual(format('write', { filePath: path.join(ws, 'gone.ts') }, ws), {
    status: 'skipped',
    reason: 'not-a-file',
  });
});

test('degrades to a no-op when the project has no local prettier', () => {
  const ws = workspace();
  put(path.join(ws, '.prettierrc'), '{}\n');
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  assert.deepEqual(format('write', { filePath: file }, ws), {
    status: 'skipped',
    reason: 'no-prettier',
  });
  assert.equal(readFileSync(file, 'utf8'), 'const answer=42;\n');
});

test('degrades to a no-op when prettier is not part of the project gate', () => {
  const ws = workspace();
  installPrettier(ws);
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  assert.deepEqual(format('write', { filePath: file }, ws), {
    status: 'skipped',
    reason: 'no-prettier',
  });
});

test('treats an unreadable package.json as no prettier signal', () => {
  const ws = workspace();
  installPrettier(ws);
  put(path.join(ws, 'package.json'), '{ not json');

  assert.equal(resolvePrettier(path.join(ws, 'a.ts'), ws), null);
});

test('resolvePrettier refuses a file outside the workspace', () => {
  const ws = managedWorkspace();
  const elsewhere = workspace();

  assert.equal(resolvePrettier(path.join(elsewhere, 'a.ts'), ws), null);
});

// ── a broken formatter stays silent ─────────────────────────────────────────

test('reports a failed format without throwing or altering the file', () => {
  const ws = workspace();
  put(path.join(ws, '.prettierrc'), '{}\n');
  installPrettier(ws, PRETTIER_FAILS);
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  assert.deepEqual(format('write', { filePath: file }, ws), {
    status: 'failed',
    file,
  });
  assert.equal(readFileSync(file, 'utf8'), 'const answer=42;\n');
});

test('reports a prettier that cannot be executed rather than throwing', () => {
  const ws = workspace();
  put(path.join(ws, '.prettierrc'), '{}\n');
  const bin = path.join(ws, 'node_modules', '.bin', 'prettier');
  put(bin, PRETTIER_OK);
  chmodSync(bin, 0o644);
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  assert.deepEqual(format('write', { filePath: file }, ws), {
    status: 'failed',
    file,
  });
});

// ── a failure reaches the agent instead of stopping at the outcome ───────────

test('adds nothing to a result whose file was formatted', () => {
  const ws = managedWorkspace();
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=42;\n');

  const outcome = format('write', { filePath: file }, ws);

  assert.equal(formatNotice('wrote a.ts', outcome), null);
});

test('adds nothing when there was nothing to format', () => {
  for (const outcome of [
    { status: 'skipped', reason: 'not-a-write-tool' },
    { status: 'skipped', reason: 'no-prettier' },
  ]) {
    assert.equal(formatNotice('read a.ts', outcome), null);
  }
});

test('keeps the tool result and names the file prettier could not format', () => {
  const ws = workspace();
  put(path.join(ws, '.prettierrc'), '{}\n');
  installPrettier(ws, PRETTIER_FAILS);
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=;\n');

  const notice = formatNotice('wrote a.ts', format('write', { filePath: file }, ws));

  assert.ok(notice.startsWith('wrote a.ts'), 'the result the tool reported is kept');
  assert.match(notice, /a\.ts/);
  assert.match(notice, /prettier/);
});

test("passes on prettier's own complaint, so the file's syntax error is named", () => {
  const ws = workspace();
  put(path.join(ws, '.prettierrc'), '{}\n');
  installPrettier(ws, PRETTIER_COMPLAINS);
  const file = path.join(ws, 'a.ts');
  put(file, 'const answer=;\n');

  const outcome = format('write', { filePath: file }, ws);

  assert.equal(outcome.status, 'failed');
  assert.match(outcome.message, /Unexpected token/);
  assert.match(formatNotice('wrote a.ts', outcome), /Unexpected token/);
});
