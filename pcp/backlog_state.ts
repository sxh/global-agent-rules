// Pure backlog lifecycle (B077/P2).
//
// Backlog state is derived from the append-only event log: add -> pending;
// promote -> promoted (recording the task it became); done -> done; dismiss ->
// dismissed. Keeping the replay free of filesystem I/O lets it be unit-tested
// directly, matching the pcp_start.ts / pcp_promote.ts decision modules;
// state.ts's replayBacklog wires it to the event log.

import type { BacklogItem, PcpEvent, PlanEntry } from "./state.js";

export function applyBacklogEvents(events: PcpEvent[]): BacklogItem[] {
  const items = new Map<string, BacklogItem>();

  for (const event of events) {
    if (event.e === "backlog_add" && event.id) {
      items.set(event.id, {
        id: event.id,
        title: event.title ?? "",
        detail: event.detail,
        status: "pending",
      });
    } else if (event.e === "backlog_promote" && event.backlog_id) {
      const item = items.get(event.backlog_id);
      if (item) {
        item.status = "promoted";
        item.promoted_to = event.task_id;
      }
    } else if (event.e === "backlog_done" && event.backlog_id) {
      const item = items.get(event.backlog_id);
      if (item) item.status = "done";
    } else if (event.e === "backlog_dismiss" && event.backlog_id) {
      const item = items.get(event.backlog_id);
      if (item) item.status = "dismissed";
    } else if (event.e === "backlog_demote" && event.backlog_id) {
      const item = items.get(event.backlog_id);
      if (item) {
        item.status = "pending";
        item.promoted_to = undefined;
      }
    }
  }

  return Array.from(items.values());
}

export function pendingBacklog(items: BacklogItem[]): BacklogItem[] {
  return items.filter((item) => item.status === "pending");
}

// The lookup + status guard shared by pcp_promote / pcp_dismiss / pcp_backlog_done. Each verb
// maps the decision to its own message wording.
export type BacklogAction =
  | { kind: "ok"; item: BacklogItem }
  | { kind: "unknown"; id: string }
  | { kind: "not-pending"; id: string; status: BacklogItem["status"] };

export function decideBacklogAction(items: BacklogItem[], id: string): BacklogAction {
  const item = items.find((entry) => entry.id === id);
  if (!item) return { kind: "unknown", id };
  if (item.status !== "pending") return { kind: "not-pending", id, status: item.status };
  return { kind: "ok", item };
}

// pcp_plan may take a backlog id (e.g. "B099") in place of a title (B100). Resolve each entry:
// an exact backlog id becomes the pending item's title plus its id (so the handler emits
// backlog_promote and the item stops being pending); anything else passes through as a title.
// Reuses decideBacklogAction so the pending guard has one home.
export type PlanResolution =
  | { kind: "ok"; entries: PlanEntry[] }
  | { kind: "unknown-backlog"; id: string }
  | { kind: "not-pending-backlog"; id: string; status: BacklogItem["status"] };

const BACKLOG_ID = /^B\d+$/;

export function resolvePlanEntries(entries: string[], backlog: BacklogItem[]): PlanResolution {
  const resolved: PlanEntry[] = [];
  for (const entry of entries) {
    if (!BACKLOG_ID.test(entry)) {
      resolved.push({ title: entry });
      continue;
    }
    const action = decideBacklogAction(backlog, entry);
    if (action.kind === "unknown") return { kind: "unknown-backlog", id: entry };
    if (action.kind === "not-pending") {
      return { kind: "not-pending-backlog", id: entry, status: action.status };
    }
    resolved.push({ title: action.item.title, backlogId: entry });
  }
  return { kind: "ok", entries: resolved };
}
