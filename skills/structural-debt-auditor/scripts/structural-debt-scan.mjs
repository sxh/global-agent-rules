#!/usr/bin/env node
// Vendored from the structural-debt-auditor skill so the duplication-ratio
// ratchet runs hermetically in the hook and CI.
//
// Canonical: ~/.config/opencode/skills/structural-debt-auditor/scripts/structural-debt-scan.mjs
// Revision: pinned by scripts/lib/structural-debt-scan.lock.json; this copy
// carries the `new` binding fix and must stay semantically in step with the
// canonical scanner (scripts/scanner-parity.test.ts compares their findings on
// this repository). Project-specific downgrades live in
// packages/.structural-debt-exclusions.json.
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
 *   node scripts/structural-debt-scan.mjs [dir] [--json] [--structural] [--max-structural N] [--fail-on N] [--exclusions=<path>]
 *
 * Exclusions: reads an explicit `--exclusions=<path>` JSON file, or `<dir>/.structural-debt-exclusions.json`
 * if present. Matching pattern_signatures are reported as `downgraded` and excluded from the ratio.
 *
 * Exit codes:
 *   0  scan completed, no duplication over the fail threshold (or no --fail-on)
 *   1  scan completed, duplication ratio >= --fail-on threshold
 *   2  usage error
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const DEFAULT_EXCLUDES = new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    '.next',
    'coverage',
    '.sst',
    // Build/cache output that is not hand-written source.
    'elm-stuff',
    'target',
    '.venv',
    '__pycache__',
    '.dart_tool',
]);
// Committed bundles and minified vendor files are output, not source: scanning them
// manufactures false "duplication" (an Elm project's two 1MB bundles read as ~96%
// duplicated). Every skip is reported so the exclusion is visible, not a silent clean.
const MAX_SOURCE_BYTES = 256 * 1024;
const BUNDLE_NAME = /\.min\.[cm]?js$/i;
// Dart code-generation output is not hand-written source: json_serializable/freezed
// (.g.dart, .freezed.dart, .gr.dart, .mocks.dart) and the Flutter plugin registrant.
const GENERATED_DART_NAME = /(\.(g|freezed|gr|mocks)\.dart|generated_plugin_registrant\.dart)$/i;
// TypeScript codegen output (`actions.g.ts`, `*.generated.ts`) is data, not
// hand-written source; scanning it manufactures structural noise.
const GENERATED_TS_NAME = /\.(g|generated)\.tsx?$/i;
const SRC_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.gleam', '.kt', '.java', '.py', '.dart']);
// A const/property whose initializer is a bare call (`= createApp()`) or a bare
// identifier (`= mainTable`) only duplicates the *binding*; the shared logic
// already lives in the called helper, so this is not a missing abstraction.
// An inline literal or arrow body (`= 10`, `= (e) => e`) is different: it does
// duplicate standalone logic and must still be flagged.
// A per-module binding of a shared call/constructor (`const app = createApp()`,
// `const repository = new DynamoRepository()`) — not a missing abstraction.
const BARE_BINDING = /^(?::[^=]*)?=\s*(?:new\s+)?[A-Za-z_$][\w$.]*(\s*\([^;]*\))?\s*;?$/;
const TEST_MARKERS = [
    '.test.',
    '.spec.',
    '.bench.',
    '_test.gleam',
    '_test.dart',
    '/test/',
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
    '.dart': extractDart,
};

/**
 * Whether an exclusion entry applies to a scan kind. `scope` makes the intent
 * explicit; absent (legacy) means a `pattern_signature` covers both scans and a
 * `sample_pattern` covers the structural scan only.
 */
function exclusionAppliesTo(entry, kind) {
    if (entry.scope === 'both' || entry.scope === kind) return true;
    if (entry.scope === 'declaration' || entry.scope === 'structural') return false;
    return entry.pattern_signature !== undefined || kind === 'structural';
}

