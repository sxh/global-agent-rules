// Pure task lifecycle (B079).
//
// Task state is derived from the append-only event log: created/sub -> open;
// done/pivoted -> closed; resume_set -> prompt; renamed -> title update.
// Keeping the replay free of filesystem I/O lets it be unit-tested directly,
// matching the backlog_state.ts / pcp_start.ts / pcp_promote.ts pattern;
// state.ts's replayEvents wires it to the event log.

import type { PcpEvent, Task } from "./state.js";

export function applyTaskEvents(events: PcpEvent[]): Task[] {
  const tasks = new Map<string, Task>();

  for (const event of events) {
    if (event.e === "created" && event.id) {
      tasks.set(event.id, {
        id: event.id,
        type: event.type ?? "main",
        title: event.title ?? "",
        done: false,
      });
    } else if (event.e === "sub" && event.id) {
      tasks.set(event.id, {
        id: event.id,
        type: "sub",
        title: event.title ?? "",
        parent: event.parent,
        done: false,
      });
    } else if ((event.e === "done" || event.e === "pivoted") && event.id) {
      const task = tasks.get(event.id);
      if (task) {
        task.done = true;
        if (event.e === "pivoted") task.pivoted = true;
        if (event.reason) task.pivot_reason = event.reason;
      }
    } else if (event.e === "resume_set" && event.id) {
      const task = tasks.get(event.id);
      if (task) task.resume_prompt = event.prompt;
    } else if (event.e === "renamed" && event.id && event.title) {
      // B079: rename an existing task in place. Unknown ids are ignored (never
      // resurrected) and a missing title is ignored (never blanks a real title).
      const task = tasks.get(event.id);
      if (task) task.title = event.title;
    }
  }

  return Array.from(tasks.values());
}

export function formatEventSummary(event: PcpEvent): string {
  switch (event.e) {
    case "created":
      return `Created main task [${event.id}] ${event.title ?? ""}`.trim();
    case "sub":
      return `Created subtask [${event.id}] ${event.title ?? ""}`.trim();
    case "done":
      return `Completed task [${event.id}]`;
    case "pivoted":
      return `Task [${event.id}] pivoted: ${event.reason ?? "no reason given"}`;
    case "resume_set":
      return `Updated resume prompt [${event.id}] ${event.prompt ?? ""}`.trim();
    case "renamed":
      return `Renamed task [${event.id}] ${event.title ?? ""}`.trim();
    case "project_context":
      return `Updated project baseline: ${event.summary ?? ""}`.trim();
    case "backlog_add":
      return `Logged backlog [${event.id}] ${event.title ?? ""}`.trim();
    case "backlog_promote":
      return `Promoted backlog [${event.backlog_id}] into task [${event.task_id}]`;
    case "backlog_done":
      return `Marked backlog [${event.backlog_id}] done`;
    case "backlog_dismiss":
      return `Dismissed backlog [${event.backlog_id}]`;
    case "backlog_demote":
      return `Returned backlog [${event.backlog_id}] to pending`;
    default:
      return event.e;
  }
}

// E1/B014: the most recent event, summarised for the status view.
export function lastEventSummary(events: PcpEvent[]): string | null {
  if (events.length === 0) return null;
  return formatEventSummary(events[events.length - 1]);
}
