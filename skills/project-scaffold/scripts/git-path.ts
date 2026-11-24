/**
 * Promoted from paints-app (2026-11-24). Shared by `run-suite.ts` and
 * `check-changed-line-coverage.ts`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The git executable resolved to an absolute path, so a gate cannot be
 * redirected by whatever `PATH` the hook or a caller happens to carry.
 */
export function resolveGit(): string {
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']) {
        const candidate = path.join(dir, 'git');
        if (existsSync(candidate)) return candidate;
    }
    throw new Error('git executable not found in the known locations');
}

/**
 * The repository root, taken from git rather than the caller's directory: a gate
 * is invoked from wherever the commit happens to run — a package directory
 * included — while its inputs live at the root, not beside the caller (B262).
 */
export function repoRoot(run: (args: string[]) => string): string {
    const top = run(['rev-parse', '--show-toplevel']).trim();
    return top.length > 0 ? top : process.cwd();
}