export function scanDuplication(
    rootDir,
    { excludeTestFiles = true, excludedSignatures = [], includeStructural = false } = {},
) {
    const declarations = [];
    const unsupported = new Map();
    const skippedGenerated = [];
    const skippedDirectories = new Map();
    const gitignore = createGitignore(rootDir);
    const fileCount = walk(
        rootDir,
        (file) => {
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
            const generatedReason = generatedOutputReason(file);
            if (generatedReason) {
                skippedGenerated.push({ file, reason: generatedReason });
                return;
            }
            let src;
            try {
                src = readFileSync(file, 'utf8');
            } catch {
                return;
            }
            for (const decl of extractor(src, file)) {
                declarations.push({ ...decl, file });
            }
        },
        gitignore,
        skippedDirectories,
    );

    // Group by name+kind+normalized body — the "same named thing, same shape".
    const byKey = new Map();
    for (const d of declarations) {
        const key = `${d.kind}:${d.name}:${normalize(d.signature)}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(d);
    }

    const exclusionReasons = new Map(
        excludedSignatures
            .filter((entry) => entry.pattern_signature !== undefined && exclusionAppliesTo(entry, 'declaration'))
            .map((entry) => [entry.pattern_signature, entry.reason]),
    );

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
        if (isPerModuleBinding(kind, group[0].signature)) {
            downgraded.push({
                pattern_signature: patternSignature,
                kind: 'downgraded',
                files,
                reason: `'${name}' is a per-module binding of a shared call/identifier, not a missing abstraction`,
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

    const structural = includeStructural
        ? scanStructural(rootDir, {
              excludeTestFiles,
              excludedSignatures,
              gitignore,
              skippedDirectories,
          })
        : undefined;

    return {
        ratio,
        totalDeclarations: total,
        fileCount,
        candidates,
        downgraded: [...downgraded, ...(structural?.downgraded ?? [])],
        unsupportedExtensions,
        skippedGenerated,
        skippedDirectories: [...skippedDirectories.values()],
        ...(structural === undefined ? {} : { structuralCandidates: structural.candidates }),
    };
}

// ---- .gitignore-aware directory skipping ----
// A generated tree the project ignores must never be scanned as source: a
// Stryker sandbox (`.stryker-tmp`, a full copy of the package) would otherwise
// double every declaration and fail the gate on phantom duplicates. The
// built-in DEFAULT_EXCLUDES still covers the ubiquitous build directories;
// `.gitignore` covers everything else the project declares as generated.
//
// Only the subset of git's pattern language needed to decide whether a
// *directory* is ignored is implemented: comments, `!` negation, a trailing `/`
// for directory-only, a leading `/` to anchor to the ignore file's directory,
// `*`, `?`, `**`, and character classes. Escaped `#`/`!` are not supported.
function globToRegex(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i += 1) {
        const ch = glob[i];
        if (ch === '*') {
            if (glob[i + 1] === '*') {
                if (glob[i + 2] === '/') {
                    re += '(?:[^/]+/)*';
                    i += 2;
                } else {
                    re += '.*';
                    i += 1;
                }
            } else {
                re += '[^/]*';
            }
        } else if (ch === '?') {
            re += '[^/]';
        } else if (ch === '[') {
            const end = glob.indexOf(']', i + 1);
            if (end === -1) {
                re += '\\[';
            } else {
                re += glob.slice(i, end + 1);
                i = end;
            }
        } else if ('\\^$.|+(){}'.includes(ch)) {
            re += `\\${ch}`;
        } else {
            re += ch;
        }
    }
    return re;
}

function parseGitignore(text) {
    const rules = [];
    for (const raw of text.split(/\r?\n/)) {
        let line = raw.replace(/\s+$/, '');
        if (!line || line.startsWith('#')) continue;
        let negate = false;
        if (line.startsWith('!')) {
            negate = true;
            line = line.slice(1);
        }
        let dirOnly = false;
        if (line.endsWith('/')) {
            dirOnly = true;
            line = line.replace(/\/+$/, '');
        }
        const anchored = line.startsWith('/');
        if (anchored) line = line.slice(1);
        if (!line) continue;
        const body = globToRegex(line);
        const source = anchored || line.includes('/') ? `^${body}$` : `(?:^|.*/)${body}$`;
        let regex;
        try {
            regex = new RegExp(source);
        } catch {
            // git tolerates a malformed pattern; refusing to scan would turn a
            // bad ignore line into a broken gate.
            continue;
        }
        rules.push({ regex, negate, dirOnly });
    }
    return rules;
}

/**
 * Loads the `.gitignore` files that apply to a scan root and exposes a decision
 * for any path below it. Rules are evaluated shallow-to-deep and later rules
 * win, matching git's precedence. The ignore file in a directory governs its
 * children, so `walk` loads each visited directory's file before descending.
 */
function createGitignore(scanRoot) {
    const rulesByDir = new Map();
    const loaded = new Set();

    const load = (absDir) => {
        if (loaded.has(absDir)) return;
        loaded.add(absDir);
        const file = join(absDir, '.gitignore');
        if (!existsSync(file)) return;
        let text;
        try {
            text = readFileSync(file, 'utf8');
        } catch {
            return;
        }
        rulesByDir.set(absDir, parseGitignore(text));
    };

    // The ignore chain runs from the repository root down to the scan root. A
    // non-git project has no ancestors to consult, so only its own tree applies.
    const absRoot = resolve(scanRoot);
    const chain = [];
    let current = absRoot;
    while (true) {
        chain.unshift(current);
        if (existsSync(join(current, '.git'))) break;
        const parent = dirname(current);
        if (parent === current) {
            chain.length = 0;
            chain.push(absRoot);
            break;
        }
        current = parent;
    }
    for (const dir of chain) load(dir);

    const isIgnored = (absPath, isDir) => {
        let ignored = false;
        const applicable = [...rulesByDir.entries()]
            .filter(([baseDir]) => absPath === baseDir || absPath.startsWith(baseDir + sep))
            .sort(([a], [b]) => a.length - b.length);
        for (const [baseDir, rules] of applicable) {
            const rel = relative(baseDir, absPath).split(sep).join('/');
            for (const rule of rules) {
                if (rule.dirOnly && !isDir) continue;
                if (rule.regex.test(rel)) ignored = !rule.negate;
            }
        }
        return ignored;
    };

    return { load, isIgnored };
}

function walk(dir, onFile, gitignore, skippedDirectories) {
    let count = 0;
    const visit = (d) => {
        if (gitignore) gitignore.load(resolve(d));
        let entries;
        try {
            entries = readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (DEFAULT_EXCLUDES.has(e.name)) continue;
            const full = join(d, e.name);
            if (e.isDirectory()) {
                // A virtualenv under ANY name (arch_env, venv, .env, …) is dependencies, not
                // source, so identify it by its marker rather than by the `.venv` name.
                if (looksLikeVirtualenv(full)) continue;
                if (isGeneratedDir(full)) continue;
                if (gitignore?.isIgnored(resolve(full), true)) {
                    if (skippedDirectories && !skippedDirectories.has(full)) {
                        skippedDirectories.set(full, { dir: full, reason: 'ignored by .gitignore' });
                    }
                    continue;
                }
                visit(full);
            } else if (e.isFile()) {
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

// A virtualenv carries a `pyvenv.cfg` at its root (PEP 405) whatever the directory is named,
// so detect it by that marker — a venv called `arch_env` is not matched by the `.venv` name.
function looksLikeVirtualenv(dir) {
    return existsSync(join(dir, 'pyvenv.cfg'));
}

function normalize(s) {
    return s.replace(/\s+/g, ' ').trim();
}

// True when a const/property declaration's initializer is only a call to a
// shared helper or an alias of a shared value — the "same binding in every
// module" shape, which duplicates no logic (handler = handle(app), etc.).
function isPerModuleBinding(kind, body) {
    if (kind !== 'const' && kind !== 'property') return false;
    return BARE_BINDING.test(normalize(body));
}

// Flutter's iOS/macOS platform build output lives under `<platform>/Flutter/ephemeral`
// (it bundles a generated `flutter_lldb_helper.py`); it is build output, not source.
function isGeneratedDir(full) {
    return /[\\/]Flutter[\\/]ephemeral$/.test(full);
}

// A file is generated/bundled output — not source — when it is minified or large
// enough that it is almost certainly a committed bundle. Returns a reason, or null.
function generatedOutputReason(file) {
    if (BUNDLE_NAME.test(file)) return 'minified bundle (.min.*)';
    if (GENERATED_DART_NAME.test(file)) return 'generated Dart (codegen, not hand-written source)';
    if (GENERATED_TS_NAME.test(file)) return 'generated TypeScript (codegen, not hand-written source)';
    let size;
    try {
        size = statSync(file).size;
    } catch {
        return null;
    }
    if (size > MAX_SOURCE_BYTES) {
        return `file is ${size} bytes (> ${MAX_SOURCE_BYTES}) — treated as generated/bundled output`;
    }
    return null;
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

// Extract Dart top-level named declarations. Handles:
//   class X { ... }   abstract/base/interface/sealed/final class X   mixin class X
//   mixin X { ... }   enum X { ... }   extension X on Y { ... }   extension type X(...)
//   typedef X = ...;  const/final/var x = ...;   ReturnType fn(...) { } | => ...
// A declaration is "top-level" only when it starts at column 0 — Dart has no
// top-level statements, so column 0 is the declaration level; an indented member
// lives inside a class/function body and must not be grouped. A "function" whose
// apparent return type is really a control-flow keyword (`return foo()`,
// `if (...)`) is skipped. `signature` is the body from the name to the next
// top-level declaration (or end of file) — the shared convention, so identical
// bodies group and differing bodies stay apart.
const DART_FN_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'return', 'case', 'catch', 'else', 'do',
    'try', 'assert', 'await', 'yield', 'throw', 'new', 'const', 'final', 'var',
    'late', 'rethrow', 'break', 'continue',
]);

function extractDart(src) {
    const starts = [];
    let m;
    const declRe =
        /^(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:abstract|base|final|interface|sealed|mixin|augment|external|extension)\s+)*(class|mixin|enum|extension|typedef|type|const|final|var)\s+([A-Za-z_$][\w$]*)/gm;
    while ((m = declRe.exec(src)) !== null) {
        starts.push({ index: m.index, name: m[2], prefix: m[0].trim() });
    }
    const fnRe =
        /^([A-Za-z_$][\w$<>?,.\s]*?)\s+([a-z_$][\w$]*)\s*\([^;{]*\)\s*(?:async\s*)?(?:=>|\{)/gm;
    while ((m = fnRe.exec(src)) !== null) {
        if (DART_FN_KEYWORDS.has(m[1].trim())) continue;
        starts.push({ index: m.index, name: m[2], prefix: m[0].trim() });
    }
    starts.sort((a, b) => a.index - b.index);
    return sliceDeclBodies(src, starts, (start) => {
        const head = start.prefix.replace(/\s*[A-Za-z_$][\w$]*$/, '');
        const keyword = head.trim().split(/\s+/).pop();
        if (keyword === 'enum') return 'enum';
        if (keyword === 'extension') return 'extension';
        if (keyword === 'typedef') return 'type';
        if (keyword === 'const' || keyword === 'final' || keyword === 'var') return 'property';
        if (keyword === 'class' || keyword === 'mixin' || keyword === 'type') return 'class';
        return 'function';
    });
}

// ---- Structural near-duplicate detection (report-only) ----
// The declaration scan groups identical *named* declarations. This pass groups
// balanced blocks (function bodies, class methods, inline callbacks, arrow
// bodies) whose tokens match once identifiers and literals are normalised. It
// is opt-in via --structural and never contributes to the ratio, so it can
// surface the shapes the declaration scan cannot see without failing the gate.
const MIN_STRUCTURAL_TOKENS = 40;

const STRUCTURAL_KEYWORDS = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
    'continue', 'return', 'throw', 'try', 'catch', 'finally', 'new', 'await',
    'async', 'yield', 'const', 'let', 'var', 'final', 'function', 'class',
    'extends', 'implements', 'interface', 'type', 'enum', 'public', 'private',
    'protected', 'static', 'void', 'in', 'of', 'is', 'as', 'with', 'import',
    'export', 'from',
]);

function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** A block's token sequence with identifiers and literals collapsed. */
function normalizeBlock(text) {
    const tokens = [];
    const re = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|([A-Za-z_$][\w$]*)|(\d+(?:\.\d+)?)|([^\s])/g;
    let match;
    while ((match = re.exec(stripComments(text))) !== null) {
        if (match[1] !== undefined) tokens.push('STR');
        else if (match[2] !== undefined) tokens.push(STRUCTURAL_KEYWORDS.has(match[2]) ? match[2] : 'ID');
        else if (match[3] !== undefined) tokens.push('NUM');
        else tokens.push(match[4]);
    }
    return tokens;
}

function skipLineComment(src, index) {
    const end = src.indexOf('\n', index);
    return end === -1 ? src.length : end + 1;
}

function skipBlockComment(src, index) {
    const end = src.indexOf('*/', index + 2);
    return end === -1 ? src.length : end + 2;
}

function skipQuoted(src, index) {
    const quote = src[index];
    for (let i = index + 1; i < src.length; i += 1) {
        if (src[i] === '\\') {
            i += 1;
            continue;
        }
        if (src[i] === quote) return i + 1;
    }
    return src.length;
}

/** The index just after the `}` matching the `{` at [open], or -1. */
function matchBrace(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '/' && src[i + 1] === '/') {
            i = skipLineComment(src, i) - 1;
        } else if (ch === '/' && src[i + 1] === '*') {
            i = skipBlockComment(src, i) - 1;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            i = skipQuoted(src, i) - 1;
        } else if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** The end of an expression-bodied declaration (`=> ...;`). */
function matchExpression(src, start) {
    let parens = 0;
    let brackets = 0;
    let braces = 0;
    for (let i = start; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '/' && src[i + 1] === '/') {
            i = skipLineComment(src, i) - 1;
        } else if (ch === '/' && src[i + 1] === '*') {
            i = skipBlockComment(src, i) - 1;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            i = skipQuoted(src, i) - 1;
        } else if (ch === '(') {
            parens += 1;
        } else if (ch === ')') {
            parens -= 1;
        } else if (ch === '[') {
            brackets += 1;
        } else if (ch === ']') {
            brackets -= 1;
        } else if (ch === '{') {
            braces += 1;
        } else if (ch === '}') {
            if (braces === 0) return i;
            braces -= 1;
        } else if (ch === ';' && parens === 0 && brackets === 0 && braces === 0) {
            return i + 1;
        }
    }
    return src.length;
}

/** The start of a block header: the previous statement/line boundary. */
function headerStart(src, index) {
    let i = index - 1;
    while (i >= 0) {
        const ch = src[i];
        if (ch === ';' || ch === '{' || ch === '}') return i + 1;
        if (ch === '\n') {
            const previous = src.slice(Math.max(0, i - 40), i).trimEnd();
            if (/[=>,]$/.test(previous)) {
                i -= 1;
                continue;
            }
            return i + 1;
        }
        i -= 1;
    }
    return 0;
}

/** Every brace block and arrow body in [src], with its normalised tokens. */
function extractStructuralBlocks(src, file) {
    const blocks = [];
    const push = (start, end) => {
        const header = src.slice(headerStart(src, start), start).trim().slice(-120);
        const tokens = normalizeBlock(`${header} ${src.slice(start, end)}`);
        if (tokens.length >= MIN_STRUCTURAL_TOKENS) {
            blocks.push({
                file,
                sample: header.replace(/\s+/g, ' ').slice(0, 120),
                tokens,
            });
        }
    };

    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '/' && src[i + 1] === '/') {
            i = skipLineComment(src, i) - 1;
        } else if (ch === '/' && src[i + 1] === '*') {
            i = skipBlockComment(src, i) - 1;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            i = skipQuoted(src, i) - 1;
        } else if (ch === '{') {
            const end = matchBrace(src, i);
            if (end !== -1) push(i, end + 1);
        } else if (ch === '=' && src[i + 1] === '>') {
            const end = matchExpression(src, i + 2);
            push(i, end);
            i = end - 1;
        }
    }
    return dropEnclosingBlocks(blocks);
}

