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
 *   node scripts/structural-debt-scan.mjs [dir] [--json] [--fail-on N]
 *
 * Exit codes:
 *   0  scan completed, no duplication over the fail threshold (or no --fail-on)
 *   1  scan completed, duplication ratio >= --fail-on threshold
 *   2  usage error
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DEFAULT_EXCLUDES = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage', '.sst']);
const SRC_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.gleam', '.kt', '.java', '.py']);
const TEST_MARKERS = ['.test.', '.spec.'];

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
};

export function scanDuplication(rootDir, { excludeTestFiles = true } = {}) {
    const declarations = [];
    const fileCount = walk(rootDir, (file) => {
        const ext = extOf(file);
        const extractor = EXTRACTORS[ext];
        if (!extractor) return;
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

    const candidates = [];
    let duplicatedCount = 0;
    for (const [key, group] of byKey) {
        if (group.length < 2) continue;
        const [kind, name] = key.split(':');
        duplicatedCount += group.length;
        candidates.push({
            pattern_signature: `${kind}_${name}`,
            kind: 'duplicate-declaration',
            files: group.map((d) => d.file),
            reason: `'${name}' declared identically in ${group.length} files — likely a missing shared abstraction`,
        });
    }

    const total = declarations.length;
    const ratio = total === 0 ? 0 : duplicatedCount / total;

    return { ratio, totalDeclarations: total, fileCount, candidates };
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
function extractTypeScript(src, file) {
    const decls = [];
    // Find every top-level declaration start (column 0, optional export).
    const declRe =
        /^(?:export\s+)?(?:abstract\s+)?(?:type|interface|const|function|class)\s+([A-Za-z_$][\w$]*)/gm;
    const starts = [];
    let m;
    while ((m = declRe.exec(src)) !== null) {
        starts.push({ index: m.index, name: m[1], prefix: m[0].trim() });
    }
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
        const body = src.slice(start.index + start.prefix.length, end);
        const prefix = start.prefix.replace(/^export\s+/, '');
        const kind = /^type\b/.test(prefix)
            ? 'type'
            : /^function\b/.test(prefix)
              ? 'function'
              : /^class\b/.test(prefix)
                ? 'class'
                : /^interface\b/.test(prefix)
                  ? 'interface'
                  : 'const';
        decls.push({ name: start.name, kind, signature: body });
    }
    return decls;
}

// ---- CLI ----
function main(argv) {
    let dir = process.cwd();
    let json = false;
    let failOn = null;

    for (const arg of argv.slice(2)) {
        if (arg === '--json') json = true;
        else if (arg.startsWith('--fail-on=')) failOn = parseFloat(arg.split('=')[1]);
        else if (!arg.startsWith('--')) dir = arg;
        else {
            console.error(`Unknown option: ${arg}`);
            process.exit(2);
        }
    }

    let result;
    try {
        result = scanDuplication(dir);
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
