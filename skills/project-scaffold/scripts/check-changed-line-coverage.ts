import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveGit, repoRoot } from './git-path';

/**
 * Fail a commit when a line it adds or modifies has no test coverage.
 *
 * The package-level coverage threshold cannot see this: a rewritten function
 * can sit at 0% while the package stays above its threshold, because other
 * files carry the average (retrospective 2026-11-19, PaintRepository at 54.5%
 * lines). This gate answers the per-change question instead — of the statements
 * that START on a line in this diff, which ones never executed?
 *
 * It answers it only with a report written after the change: judging new lines
 * against an older report can as easily pass an uncovered line as covered, which
 * is the dangerous direction, so a stale report is a failure rather than an
 * input (B286).
 *
 * Promoted from paints-app (2026-11-24). Assumes a `packages/<pkg>/src` layout with
 * istanbul reports at `packages/<pkg>/coverage/coverage-final.json`. For Dart/Flutter,
 * read the `DA:<line>,<hits>` records in `lcov.info` instead — same question, other format.
 */

/** An inclusive line range on the new side of a diff hunk. */
export interface LineRange {
    start: number;
    end: number;
}

/** The part of an istanbul coverage entry this gate reads. */
export interface FileCoverage {
    statementMap: Record<string, { start: { line: number } }>;
    s: Record<string, number>;
}

/** A changed line, or a whole changed file, that no test covers. */
export interface Finding {
    file: string;
    /** Start line of the uncovered statement, or null when the file has no coverage entry. */
    line: number | null;
}

/** Runs `git <args>` and returns its stdout. Injected so the CLI is testable. */
export type GitRunner = (args: string[]) => string;

/** Reads a repo-relative file's contents. Injected so the CLI is testable. */
export type FileReader = (file: string) => string;

/**
 * When a repo-relative path was last modified, or null when it cannot be known —
 * absent, or unreadable. A null cannot prove staleness, so it never fails a run;
 * a missing report is the separate "no coverage entry" finding below.
 */
export type ModifiedAt = (file: string) => number | null;

/** A package report written before the changed code it would have to describe. */
export interface StaleReport {
    /** Repo-relative path of the report. */
    report: string;
    /** The newest changed source in that package, which the report has not seen. */
    source: string;
    /** The command that rewrites it. */
    suite: string;
}

const readText: FileReader = (file) => readFileSync(file, 'utf8');

/** Application source: the only tree the package coverage reports describe. */
const SOURCE = /^packages\/[^/]+\/src\//;

/** Test files, type declarations, generated output and styles carry no measured behaviour. */
const EXCLUDED_FILE = /\.(test\.tsx?|d\.tsx?|g\.tsx?|css)$/;

/**
 * Modules whose content is declarations or data rather than behaviour.
 *
 * `main.tsx` is the DOM entry point: it mounts the app and nothing else, so its
 * outcome — the app rendered — is what the smoke test asserts (build, preview,
 * `#root` found). A unit test would only observe that React was asked to render.
 */
const NON_BEHAVIOUR = new Set(['index.ts', 'index.tsx', 'types.ts', 'constants.ts', 'schemas.ts', 'main.tsx']);

/** The new-side hunk header: `@@ -old,count +new,count @@`. */
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * A real `+++` file header, not an added content line that happens to start with
 * `++` (which git renders as `+++ …`). Only git's own prefixes qualify.
 */
const FILE_HEADER = /^\+\+\+ (?:b\/|\/dev\/null)/;

/** True when the coverage gate measures [file]. */
export function isMeasuredSource(file: string): boolean {
    if (!SOURCE.test(file)) return false;
    if (EXCLUDED_FILE.test(file)) return false;
    if (NON_BEHAVIOUR.has(path.basename(file))) return false;
    return !file.split('/').includes('test');
}