/**
 * A class body or outer function that merely wraps a smaller block is not a
 * separate finding: keep the innermost blocks so one duplicate is not reported
 * twice (the class and its method, or a function and its callback).
 */
function dropEnclosingBlocks(blocks) {
    const texts = blocks.map((block) => ` ${block.tokens.join(' ')} `);
    return blocks.filter((block, index) => {
        const outer = texts[index];
        return !blocks.some(
            (other, otherIndex) =>
                otherIndex !== index &&
                other.tokens.length < block.tokens.length &&
                outer.includes(texts[otherIndex]),
        );
    });
}

// ── JSX subtrees and CSS rule bodies (B293) ──────────────────────────────────
// The declaration scan groups named declarations and the pass above groups brace- and
// arrow-delimited blocks. Neither sees a JSX subtree — markup is not a brace — or a CSS
// rule body, so the same badge rendered in three components and the same declarations
// written in three stylesheets read as clean. These extractors give both a comparable
// shape: a JSX element by its tag, attribute names and descendant tags (two copies of one
// fact differ in their values and their text, not their shape), and a CSS rule by its
// declarations including values (a colour written twice is two sources for one truth).
// They feed the same report-only candidate list as the structural pass.
const MIN_JSX_ATTRIBUTES = 2;
const MIN_JSX_DESCENDANTS = 2;
const MIN_CSS_DECLARATIONS = 4;
const JSX_TAG_NAME = /^[A-Za-z][\w.:-]*/;

