import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDuplication } from '../scripts/structural-debt-scan.mjs';

function makeFixture(files) {
    const dir = mkdtempSync(join(tmpdir(), 'sda-'));
    for (const [relPath, content] of Object.entries(files)) {
        const full = join(dir, relPath);
        mkdirSync(join(dir, relPath.split('/').slice(0, -1).join('/')), { recursive: true });
        writeFileSync(full, content);
    }
    return dir;
}

test('detects an identical named type declared in two files', () => {
    const dir = makeFixture({
        'a/repo1.ts': 'export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;',
        'b/repo2.ts': 'export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;',
        'c/repo3.ts': 'export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;',
    });
    try {
        const result = scanDuplication(dir);
        const fetcher = result.candidates.find((c) => c.pattern_signature === 'type_Fetcher');
        assert.ok(fetcher, 'expected a Fetcher candidate');
        assert.equal(fetcher.files.length, 3);
        assert.equal(fetcher.kind, 'duplicate-declaration');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('detects an identical named function declared in two files', () => {
    const dir = makeFixture({
        'a/x.ts': 'export function notifyError(msg: string) { return msg; }',
        'b/y.ts': 'export function notifyError(msg: string) { return msg; }',
    });
    try {
        const result = scanDuplication(dir);
        const fn = result.candidates.find((c) => c.pattern_signature === 'function_notifyError');
        assert.ok(fn, 'expected a notifyError candidate');
        assert.equal(fn.files.length, 2);
        assert.equal(fn.kind, 'duplicate-declaration');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('does not flag a single declaration', () => {
    const dir = makeFixture({
        'a/x.ts': 'export type OnlyOnce = string;',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('computes a duplication ratio from repeated declarations', () => {
    const dir = makeFixture({
        'a/x.ts': 'export function f1() { return 1; }',
        'a/y.ts': 'export function f1() { return 1; }',
    });
    try {
        const result = scanDuplication(dir);
        assert.ok(result.ratio >= 0);
        // ratio must be strictly positive: two of N declarations are duplicates
        assert.ok(result.ratio > 0, `expected positive ratio, got ${result.ratio}`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('ignores node_modules and test files by default', () => {
    const dir = makeFixture({
        'node_modules/pkg/index.ts': 'export type Dup = string;',
        'node_modules/pkg/index2.ts': 'export type Dup = string;',
        'src/a.test.ts': 'export function helper() { return 1; }',
        'src/b.test.ts': 'export function helper() { return 1; }',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('reports per-candidate file paths and a reason', () => {
    const dir = makeFixture({
        'src/x.ts': 'export const LIMIT = 10;',
        'src/y.ts': 'export const LIMIT = 10;',
    });
    try {
        const result = scanDuplication(dir);
        const c = result.candidates[0];
        assert.ok(c.files.every((f) => f.includes('src/')));
        assert.ok(c.reason.length > 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('does not flag indented local variables inside function bodies', () => {
    const dir = makeFixture({
        'src/x.ts': 'export function sortX() {\n    const valA = 1;\n    return valA;\n}',
        'src/y.ts': 'export function sortY() {\n    const valA = 1;\n    return valA;\n}',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0, 'indented locals are not top-level declarations');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('does not group same-named declarations with different bodies', () => {
    const dir = makeFixture({
        'src/x.ts': 'export const GridControls: React.FC = () => <div>search</div>;',
        'src/y.ts': 'export const GridControls: React.FC = () => <div>list</div>;',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0, 'same name, different body is not duplication');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('supports --fail-on gating via the CLI', () => {
    const dir = makeFixture({
        'src/x.ts': 'export type Dup = string;',
        'src/y.ts': 'export type Dup = string;',
    });
    try {
        const script = new URL('../scripts/structural-debt-scan.mjs', import.meta.url).pathname;
        const run = (threshold) =>
            spawnSync('node', [script, dir, `--fail-on=${threshold}`], { encoding: 'utf8' });
        // Two identical declarations: ratio 1.0 — must fail at 0.5 (1.0 >= 0.5),
        // pass at 1.5 (1.0 < 1.5)
        assert.equal(run(0.5).status, 1);
        assert.equal(run(1.5).status, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
