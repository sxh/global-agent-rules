// Whether a backlog item is a deferral of work the current task already opened.
//
// A task that edits a file and then records its leftover as a backlog item has not
// finished: the item exists so the next reader believes the work is scheduled, while
// the code stays as the task left it. pcp_capture and pcp_done both consult this
// module, so the rule is stated once — a finding in a file the active task changed
// belongs to that task, and only a recorded reason makes it a decision instead.
//
// Pure by design: the touched paths and the event log are passed in, because the
// plugin's runtime imports do not resolve under `node --test`.

import type { PcpEvent } from "./state.js";

/**
 * Stems too common to prove which file a note meant. A note that says "the state
 * module" is prose, not a reference; blocking it would train the author to write
 * vaguer notes instead of finishing the work.
 */
const GENERIC_STEMS = new Set([
  "index",
  "types",
  "type",
  "constants",
  "constant",
  "schemas",
  "schema",
  "main",
  "app",
  "api",
  "utils",
  "util",
  "helpers",
  "helper",
  "state",
  "store",
  "config",
  "setup",
  "test",
  "tests",
  "styles",
  "style",
  "theme",
  "format",
  "router",
  "routes",
  "README",
  "readme",
  "package",
  "tsconfig",
  "vite",
  "vitest",
  "eslint",
  "hooks",
  "hook",
  "tools",
  "tool",
]);

/** Shortest stem that can identify a file: below this, a match is a coincidence. */
const MIN_STEM = 6;

/** The file's name without its directories or its extension. */
function stemOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

/** One deferral: an item, and the touched files its text names. */
export interface DeferralFinding {
  id: string;
  title: string;
  paths: string[];
}

/** A backlog item as its `backlog_add` event recorded it. */
export interface DeferralItem {
  id: string;
  title: string;
  detail?: string;
  reason?: string;
}

/**
 * The touched files [text] names, in the order they were touched.
 *
 * A full repo-relative path always counts. A bare name counts through its stem, so
 * "the region in PaintSummary" refers to `…/PaintSummary.tsx`; a generic stem does
 * not, so "update the types" refers to nothing.
 */
export function touchedPathsNamed(text: string, touched: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  return touched.filter((path) => {
    if (haystack.includes(path.toLowerCase())) return true;
    const stem = stemOf(path);
    if (stem.length < MIN_STEM) return false;
    if (GENERIC_STEMS.has(stem)) return false;
    if (GENERIC_STEMS.has(stem.toLowerCase())) return false;
    return haystack.includes(stem.toLowerCase());
  });
}

/** When [taskId] was created (or opened as a subtask); null when unknown. */
export function taskStartedAt(events: readonly PcpEvent[], taskId: string | null): number | null {
  if (taskId === null) return null;
  let started: number | null = null;
  for (const event of events) {
    if (event.id !== taskId) continue;
    if (event.e === "created" || event.e === "sub") started = event.ts;
  }
  return started;
}

/**
 * The backlog items added while the task was running that are still open.
 *
 * An unknown start means the item cannot be attributed to this task, so nothing is
 * claimed about it: the guard errs toward recording a deferral, never toward
 * blocking a legitimate one. An item the author has since dismissed, finished or
 * promoted is not a hidden deferral any more — the first two resolve it, and a
 * promotion is a plan step the user saw — so only pending items block a close.
 */
export function itemsCreatedSince(events: readonly PcpEvent[], since: number | null): DeferralItem[] {
  if (since === null) return [];
  const resolved = new Set(
    events
      .filter((event) => event.e === "backlog_done" || event.e === "backlog_dismiss" || event.e === "backlog_promote")
      .map((event) => event.backlog_id ?? event.id)
      .filter((id): id is string => id !== undefined),
  );
  return events
    .filter((event) => event.e === "backlog_add" && event.id !== undefined && event.ts >= since)
    .filter((event) => !resolved.has(event.id ?? ""))
    .map((event) => ({ id: event.id ?? "", title: event.title ?? "", detail: event.detail, reason: event.reason }));
}

/** The items that defer work on a file the task changed, with no reason recorded. */
export function unrecordedDeferrals(
  items: readonly DeferralItem[],
  touched: readonly string[],
): DeferralFinding[] {
  const findings: DeferralFinding[] = [];
  for (const item of items) {
    if ((item.reason ?? "").trim() !== "") continue;
    const paths = touchedPathsNamed(`${item.title}\n${item.detail ?? ""}`, touched);
    if (paths.length > 0) findings.push({ id: item.id, title: item.title, paths });
  }
  return findings;
}

/**
 * The message that refuses a capture, or null when the item may be recorded.
 *
 * Shared by `pcp_capture` so the wording lives with the judgement, and tested here
 * rather than only observed in a tool result.
 */
export function captureRefusal(title: string, detail: string | undefined, touched: readonly string[]): string | null {
  const named = touchedPathsNamed(`${title}\n${detail ?? ""}`, touched);
  if (named.length === 0) return null;
  return [
    "✖ pcp_capture refused: this names a file the active task has already changed.",
    ...named.map((file) => `    ${file}`),
    "",
    "A finding in code this task opened belongs to this task: fix it now, or pass",
    "defer_reason naming what genuinely prevents it. Nothing was recorded.",
    "Capturing it is not scheduling it — the code would stay as this task left it.",
  ].join("\n");
}

/**
 * The message that refuses to close [taskId], or null when it may close.
 *
 * The commit-trailer auto-close calls this too: a task recorded with an unrecorded
 * deferral is not finished, whichever path tried to finish it.
 */
export function closeRefusal(
  events: readonly PcpEvent[],
  taskId: string,
  touched: readonly string[],
): string | null {
  const deferred = unrecordedDeferrals(itemsCreatedSince(events, taskStartedAt(events, taskId)), touched);
  if (deferred.length === 0) return null;
  return [
    "✖ PCP refuses to close this task: it recorded work on files it changed.",
    ...deferred.flatMap((item) => [
      `    [${item.id}] ${item.title}`,
      ...item.paths.map((file) => `        ${file}`),
    ]),
    "",
    "Finish it in this task. If it genuinely cannot be finished now, the item must",
    "carry a recorded reason: dismiss this entry and capture it again with",
    "defer_reason. Nothing was closed and no state was written.",
  ].join("\n");
}