/** The elements found between [from] and [to], at this level only. */
function collectJsxElements(src, from, to) {
    const found = [];
    for (let i = from; i < to; i += 1) {
        if (src[i] !== '<') continue;
        const element = readJsxElement(src, i);
        if (element === null) continue;
        found.push(element);
        i = element.end - 1;
    }
    return found;
}

/** The element opening at [start], or null when that `<` does not open one. */
function readJsxElement(src, start) {
    if (src[start] !== '<') return null;
    const tag = JSX_TAG_NAME.exec(src.slice(start + 1, start + 80))?.[0];
    if (tag === undefined) return null;

    let i = start + 1 + tag.length;
    const attributes = [];
    let depth = 0;
    let quote = null;
    for (; i < src.length; i += 1) {
        const ch = src[i];
        if (quote !== null) {
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') depth = Math.max(0, depth - 1);
        else if (depth > 0) continue;
        else if (ch === '/' && src[i + 1] === '>') return { tag, attributes, children: [], end: i + 2 };
        else if (ch === '>') {
            i += 1;
            break;
        } else if (/[A-Za-z_:]/.test(ch)) {
            const name = /^[A-Za-z_:][\w:.-]*/.exec(src.slice(i, i + 80))?.[0] ?? ch;
            attributes.push(name);
            i += name.length - 1;
        }
    }

    const children = [];
    while (i < src.length) {
        if (src.startsWith('</', i)) {
            const closing = /^<\/[A-Za-z][\w.:-]*\s*>/.exec(src.slice(i, i + 80));
            return { tag, attributes, children, end: i + (closing?.[0].length ?? 2) };
        }
        if (src[i] === '{') {
            const end = matchBrace(src, i);
            if (end === -1) {
                i += 1;
                continue;
            }
            // A render expression — a ternary, a map — holds children too.
            children.push(...collectJsxElements(src, i + 1, end));
            i = end + 1;
            continue;
        }
        if (src[i] === '<') {
            const child = readJsxElement(src, i);
            if (child === null) {
                i += 1;
                continue;
            }
            children.push(child);
            i = child.end;
            continue;
        }
        i += 1;
    }
    return { tag, attributes, children, end: i };
}

/** Every JSX element in [src] with enough shape to be a missing primitive. */
function extractJsxBlocks(src, file) {
    const blocks = [];
    for (let i = 0; i < src.length; i += 1) {
        if (src[i] !== '<') continue;
        const element = readJsxElement(src, i);
        if (element === null) continue;
        i = element.end - 1;

        const attributes = [...new Set(element.attributes)].sort();
        const descendants = [];
        const walkChildren = (node) => {
            for (const child of node.children) {
                descendants.push(child.tag);
                walkChildren(child);
            }
        };
        walkChildren(element);
        if (attributes.length < MIN_JSX_ATTRIBUTES) continue;
        if (descendants.length < MIN_JSX_DESCENDANTS) continue;

        blocks.push({
            file,
            sample: `<${element.tag}>`,
            tokens: [element.tag, ...attributes, ...descendants],
            kind: 'jsx-duplicate',
        });
    }
    return blocks;
}

/** Every CSS rule in [src] whose body is big enough to be a shared rule. */
function extractCssBlocks(src, file) {
    const blocks = [];
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = rule.exec(stripComments(src))) !== null) {
        const selector = match[1].trim().replace(/\s+/g, ' ');
        if (selector === '' || selector.startsWith('@')) continue;
        const declarations = match[2]
            .split(';')
            .map((declaration) => declaration.trim().replace(/\s+/g, ' '))
            .filter((declaration) => declaration !== '');
        if (declarations.length < MIN_CSS_DECLARATIONS) continue;
        blocks.push({
            file,
            sample: selector.slice(0, 120),
            tokens: [...declarations].sort(),
            kind: 'css-duplicate',
        });
    }
    return blocks;
}

function simpleHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

/** Structurally identical blocks, grouped; report-only (never in the ratio). */
export function scanStructural(
    rootDir,
    { excludeTestFiles = true, excludedSignatures = [], gitignore, skippedDirectories } = {},
) {
    const blocks = [];
    const ignore = gitignore ?? createGitignore(rootDir);
    const skipped = skippedDirectories ?? new Map();
    walk(
        rootDir,
        (file) => {
            const ext = extOf(file);
            const isStylesheet = ext === '.css';
            if (!SRC_EXTS.has(ext) && !isStylesheet) return;
            if (excludeTestFiles && TEST_MARKERS.some((marker) => file.includes(marker))) return;
            if (generatedOutputReason(file)) return;
            let src;
            try {
                src = readFileSync(file, 'utf8');
            } catch {
                return;
            }
            if (isStylesheet) {
                blocks.push(...extractCssBlocks(src, file));
                return;
            }
            blocks.push(...extractStructuralBlocks(src, file));
            if (ext === '.tsx' || ext === '.jsx') blocks.push(...extractJsxBlocks(src, file));
        },
        ignore,
        skipped,
    );

    const byKey = new Map();
    for (const block of blocks) {
        const key = block.tokens.join(' ');
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(block);
    }

    const excludedSignatureReasons = new Map(
        excludedSignatures
            .filter((entry) => entry.pattern_signature !== undefined && exclusionAppliesTo(entry, 'structural'))
            .map((entry) => [entry.pattern_signature, entry.reason]),
    );
    const excludedSamplePatterns = excludedSignatures
        .filter((entry) => typeof entry.sample_pattern === 'string' && exclusionAppliesTo(entry, 'structural'))
        .map((entry) => ({ pattern: new RegExp(entry.sample_pattern), reason: entry.reason }));
    const candidates = [];
    const downgraded = [];
    for (const group of byKey.values()) {
        if (group.length < 2) continue;
        const signature = group[0].tokens.join(' ');
        const patternSignature = `structural_${group[0].tokens.length}_${simpleHash(signature)}`;
        const sample = group[0].sample ?? '';
        const files = [...new Set(group.map((block) => block.file))];
        if (excludedSignatureReasons.has(patternSignature)) {
            downgraded.push({
                pattern_signature: patternSignature,
                kind: 'downgraded',
                files,
                sample,
                reason: excludedSignatureReasons.get(patternSignature),
            });
            continue;
        }
        const excludedBySample = excludedSamplePatterns.find((entry) => entry.pattern.test(sample));
        if (excludedBySample !== undefined) {
            downgraded.push({
                pattern_signature: patternSignature,
                kind: 'downgraded',
                files,
                sample,
                reason: excludedBySample.reason,
            });
            continue;
        }
        candidates.push({
            pattern_signature: patternSignature,
            kind: group[0].kind ?? 'structural-duplicate',
            files,
            sample,
            reason: `structurally identical block (${group[0].tokens.length} tokens) in ${group.length} places — likely a missing shared helper`,
        });
    }
    return { candidates, downgraded, skippedDirectories: [...skipped.values()] };
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
        throw new Error(`Failed to read exclusions at ${path}: ${err.message}`);
    }
    return Array.isArray(parsed.excludedSignatures) ? parsed.excludedSignatures : [];
}

