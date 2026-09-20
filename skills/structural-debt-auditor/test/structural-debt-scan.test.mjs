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

test('ignores node_modules, test, and benchmark files by default', () => {
    const dir = makeFixture({
        'node_modules/pkg/index.ts': 'export type Dup = string;',
        'node_modules/pkg/index2.ts': 'export type Dup = string;',
        'src/a.test.ts': 'export function helper() { return 1; }',
        'src/b.test.ts': 'export function helper() { return 1; }',
        'src/a.bench.ts': 'const UTC = "UTC";',
        'src/b.bench.ts': 'const UTC = "UTC";',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('ignores Gleam test files (*_test.gleam) by default', () => {
    const dir = makeFixture({
        'test/scale_alerts/a_test.gleam': 'pub fn main() {\n  gleeunit.main()\n}',
        'test/scale_alerts/b_test.gleam': 'pub fn main() {\n  gleeunit.main()\n}',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0, 'Gleam test files are not production declarations');
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

test('excludes a configured signature from candidates and reports it as downgraded', () => {
    const dir = makeFixture({
        'src/a.ts': 'export const handler = (e) => e;',
        'src/b.ts': 'export const handler = (e) => e;',
        'src/c.ts': 'export const helper = (e) => e;',
        'src/d.ts': 'export const helper = (e) => e;',
    });
    try {
        const result = scanDuplication(dir, {
            excludedSignatures: [{ pattern_signature: 'const_handler', reason: 'composition-root wiring' }],
        });
        assert.equal(
            result.candidates.some((c) => c.pattern_signature === 'const_handler'),
            false,
            'excluded signature must not appear as a candidate'
        );
        const downgraded = result.downgraded.find((c) => c.pattern_signature === 'const_handler');
        assert.ok(downgraded, 'expected const_handler in downgraded');
        assert.equal(downgraded.reason, 'composition-root wiring');
        assert.equal(downgraded.files.length, 2);
        assert.ok(
            result.candidates.some((c) => c.pattern_signature === 'const_helper'),
            'non-excluded duplicates must still be candidates'
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('excluded signatures do not contribute to the duplication ratio', () => {
    const dir = makeFixture({
        'src/a.ts': 'export const handler = (e) => e;',
        'src/b.ts': 'export const handler = (e) => e;',
    });
    try {
        const withoutExclusion = scanDuplication(dir);
        const withExclusion = scanDuplication(dir, {
            excludedSignatures: [{ pattern_signature: 'const_handler', reason: 'intentional' }],
        });
        assert.ok(withoutExclusion.ratio > 0, 'expected a positive ratio without exclusions');
        assert.equal(withExclusion.ratio, 0, 'excluded duplication must not count toward the ratio');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI loads .structural-debt-exclusions.json from the scanned directory by default', () => {
    const dir = makeFixture({
        'src/a.ts': 'export const handler = (e) => e;',
        'src/b.ts': 'export const handler = (e) => e;',
        '.structural-debt-exclusions.json': JSON.stringify({
            excludedSignatures: [{ pattern_signature: 'const_handler', reason: 'composition-root wiring' }],
        }),
    });
    try {
        const script = new URL('../scripts/structural-debt-scan.mjs', import.meta.url).pathname;
        const run = spawnSync('node', [script, dir, '--json'], { encoding: 'utf8' });
        assert.equal(run.status, 0);
        const result = JSON.parse(run.stdout);
        assert.equal(result.candidates.some((c) => c.pattern_signature === 'const_handler'), false);
        assert.ok(result.downgraded.some((c) => c.pattern_signature === 'const_handler'));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI --exclusions loads an explicit config path', () => {
    const dir = makeFixture({
        'src/a.ts': 'export const handler = (e) => e;',
        'src/b.ts': 'export const handler = (e) => e;',
    });
    const cfgDir = mkdtempSync(join(tmpdir(), 'sda-cfg-'));
    const cfg = join(cfgDir, 'exclusions.json');
    writeFileSync(cfg, JSON.stringify({
        excludedSignatures: [{ pattern_signature: 'const_handler', reason: 'explicit config' }],
    }));
    try {
        const script = new URL('../scripts/structural-debt-scan.mjs', import.meta.url).pathname;
        const run = spawnSync('node', [script, dir, '--json', `--exclusions=${cfg}`], { encoding: 'utf8' });
        assert.equal(run.status, 0);
        const result = JSON.parse(run.stdout);
        const downgraded = result.downgraded.find((c) => c.pattern_signature === 'const_handler');
        assert.ok(downgraded, 'expected const_handler in downgraded');
        assert.equal(downgraded.reason, 'explicit config');
    } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(cfgDir, { recursive: true, force: true });
    }
});

test('detects an identical named Gleam function declared in two files', () => {
    const dir = makeFixture({
        'src/a.gleam': 'pub fn notify_error(msg: String) -> String {\n  msg\n}',
        'src/b.gleam': 'pub fn notify_error(msg: String) -> String {\n  msg\n}',
    });
    try {
        const result = scanDuplication(dir);
        const fn = result.candidates.find((c) => c.pattern_signature === 'function_notify_error');
        assert.ok(fn, 'expected a notify_error candidate');
        assert.equal(fn.files.length, 2);
        assert.equal(fn.kind, 'duplicate-declaration');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('detects an identical named Gleam type declared in two files', () => {
    const dir = makeFixture({
        'src/a.gleam': 'pub type Weight {\n  Weight(Int)\n}',
        'src/b.gleam': 'pub type Weight {\n  Weight(Int)\n}',
    });
    try {
        const result = scanDuplication(dir);
        const t = result.candidates.find((c) => c.pattern_signature === 'type_Weight');
        assert.ok(t, 'expected a Weight candidate');
        assert.equal(t.files.length, 2);
        assert.equal(t.kind, 'duplicate-declaration');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('does not group same-named Gleam declarations with different bodies', () => {
    const dir = makeFixture({
        'src/x.gleam': 'pub fn sort(values: List(Int)) -> List(Int) {\n  list.sort(values, int.compare)\n}',
        'src/y.gleam':
            'pub fn sort(values: List(String)) -> List(String) {\n  list.sort(values, string.compare)\n}',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0, 'same name, different body is not duplication');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('reports source extensions it cannot parse instead of silently ignoring them', () => {
    const dir = makeFixture({
        'src/Service.py': 'class Service:\n    def run(self):\n        pass\n',
        'src/Other.py': 'class Other:\n    def run(self):\n        pass\n',
    });
    try {
        const result = scanDuplication(dir);
        assert.ok(
            Array.isArray(result.unsupportedExtensions),
            'expected an unsupportedExtensions array in the result'
        );
        const py = result.unsupportedExtensions.find((e) => e.ext === '.py');
        assert.ok(py, 'expected .py to be reported as unsupported');
        assert.equal(py.files.length, 2);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI warns about source files it has no extractor for', () => {
    const dir = makeFixture({
        'src/Service.py': 'class Service:\n    def run(self):\n        pass\n',
    });
    try {
        const script = new URL('../scripts/structural-debt-scan.mjs', import.meta.url).pathname;
        const run = spawnSync('node', [script, dir], { encoding: 'utf8' });
        assert.equal(run.status, 0);
        assert.match(run.stdout, /WARNING: 1 source file\(s\) with extension \.py were not parsed/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('detects an identical named Kotlin class declared in two files', () => {
    const dir = makeFixture({
        'src/main/kotlin/a/Passage.kt': 'data class Passage(val passageId: String, val title: String)\n',
        'src/main/kotlin/b/Passage.kt': 'data class Passage(val passageId: String, val title: String)\n',
    });
    try {
        const result = scanDuplication(dir);
        const candidate = result.candidates.find((c) => c.pattern_signature === 'class_Passage');
        assert.ok(candidate, 'expected a class_Passage candidate');
        assert.equal(candidate.files.length, 2);
        assert.equal(candidate.kind, 'duplicate-declaration');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('detects an identical named Java class declared in two files', () => {
    const dir = makeFixture({
        'src/main/java/a/Service.java': 'public class Service {\n    void run() {}\n}\n',
        'src/main/java/b/Service.java': 'public class Service {\n    void run() {}\n}\n',
    });
    try {
        const result = scanDuplication(dir);
        const candidate = result.candidates.find((c) => c.pattern_signature === 'class_Service');
        assert.ok(candidate, 'expected a class_Service candidate');
        assert.equal(candidate.files.length, 2);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('extracts every Kotlin/Java declaration kind', () => {
    const source = [
        'class Clazz',
        'interface Iface',
        'object Obj',
        'fun doThing() {}',
        'val property = 1',
        'var mutable = 2',
        'typealias Alias = String',
    ].join('\n');
    const dir = makeFixture({
        'src/main/kotlin/a/Kinds.kt': source,
        'src/main/kotlin/b/Kinds.kt': source,
        'src/main/java/a/Point.java': 'public record Point(int x, int y) {}\n',
        'src/main/java/b/Point.java': 'public record Point(int x, int y) {}\n',
        'src/main/java/a/Colour.java': 'public enum Colour { RED }\n',
        'src/main/java/b/Colour.java': 'public enum Colour { RED }\n',
    });
    try {
        const result = scanDuplication(dir);
        for (const signature of [
            'class_Clazz',
            'interface_Iface',
            'object_Obj',
            'function_doThing',
            'property_property',
            'property_mutable',
            'type_Alias',
            'class_Point',
            'enum_Colour',
        ]) {
            assert.ok(
                result.candidates.some((c) => c.pattern_signature === signature),
                `expected a ${signature} candidate`
            );
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('does not group same-named Kotlin declarations with different bodies', () => {
    const dir = makeFixture({
        'src/main/kotlin/a/Repo.kt': 'class Repo {\n    fun find(): Int = 1\n}\n',
        'src/main/kotlin/b/Repo.kt': 'class Repo {\n    fun find(): String = "x"\n}\n',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0, 'same name, different body is not duplication');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('does not treat indented Kotlin members as top-level declarations', () => {
    const dir = makeFixture({
        'src/main/kotlin/a/Repo.kt': 'class Repo {\n    fun helper(): Int = 1\n}\n',
        'src/main/kotlin/b/Repo.kt': 'class Repo {\n    fun helper(): Int = 1\n}\n',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(
            result.candidates.some((c) => c.pattern_signature === 'function_helper'),
            false,
            'indented members are not top-level declarations'
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('excludes Kotlin test sources under src/test from the scan', () => {
    const dir = makeFixture({
        'src/main/kotlin/a/Shared.kt': 'class Shared\n',
        'src/main/kotlin/b/Shared.kt': 'class Shared\n',
        'src/test/kotlin/a/Shared.kt': 'class Shared\n',
        'src/test/kotlin/b/Shared.kt': 'class Shared\n',
    });
    try {
        const result = scanDuplication(dir);
        const candidate = result.candidates.find((c) => c.pattern_signature === 'class_Shared');
        assert.ok(candidate, 'expected the production class to be detected');
        assert.equal(candidate.files.length, 2, 'test sources must not be scanned');
        assert.ok(
            candidate.files.every((f) => f.includes('src/main/')),
            'no test files may appear in the candidate'
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('does not report .kt or .java as unsupported once their extractor is bundled', () => {
    const dir = makeFixture({
        'src/main/kotlin/a/Only.kt': 'class Only\n',
        'src/main/java/b/Only.java': 'class Only {}\n',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.unsupportedExtensions.some((e) => e.ext === '.kt'), false);
        assert.equal(result.unsupportedExtensions.some((e) => e.ext === '.java'), false);
        assert.ok(result.totalDeclarations >= 2, 'expected the Kotlin/Java declarations to be parsed');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('ignores elm-stuff build output by default', () => {
    const dir = makeFixture({
        'elm-stuff/generated-code/a.js': 'export const Dup = 1;',
        'elm-stuff/generated-code/b.js': 'export const Dup = 1;',
        'src/only.ts': 'export type OnlyOnce = string;',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0, 'elm-stuff is generated output, not source');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('skips committed bundles by file size and reports them as skipped', () => {
    const bundle = 'export const Dup = "' + 'x'.repeat(300 * 1024) + '";';
    const dir = makeFixture({
        'public/main.js': bundle,
        'elm/main.js': bundle,
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0, 'a committed bundle is not source');
        assert.ok(Array.isArray(result.skippedGenerated), 'expected a skippedGenerated array');
        assert.equal(result.skippedGenerated.length, 2, 'both bundles must be reported as skipped');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('skips minified bundles and reports them as skipped', () => {
    const dir = makeFixture({
        'app.min.js': 'export const Dup = 1;',
        'vendor.min.js': 'export const Dup = 1;',
    });
    try {
        const result = scanDuplication(dir);
        assert.equal(result.candidates.length, 0);
        assert.equal(result.skippedGenerated.length, 2);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI warns about files skipped as generated/bundled output', () => {
    const dir = makeFixture({
        'public/main.js': 'export const Dup = "' + 'x'.repeat(300 * 1024) + '";',
    });
    try {
        const script = new URL('../scripts/structural-debt-scan.mjs', import.meta.url).pathname;
        const run = spawnSync('node', [script, dir], { encoding: 'utf8' });
        assert.equal(run.status, 0);
        assert.match(run.stdout, /WARNING: 1 file\(s\) skipped as generated\/bundled output/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
