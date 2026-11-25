// The promoted suite runner must not hand the commit hook's git environment to a child, and it
// must leave the failure record behind — the two reasons the template exists.
//
// A hook runs under `git commit`, which exports GIT_DIR and GIT_INDEX_FILE. A fixture that
// `git init`s a temp repo inherits them and acts on THIS repository instead: on 2026-11-24 one
// fixture's `git commit` moved a shared config repo's `main` and another's `git add` staged
// files nobody staged, with every suite green. The strip is part of the template, so a project
// scaffolded from it cannot inherit the gap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFailures, gitFreeEnv, main } from '../scripts/run-suite.ts';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'run-suite.ts');
const REPORT = {
    numFailedTests: 1,
    testResults: [
        {
            name: '/repo/example.test.ts',
            status: 'failed',
            assertionResults: [
                { fullName: 'example > fails', status: 'failed', failureMessages: ['expected 1 to be 2'] },
                { fullName: 'example > passes', status: 'passed', failureMessages: [] },
            ],
        },
    ],
};
const GIT_KEYS = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR'];

/** The process environment without git's own variables, so a fixture cannot reach this repo. */
function cleanEnv(extra = {}) {
    const env = { ...process.env, ...extra };
    for (const key of GIT_KEYS) if (!(key in extra)) delete env[key];
    return env;
}

/** A scratch directory, and the call that removes it. */
function scratch(prefix) {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Runs the template with the environment a commit hook exports, from a repository of its own. */
function runUnderCommitHook() {
    const { dir, done } = scratch('run-suite-template-');
    try {
        // A real repository, because the hook's GIT_DIR names one; and `git init` runs without
        // any inherited GIT_* itself, or it would initialise the caller's repository instead.
        spawnSync('git', ['init', '-q'], { cwd: dir, env: cleanEnv() });
        return spawnSync(
            process.execPath,
            [
                RUNNER,
                'git-env',
                '--',
                '/bin/sh',
                '-c',
                'printf "GIT_DIR=%s GIT_INDEX_FILE=%s\\n" "${GIT_DIR-unset}" "${GIT_INDEX_FILE-unset}"',
            ],
            {
                cwd: dir,
                encoding: 'utf8',
                env: cleanEnv({ GIT_DIR: path.join(dir, '.git'), GIT_INDEX_FILE: path.join(dir, '.git/index') }),
            },
        );
    } finally {
        done();
    }
}

test("the template's suite runner strips the hook's git environment from the child", () => {
    const result = runUnderCommitHook();

    assert.equal(result.status, 0, result.stderr ?? '');
    assert.match(result.stdout ?? '', /GIT_DIR=unset GIT_INDEX_FILE=unset/);
});

test('gitFreeEnv drops every repository variable and leaves the rest alone', () => {
    const cleaned = gitFreeEnv({ GIT_DIR: '/repo/.git', GIT_INDEX_FILE: '/repo/.git/index', PATH: '/usr/bin' });
    assert.deepEqual(cleaned, { PATH: '/usr/bin' });
});

test('a failing suite leaves the failing tests at .gate/<suite>-failures.json', () => {
    const { dir, done } = scratch('run-suite-failing-');
    try {
        const report = path.join(dir, '.gate', 'fixture-report.json');
        const write = `mkdir -p '${path.dirname(report)}' && printf '%s' '${JSON.stringify(REPORT)}' > '${report}'`;
        const written = [];

        const status = main(['fixture', '--', '/bin/sh', '-c', `${write}; exit 1`], dir, (line) => written.push(line));

        assert.equal(status, 1);
        const artefact = JSON.parse(readFileSync(path.join(dir, '.gate', 'fixture-failures.json'), 'utf8'));
        assert.equal(artefact.suite, 'fixture');
        assert.deepEqual(artefact.failures, [
            { test: 'example > fails', file: '/repo/example.test.ts', message: 'expected 1 to be 2' },
        ]);
        assert.match(written.join('\n'), /fixture-failures\.json/);
    } finally {
        done();
    }
});

test('a failing suite that wrote no report says the console is all there is', () => {
    const { dir, done } = scratch('run-suite-noreport-');
    try {
        const written = [];
        const status = main(['crash', '--', '/bin/sh', '-c', 'exit 3'], dir, (line) => written.push(line));

        assert.equal(status, 3);
        assert.match(written.join('\n'), /wrote no machine-readable report/);
        assert.equal(existsSync(path.join(dir, '.gate', 'crash-failures.json')), false);
    } finally {
        done();
    }
});

test('a passing suite leaves no failure record behind', () => {
    const { dir, done } = scratch('run-suite-passing-');
    try {
        assert.equal(main(['ok', '--', '/bin/sh', '-c', 'exit 0'], dir), 0);
        assert.equal(existsSync(path.join(dir, '.gate', 'ok-failures.json')), false);
    } finally {
        done();
    }
});

test('the runner refuses an invocation with no command', () => {
    const { dir, done } = scratch('run-suite-usage-');
    try {
        const written = [];
        assert.equal(main([], dir, (line) => written.push(line)), 2);
        assert.match(written.join('\n'), /usage: tsx scripts\/run-suite\.ts/);
    } finally {
        done();
    }
});

test("run outside any repository, the record lands in the caller's directory", () => {
    const { dir, done } = scratch('run-suite-norepo-');
    try {
        // No GIT_DIR and no repository here, so the root cannot be resolved from git: the
        // runner falls back to the caller's directory instead of crashing.
        const result = spawnSync(process.execPath, [RUNNER, 'outside', '--', '/bin/sh', '-c', 'exit 0'], {
            cwd: dir,
            encoding: 'utf8',
            env: cleanEnv(),
        });

        assert.equal(result.status, 0, result.stderr ?? '');
        assert.equal(existsSync(path.join(dir, '.gate')), true);
    } finally {
        done();
    }
});

test('extractFailures keeps the failing test with its message and drops the passing one', () => {
    assert.deepEqual(extractFailures(REPORT), [
        { test: 'example > fails', file: '/repo/example.test.ts', message: 'expected 1 to be 2' },
    ]);
    assert.deepEqual(extractFailures({ numFailedTests: 0 }), []);
});