// ---- CLI ----
function main(argv) {
    let dir = process.cwd();
    let json = false;
    let structural = false;
    let maxStructural = null;
    let failOn = null;
    let exclusionsPath = null;

    for (const arg of argv.slice(2)) {
        if (arg === '--json') json = true;
        else if (arg === '--structural') structural = true;
        else if (arg.startsWith('--max-structural=')) maxStructural = parseFloat(arg.split('=')[1]);
        else if (arg.startsWith('--fail-on=')) failOn = parseFloat(arg.split('=')[1]);
        else if (arg.startsWith('--exclusions=')) exclusionsPath = arg.slice('--exclusions='.length);
        else if (!arg.startsWith('--')) dir = arg;
        else {
            console.error(`Unknown option: ${arg}`);
            process.exitCode = 2;
            return;
        }
    }

    let excludedSignatures;
    try {
        excludedSignatures = loadExclusions(dir, exclusionsPath);
    } catch (err) {
        console.error(err.message);
        process.exitCode = 2;
        return;
    }

    let result;
    try {
        result = scanDuplication(dir, {
            excludedSignatures,
            includeStructural: structural || maxStructural !== null,
        });
    } catch (err) {
        console.error(`Failed to scan ${dir}: ${err.message}`);
        process.exitCode = 2;
        return;
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
        if (structural && result.structuralCandidates?.length > 0) {
            console.log(
                `\nStructural near-duplicates (report-only, ${result.structuralCandidates.length} pattern(s)):`
            );
            for (const c of result.structuralCandidates) {
                console.log(`\n[${c.pattern_signature}] ${c.reason}`);
                if (c.sample) console.log(`  ${c.sample}`);
                for (const f of c.files) console.log(`  - ${relative(process.cwd(), f)}`);
            }
        }
        for (const u of result.unsupportedExtensions) {
            console.log(
                `\nWARNING: ${u.files.length} source file(s) with extension ${u.ext} were not parsed — ` +
                    `no ${u.ext} extractor is bundled, so this result may undercount.`
            );
            for (const f of u.files) console.log(`  - ${relative(process.cwd(), f)}`);
        }
        if (result.skippedGenerated.length > 0) {
            console.log(
                `\nWARNING: ${result.skippedGenerated.length} file(s) skipped as generated/bundled output ` +
                    `(not scanned for duplication):`
            );
            for (const s of result.skippedGenerated) {
                console.log(`  - ${relative(process.cwd(), s.file)} (${s.reason})`);
            }
        }
        if (result.skippedDirectories?.length > 0) {
            console.log(
                `\nWARNING: ${result.skippedDirectories.length} directory/directories skipped as ignored ` +
                    `(not scanned for duplication):`
            );
            for (const s of result.skippedDirectories) {
                console.log(`  - ${relative(process.cwd(), s.dir)} (${s.reason})`);
            }
        }
    }

    if (maxStructural !== null) {
        const count = result.structuralCandidates?.length ?? 0;
        if (!json) console.log(`Structural candidates: ${count} (cap ${maxStructural}).`);
        if (count > maxStructural) {
            if (!json) console.error(`\nFAIL: ${count} structural candidate(s) > cap ${maxStructural}.`);
            process.exitCode = 1;
            return;
        }
    }

    if (failOn !== null && result.ratio >= failOn) {
        if (!json) {
            console.error(`\nFAIL: duplication ratio ${(result.ratio * 100).toFixed(1)}% >= threshold ${failOn * 100}%.`);
        }
        process.exitCode = 1;
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    // Set `process.exitCode` and let the process end on its own: an explicit
    // process.exit() after a large report drops whatever is still in the pipe
    // buffer (a 199 KB report arrived as exactly 65,536 bytes), so a caller
    // reading a pipe got truncated JSON.
    main(process.argv);
}
