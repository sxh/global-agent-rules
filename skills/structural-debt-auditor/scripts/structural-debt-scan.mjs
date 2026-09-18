#!/usr/bin/env node
/**
 * Structural Debt Scanner — the coverage-analog for missing abstractions.
 *
 * Scans a directory tree for repeated top-level declarations (same named
 * type/interface/const/function/class in two or more files). Repetition of a
 * named declaration is the primary, language-agnostic signal of a missing
 * abstraction: the Fetcher type, notifyError helper, or repository base class
 * that should exist once.
 *
 * Dependency-free (Node built-ins only) so it runs in any project.
 *
 * Usage:
 *   node scripts/structural-debt-scan.mjs [dir] [--json] [--fail-on N] [--exclusions=<path>]
 *
 * Exclusions: reads an explicit `--exclusions=<path>` JSON file, or `<dir>/.structural-debt-exclusions.json`
 * if present. Matching pattern_signatures are reported as `downgraded` and excluded from the ratio.
 *
 * Exit codes:
 *   0  scan completed, no duplication over the fail threshold (or no --fail-on)
 *   1  scan completed, duplication ratio >= --fail-on threshold
 *   2  usage error
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DEFAULT_EXCLUDES = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage', '.sst']);
const SRC_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.gleam', '.kt', '.java', '.py']);
const TEST_MARKERS = [
    '.test.',
    '.spec.',
    '.bench.',
    '_test.gleam',
    '/src/test/',
    '/src/androidTest/',
    '/src/testFixtures/',
];

// Top-level declaration extractors, keyed by file extension.
// Each returns an array of { name, kind, signature } where `signature` is the
// declaration body normalized (whitespace-collapsed) — two files that declare
// the same named thing with the same body are duplicates.
const EXTRACTORS = {
    '.ts': extractTypeScript,
    '.tsx': extractTypeScript,
    '.js': extractTypeScript,
    '.jsx': extractTypeScript,
    '.mjs': extractTypeScript,
    '.cjs': extractTypeScript,
    '.gleam': extractGleam,
    '.kt': extractKotlin,
    '.java': extractKotlin,
};

export function scanDuplication(rootDir, { excludeTestFiles = true, excludedSignatures = [] } = {}) {
    const declarations = [];
    const unsupported = new Map();
    const fileCount = walk(rootDir, (file) => {
        const ext = extOf(file);
        const extractor = EXTRACTORS[ext];
        if (!extractor) {
            // A source extension we claim to scan but have no extractor for.
            // Record it so an empty/undercounted result is loud, not silent.
            if (SRC_EXTS.has(ext)) {
                if (!unsupported.has(ext)) unsupported.set(ext, []);
                unsupported.get(ext).push(file);
            }
            return;
        }
        if (excludeTestFiles && TEST_MARKERS.some((m) => file.includes(m))) return;
        let src;
        try {
            src = readFileSync(file, 'utf8');
        } catch {
            return;
        }
        for (const decl of extractor(src, file)) {
            declarations.push({ ...decl, file });
        }
    });

    // Group by name+kind+normalized body — the "same named thing, same shape".
    const byKey = new Map();
    for (const d of declarations) {
        const key = `${d.kind}:${d.name}:${normalize(d.signature)}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(d);
    }

    const exclusionReasons = new Map(excludedSignatures.map((e) => [e.pattern_signature, e.reason]));

    const candidates = [];
    const downgraded = [];
    let duplicatedCount = 0;
    for (const [key, group] of byKey) {
        if (group.length < 2) continue;
        const [kind, name] = key.split(':');
        const patternSignature = `${kind}_${name}`;
        const files = group.map((d) => d.file);
        if (exclusionReasons.has(patternSignature)) {
            downgraded.push({
                pattern_signature: patternSignature,
                kind: 'downgraded',
                files,
                reason: exclusionReasons.get(patternSignature),
            });
            continue;
        }
        duplicatedCount += group.length;
        candidates.push({
            pattern_signature: patternSignature,
            kind: 'duplicate-declaration',
            files,
            reason: `'${name}' declared identically in ${group.length} files — likely a missing shared abstraction`,
        });
    }

    const total = declarations.length;
    const ratio = total === 0 ? 0 : duplicatedCount / total;
    const unsupportedExtensions = [...unsupported.entries()].map(([ext, files]) => ({ ext, files }));

    return { ratio, totalDeclarations: total, fileCount, candidates, downgraded, unsupportedExtensions };
}

function walk(dir, onFile) {
    let count = 0;
    const visit = (d) => {
        let entries;
        try {
            entries = readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (DEFAULT_EXCLUDES.has(e.name)) continue;
            const full = join(d, e.name);
            if (e.isDirectory()) visit(full);
            else if (e.isFile()) {
                count++;
                onFile(full);
            }
        }
    };
    visit(dir);
    return count;
}

function extOf(file) {
    const m = /\.([a-z0-9]+)$/i.exec(file);
    return m ? `.${m[1].toLowerCase()}` : '';
}

function normalize(s) {
    return s.replace(/\s+/g, ' ').trim();
}

// Slice each declaration body from the end of its matched prefix to the next
// declaration start (or end of file). Shared by every language extractor, so
// "same name + same body" groups consistently across languages.
function sliceDeclBodies(src, starts, kindOf) {
    const decls = [];
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
        const body = src.slice(start.index + start.prefix.length, end);
        decls.push({ name: start.name, kind: kindOf(start), signature: body });
    }
    return decls;
}

// Extract top-level named declarations. Handles:
//   export type X = ...;        export interface X { ... }
//   export const X = ...;       export function X(...) { ... }
//   export class X { ... }      export abstract class X { ... }
// Also plain (non-exported) top-level `type/interface/const/function/class`.
// A declaration is "top-level" only when it starts at column 0 (optionally
// prefixed by `export`) — indented `const x = ...` inside a function body is
// a local variable, not a named abstraction, and must not be grouped.
// `signature` is the declaration body from the name to the next top-level
// declaration (or end of file) — so identical bodies group together and
// differing bodies stay separate.
function extractTypeScript(src) {
    // Find every top-level declaration start (column 0, optional export).
    const declRe =
        /^(?:export\s+)?(?:abstract\s+)?(?:type|interface|const|function|class)\s+([A-Za-z_$][\w$]*)/gm;
    const starts = [];
    let m;
    while ((m = declRe.exec(src)) !== null) {
        starts.push({ index: m.index, name: m[1], prefix: m[0].trim() });
    }
    return sliceDeclBodies(src, starts, (start) => {
        const prefix = start.prefix.replace(/^export\s+/, '');
        if (/^type\b/.test(prefix)) return 'type';
        if (/^function\b/.test(prefix)) return 'function';
        if (/^class\b/.test(prefix)) return 'class';
        if (/^interface\b/.test(prefix)) return 'interface';
        return 'const';
    });
}

// Extract Gleam top-level named declarations. Handles:
//   pub fn name(...) -> ... { ... }   fn name(...) { ... }
//   pub type Name { ... }             pub type Name = ...      (alias)
//   pub type Name { ... }             pub opaque type Name { ... }
//   pub const name = ...
// Gleam requires top-level declarations to start at column 0; an indented `fn`
// is a local function inside a body, not a named abstraction, and must not be
// grouped. `signature` is the declaration body from the name to the next
// top-level declaration (or end of file) — the same convention as
// extractTypeScript, so identical bodies group and differing bodies stay apart.
function extractGleam(src) {
    const declRe = /^(?:pub\s+)?(?:opaque\s+)?(fn|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    const starts = [];
    let m;
    while ((m = declRe.exec(src)) !== null) {
        starts.push({ index: m.index, name: m[2], keyword: m[1], prefix: m[0].trim() });
    }
    return sliceDeclBodies(src, starts, (start) =>
        start.keyword === 'fn' ? 'function' : start.keyword
    );
}

// Extract Kotlin/Java top-level named declarations. Handles:
//   class X { ... }            data class X(...)         enum class X { ... }
//   interface X { ... }        sealed interface X        fun interface X
//   object X { ... }           data object X
//   fun x(...) { ... }         val x = ...               var x = ...
//   typealias X = ...          record X(...)             enum X { ... } (Java)
// Also with leading modifiers (public/private/internal/data/sealed/abstract/
// open/final/annotation/value/inline/expect/actual/non-sealed).
// A declaration is "top-level" only when it starts at column 0 — an indented
// member inside a class or function body is nested, not a named abstraction, and
// must not be grouped. `signature` is the declaration body from the name to the
// next top-level declaration (or end of file) — the same convention as the other
// extractors, so identical bodies group and differing bodies stay apart.
function extractKotlin(src) {
    const declRe =
        /^(?:(?:public|private|protected|internal|data|sealed|enum|abstract|open|final|annotation|value|inline|expect|actual|non-sealed)\s+)*(?:fun\s+interface|class|interface|object|fun|val|var|typealias|record|enum)\s+([A-Za-z_$][\w$]*)/gm;
    const starts = [];
    let m;
    while ((m = declRe.exec(src)) !== null) {
        starts.push({ index: m.index, name: m[1], prefix: m[0].trim() });
    }
    return sliceDeclBodies(src, starts, (start) => {
        const head = start.prefix.replace(/\s*[A-Za-z_$][\w$]*$/, '');
        const keyword = head.trim().split(/\s+/).pop();
        if (keyword === 'class' || keyword === 'record') return 'class';
        if (keyword === 'interface') return 'interface';
        if (keyword === 'object') return 'object';
        if (keyword === 'fun') return 'function';
        if (keyword === 'val' || keyword === 'var') return 'property';
        if (keyword === 'typealias') return 'type';
        return keyword;
    });
}

// Load the known-intentional exclusion registry. Reads an explicit path when
// given, otherwise `<dir>/.structural-debt-exclusions.json` if present.
function loadExclusions(dir, explicitPath) {
    const path = explicitPath || join(dir, '.structural-debt-exclusions.json');
    if (!existsSync(path)) return [];
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
        console.error(`Failed to read exclusions at ${path}: ${err.message}`);
        process.exit(2);
    }
    return Array.isArray(parsed.excludedSignatures) ? parsed.excludedSignatures : [];
}

// ---- CLI ----
function main(argv) {
    let dir = process.cwd();
    let json = false;
    let failOn = null;
    let exclusionsPath = null;

    for (const arg of argv.slice(2)) {
        if (arg === '--json') json = true;
        else if (arg.startsWith('--fail-on=')) failOn = parseFloat(arg.split('=')[1]);
        else if (arg.startsWith('--exclusions=')) exclusionsPath = arg.slice('--exclusions='.length);
        else if (!arg.startsWith('--')) dir = arg;
        else {
            console.error(`Unknown option: ${arg}`);
            process.exit(2);
        }
    }

    const excludedSignatures = loadExclusions(dir, exclusionsPath);

    let result;
    try {
        result = scanDuplication(dir, { excludedSignatures });
    } catch (err) {
        console.error(`Failed to scan ${dir}: ${err.message}`);
        process.exit(2);
    }

    if (json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        const pct = (result.ratio * 100).toFixed(1);
        console.log(`Scanned ${result.fileCount} files, ${result.totalDeclarations} top-level declarations.`);
        console.log(`Duplication ratio: ${pct}% (${result.candidates.length} candidate pattern(s)).`);
        for (const c of result.candidates) {
            console.log(`\n[${c.pattern_signature}] ${c.reason}`);
            for (const f of c.files) console.log(`  - ${relative(process.cwd(), f)}`);
        }
        for (const c of result.downgraded) {
            console.log(`\n[downgraded:${c.pattern_signature}] ${c.reason}`);
            for (const f of c.files) console.log(`  - ${relative(process.cwd(), f)}`);
        }
        for (const u of result.unsupportedExtensions) {
            console.log(
                `\nWARNING: ${u.files.length} source file(s) with extension ${u.ext} were not parsed — ` +
                    `no ${u.ext} extractor is bundled, so this result may undercount.`
            );
            for (const f of u.files) console.log(`  - ${relative(process.cwd(), f)}`);
        }
    }

    if (failOn !== null && result.ratio >= failOn) {
        if (!json) console.error(`\nFAIL: duplication ratio ${pct}% >= threshold ${failOn * 100}%.`);
        process.exit(1);
    }
    process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main(process.argv);
}