/** The new-side line ranges each file gains or changes in a `git diff -U0` body. */
export function parseChangedLines(diff: string): Map<string, LineRange[]> {
    const changed = new Map<string, LineRange[]>();
    let file: string | null = null;
    for (const line of diff.split('\n')) {
        if (FILE_HEADER.test(line)) {
            const target = line.slice(4).trim();
            file = target === '/dev/null' ? null : target.replace(/^b\//, '');
            continue;
        }
        const header = HUNK.exec(line);
        if (header === null || file === null) continue;
        const start = Number(header[1]);
        const count = header[2] === undefined ? 1 : Number(header[2]);
        // A deletion-only hunk adds no new lines, so there is nothing to cover.
        if (count === 0) continue;
        const ranges = changed.get(file) ?? [];
        ranges.push({ start, end: start + count - 1 });
        changed.set(file, ranges);
    }
    return changed;
}

/** Every changed measured statement of [changed] that executed zero times in [coverage]. */
export function findUncoveredLines(
    changed: ReadonlyMap<string, readonly LineRange[]>,
    coverage: ReadonlyMap<string, FileCoverage>,
): Finding[] {
    const findings: Finding[] = [];
    for (const [file, ranges] of changed) {
        if (!isMeasuredSource(file)) continue;
        const entry = coverage.get(file);
        if (entry === undefined) {
            findings.push({ file, line: null });
            continue;
        }
        for (const [id, statement] of Object.entries(entry.statementMap)) {
            if ((entry.s[id] ?? 0) > 0) continue;
            const line = statement.start.line;
            if (ranges.some((range) => line >= range.start && line <= range.end)) findings.push({ file, line });
        }
    }
    return findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}

/** A coverage key as a repo-relative POSIX path, tolerating a differently-spelled root. */
export function toRepoRelative(root: string, absolute: string): string {
    const relative = path.relative(root, absolute);
    // Coverage keys are absolute paths recorded when the suite ran, which may be
    // spelled under another root (a worktree, or macOS' /var → /private/var alias).
    // The package tree is the stable part, so fall back to it.
    if (relative.startsWith('..')) {
        const marker = absolute.lastIndexOf('/packages/');
        if (marker !== -1) return absolute.slice(marker + 1);
    }
    return relative.split(path.sep).join('/');
}

/** Merges each package's `coverage/coverage-final.json` into one repo-relative map. */
export function loadCoverage(root: string): Map<string, FileCoverage> {
    const merged = new Map<string, FileCoverage>();
    const packages = path.join(root, 'packages');
    if (!existsSync(packages)) return merged;
    for (const entry of readdirSync(packages, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const reportPath = path.join(packages, entry.name, 'coverage', 'coverage-final.json');
        if (!existsSync(reportPath)) continue;
        const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, FileCoverage>;
        for (const [absolute, fileCoverage] of Object.entries(report)) {
            merged.set(toRepoRelative(root, absolute), fileCoverage);
        }
    }
    return merged;
}

/** The package that owns [file], e.g. `packages/core`, where its report lives. */
function packageOf(file: string): string | null {
    const match = /^(packages\/[^/]+)\//.exec(file);
    return match?.[1] ?? null;
}

/**
 * The package reports that were written before the newest changed source they
 * would have to describe. Judging with one answers the gate's question about
 * yesterday's code: it reported a covered line as uncovered from a stale report,
 * and it can hide an uncovered line as covered, which is the worse direction.
 */
export function staleReports(sources: readonly string[], modifiedAt: ModifiedAt): StaleReport[] {
    const newest = new Map<string, { source: string; at: number }>();
    for (const source of sources) {
        const packageDir = packageOf(source);
        const at = modifiedAt(source);
        if (packageDir === null || at === null) continue;
        const current = newest.get(packageDir);
        if (current === undefined || at > current.at) newest.set(packageDir, { source, at });
    }
    const stale: StaleReport[] = [];
    for (const [packageDir, changed] of newest) {
        const report = `${packageDir}/coverage/coverage-final.json`;
        const written = modifiedAt(report);
        // Equal mtimes are the same moment, which a suite that ran after the edit can
        // produce on a coarse clock: only strictly older is stale.
        if (written === null || written >= changed.at) continue;
        stale.push({ report, source: changed.source, suite: `npm test --workspace=${packageDir}` });
    }
    return stale.sort((a, b) => a.report.localeCompare(b.report));
}

/** Says which suite to re-run, so the fix is one command away. */
export function reportStale(stale: readonly StaleReport[], write: (line: string) => void): void {
    write('✖ changed-line coverage: the coverage report predates the code it would judge:');
    for (const entry of stale) {
        write(`    ${entry.report} is older than ${entry.source}`);
        write(`    run the suite that writes it, then retry: ${entry.suite}`);
    }
    write(
        '\nA stale report can pass an uncovered line as covered, so it is not evidence about\n' +
            'this change. Run the suite after the edit, not before.\n',
    );
}

/** Writes each uncovered changed line, so the fix is obvious from the output. */
export function report(findings: readonly Finding[], write: (line: string) => void): void {
    write('✖ changed-line coverage: these added or modified lines are not covered by any test:');
    for (const finding of findings) {
        const location = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
        write(`    ${location}`);
        if (finding.line === null) write('      no coverage entry — no test ever loads this file');
    }
    write(
        '\nThe gate measures statements that START on a line in your diff. Write the failing\n' +
            'test for the changed behaviour first (TDD), rather than relying on the package total.\n',
    );
}

function gitOutput(args: string[]): string {
    return execFileSync(resolveGit(), args, { encoding: 'utf8' });
}

/** The new-side span of a file git has never tracked: every line of it. */
function newFileDiff(file: string, read: FileReader): string {
    const lines = read(file).split('\n');
    // A trailing newline terminates the last line rather than starting a new one.
    const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    if (count === 0) return '';
    return ['--- /dev/null', `+++ b/${file}`, `@@ -0,0 +1,${count} @@`, '+new'].join('\n');
}

/**
 * The un-staged diff: tracked edits against HEAD, plus every untracked file as
 * a wholly-new one. Without the untracked half a new, untested file passed the
 * gate whenever the check ran before staging.
 */
export function workingTreeDiff(run: GitRunner, read: FileReader = readText): string {
    const tracked = run(['diff', '-M', '-U0', 'HEAD']);
    const untracked = run(['ls-files', '--others', '--exclude-standard'])
        .split('\n')
        .filter((file) => file.trim().length > 0)
        .map((file) => newFileDiff(file, read));
    return [tracked, ...untracked].filter((part) => part.length > 0).join('\n');
}

/**
 * What this commit changes: the staged diff, else the working tree against HEAD.
 * `-M` makes rename detection independent of the repo's `diff.renames` setting:
 * a moved file is judged on its edited lines, not as a wholly-new file.
 */
function currentDiff(run: GitRunner, read: FileReader = readText): string {
    const staged = run(['diff', '--cached', '-M', '-U0']);
    return staged.trim().length > 0 ? staged : workingTreeDiff(run, read);
}

/**
 * The repository root the reports live under, taken from git rather than the
 * caller's directory (see `repoRoot` in `git-path.ts`).
 */
export { repoRoot } from './git-path';

/** Runs git in [root]: paths come back repo-relative and no pathspec scopes the diff. */
function atRoot(run: GitRunner, root: string): GitRunner {
    return (args) => run(['-C', root, ...args]);
}

/** The report this gate reads, spelled for a failure message. */
export function reportPath(root: string): string {
    return path.join(root, 'packages', '*', 'coverage', 'coverage-final.json');
}

/** Says the suite has not run, instead of blaming every changed file for it. */
export function reportNoReports(root: string, write: (line: string) => void): void {
    write('✖ changed-line coverage: no coverage report found, so no changed line was judged.');
    write(`    looked for ${reportPath(root)}`);
    write('    run the package suite first (npm test), then retry the commit.');
}

/** The gate's verdict on [changed] against [coverage]. */
function judge(
    changed: ReadonlyMap<string, readonly LineRange[]>,
    coverage: ReadonlyMap<string, FileCoverage>,
    write: (line: string) => void,
): number {
    const findings = findUncoveredLines(changed, coverage);
    if (findings.length === 0) return 0;
    report(findings, write);
    return 1;
}

/** The hook's entry point: 1 when a changed statement has no coverage. */
export function main(
    run: GitRunner = gitOutput,
    write: (line: string) => void = console.error,
    coverage?: ReadonlyMap<string, FileCoverage>,
): number {
    const root = repoRoot(run);
    const read: FileReader = (file) => readFileSync(path.join(root, file), 'utf8');
    const changed = parseChangedLines(currentDiff(atRoot(run, root), read));
    // A diff that touches no measured source has nothing to judge, report or load.
    const sources = [...changed.keys()].filter(isMeasuredSource);
    if (sources.length === 0) return 0;

    const modifiedAt: ModifiedAt = (file) => {
        try {
            return statSync(path.join(root, file)).mtimeMs;
        } catch {
            return null;
        }
    };
    const stale = staleReports(sources, modifiedAt);
    if (stale.length > 0) {
        reportStale(stale, write);
        return 1;
    }

    const reports = coverage ?? loadCoverage(root);
    if (reports.size === 0) {
        reportNoReports(root, write);
        return 1;
    }
    return judge(changed, reports, write);
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
    process.exit(main());
}
