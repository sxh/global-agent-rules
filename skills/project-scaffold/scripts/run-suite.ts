/**
 * Promoted from paints-app (2026-11-24). Generic for any vitest suite: the suite name is the
 * first argument, the command follows `--`.
 *
 * Self-contained on purpose. A project copies this ONE file, and `node` (>= 22, types stripped)
 * runs it as-is: an extensionless TypeScript import such as `./git-path` cannot resolve under
 * plain node, so the two helpers it needs are inlined here. paints-app keeps them in
 * `scripts/git-path.ts` and shares them with its other gate scripts; the template trades that
 * sharing for being a single drop-in file.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Run a vitest suite so that a failure leaves a machine-readable record behind.
 *
 *   tsx scripts/run-suite.ts <suite> -- <command…>
 *
 * A failing suite that is detected by grepping stdout loses the error text to the
 * same command that reports it: in a 2026-11-24 full run one web test failed, the
 * filtered output kept only the count, and the cause cost ~30 minutes to recover —
 * badly enough that a commit report called the failure pre-existing. The suite's
 * own console output stays exactly as it was; the artefact is written beside it so
 * any later reader (or agent) can read the message and stack instead of guessing.
 *
 * The suite's exit status is passed through unchanged: this adds a record, not a
 * gate.
 */

/** What vitest's `json` reporter writes. Only the parts this reads are typed. */
export interface VitestReport {
    numFailedTests?: number;
    testResults?: {
        name?: string;
        status?: string;
        assertionResults?: {
            fullName?: string;
            status?: string;
            failureMessages?: string[];
        }[];
    }[];
}

/** One failing test, with the text that says why it failed. */
export interface SuiteFailure {
    test: string;
    file: string;
    message: string;
}

/** The record a failed run leaves at `.gate/<suite>-failures.json`. */
export interface FailureArtefact {
    suite: string;
    exitCode: number;
    failures: SuiteFailure[];
}

/** The git executable resolved to an absolute path, so `PATH` cannot redirect the gate. */
function resolveGit(): string {
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']) {
        const candidate = path.join(dir, 'git');
        if (existsSync(candidate)) return candidate;
    }
    throw new Error('git executable not found in the known locations');
}

/** Runs `git <args>`, so the root is resolved the one way the scripts resolve it. */
function gitRunner(args: string[]): string {
    return execFileSync(resolveGit(), args, { encoding: 'utf8' });
}

/** The repository root the artefact directory lives under; the caller's directory if git cannot say. */
function repositoryRoot(): string {
    try {
        const top = gitRunner(['rev-parse', '--show-toplevel']).trim();
        return top.length > 0 ? top : process.cwd();
    } catch {
        return process.cwd();
    }
}

/**
 * Git's own environment variables, which point at whichever repository invoked us.
 *
 * A commit's pre-commit hook inherits `GIT_DIR` and `GIT_INDEX_FILE`. A fixture that
 * `git init`s a scratch repo inherits them too and acts on THIS repository instead: the
 * suite passes while it stages into, or commits to, the tree it is supposed to be judging.
 * The config repo's `main` was rewritten by a fixture's `git commit` exactly this way on
 * 2026-11-24 (B305), so every suite runs without them.
 */
const GIT_ENV_KEYS = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR'];

/** [env] without git's own variables, so a fixture can only reach its own scratch repo. */
export function gitFreeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const cleaned: NodeJS.ProcessEnv = { ...env };
    for (const key of GIT_ENV_KEYS) delete cleaned[key];
    return cleaned;
}

/** The raw reporter output and the artefact, both under the gitignored `.gate/`. */
function artefactPaths(root: string, suite: string): { dir: string; report: string; failures: string } {
    const dir = path.join(root, '.gate');
    return {
        dir,
        report: path.join(dir, `${suite}-report.json`),
        failures: path.join(dir, `${suite}-failures.json`),
    };
}

/** Every failing test of [report], with the message and stack the reporter recorded. */
export function extractFailures(report: VitestReport): SuiteFailure[] {
    const failures: SuiteFailure[] = [];
    for (const suite of report.testResults ?? []) {
        for (const assertion of suite.assertionResults ?? []) {
            if (assertion.status !== 'failed') continue;
            failures.push({
                test: assertion.fullName ?? assertion.status ?? 'unnamed test',
                file: suite.name ?? 'unknown file',
                message: (assertion.failureMessages ?? []).join('\n'),
            });
        }
    }
    return failures;
}

/** The reporter flags appended to the suite command: a file, not a filtered console. */
function reporterArgs(reportPath: string): string[] {
    return ['--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`];
}

/** Reads the reporter output, or null when it was not written (a crash, not a failure). */
function readReport(reportPath: string): VitestReport | null {
    try {
        return JSON.parse(readFileSync(reportPath, 'utf8')) as VitestReport;
    } catch {
        return null;
    }
}

/** Says where the cause is, and repeats the first one, so neither needs the console. */
function announce(
    suite: string,
    failuresPath: string,
    failures: readonly SuiteFailure[],
    write: (line: string) => void,
): void {
    const relative = path.relative(process.cwd(), failuresPath);
    write(`✖ ${suite} suite failed — failure detail: ${relative === '' ? failuresPath : relative}`);
    for (const failure of failures.slice(0, 3)) {
        write(`    ${failure.test} (${failure.file})`);
        write(`    ${failure.message.split('\n')[0] ?? ''}`);
    }
    if (failures.length > 3) write(`    …and ${failures.length - 3} more, in the file above.`);
}

/** The wrapper's entry point: the suite's status, with a record of any failure. */
export function main(
    argv: readonly string[],
    root: string = repositoryRoot(),
    write: (line: string) => void = (line) => console.error(line),
): number {
    const [suite, ...rest] = argv;
    const command = rest[0] === '--' ? rest.slice(1) : rest;
    if (suite === undefined || suite.length === 0 || command.length === 0) {
        write('usage: tsx scripts/run-suite.ts <suite> -- <command…>');
        return 2;
    }

    const paths = artefactPaths(root, suite);
    mkdirSync(paths.dir, { recursive: true });
    // A previous run's record must not be mistaken for this run's outcome.
    rmSync(paths.failures, { force: true });
    rmSync(paths.report, { force: true });

    const [executable, ...args] = command as [string, ...string[]];
    const result = spawnSync(executable, [...args, ...reporterArgs(paths.report)], {
        stdio: 'inherit',
        env: gitFreeEnv(process.env),
    });
    const status = result.status ?? 1;

    // The reporter prints where it wrote; that path must still be readable, so the
    // raw report stays. Only the failure record is absent after a passing run.
    if (status === 0) return 0;

    const report = readReport(paths.report);
    if (report === null) {
        write(
            `✖ ${suite} suite failed (exit ${status}) and wrote no machine-readable report: the console above is all there is.`,
        );
        return status;
    }

    const artefact: FailureArtefact = { suite, exitCode: status, failures: extractFailures(report) };
    writeFileSync(paths.failures, JSON.stringify(artefact, null, 2));
    announce(suite, paths.failures, artefact.failures, write);
    return status;
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
    process.exit(main(process.argv.slice(2)));
}
