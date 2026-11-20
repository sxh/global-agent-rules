import path from 'node:path';

/**
 * Where a handoff lives: the project root, not the pcp state directory.
 *
 * A handoff describes one project, and several projects are live at once, so a
 * single shared location cannot work; writing it under `.opencode/pcp/` also
 * makes every session move the file, and whichever copy goes stale wins by
 * accident.
 */
export function handoffPath(dir: string): string {
  return path.join(dir, 'HANDOFF.md');
}
