# PCP recovery runbook

The PCP plugin is loaded by opencode at startup. A module that throws while loading can leave
the plugin registry malformed and make opencode **unstartable** (the 2026-09-18 incident: a pure
helper parked in `plugins/` was invoked as a plugin factory). This is the anchor to roll back to
and the recovery procedure when something goes wrong.

## Ownership

`plugins/pcp.ts` is a **local fork** of the pcp-skills plugin (forked 2026-09-18). It is owned in
this repo and is **not** re-downloaded. The former `PCP_*_FIX` markers are kept only as labels
for git history; do not run the upstream installer over this file, as it would drop local work
(notably `pcp_reorder`).

## Anchor

- **Git tag:** `pcp-known-good-2026-09-18` → `3f421090443c4ff8564e3a479271a8d4976a1438`
  (the A0–A2 gate safety net plus the `pcp_reorder` verb — the last verified-good state before
  the structural refactor).
- **Off-git backup:** `~/pcp-backups/20260918T151735Z/`
  - `config/` — `opencode.json`, `plugins/`, `pcp/`, `scripts/`
  - `live/` — this session's `~/.opencode/pcp/` state

  Off-git on purpose: `git reset --hard` cannot touch it.

## If opencode will not start

1. **Bypass the plugin:** `opencode --pure` starts with no external plugins.
2. **Disable the plugin:**
   `mv ~/.config/opencode/plugins/pcp.ts ~/.config/opencode/plugins/pcp.ts.disabled`
   Then opencode starts with the plugin ignored.
3. Fix or revert (below), then rename the file back to `pcp.ts`.

## If a change is bad but opencode starts

- One change: `git revert <sha>` in `~/.config/opencode`, then re-run the gate.
- Rewind to the anchor: `git reset --hard pcp-known-good-2026-09-18`.
- Restore from the backup if needed, e.g.
  `cp -R ~/pcp-backups/<ts>/config/plugins/pcp.ts ~/.config/opencode/plugins/`.

## The gate

`bash scripts/check-contract.sh` is the canonical gate. It includes the plugin-load smoke check
(section 9) and enforces the coverage floor. Run it after any recovery.

## Drill evidence (2026-09-18)

| Step | Command | Result |
|---|---|---|
| Escape hatch | `opencode --pure debug info --print-logs` | exit 0, `PCP initialized` × 0 |
| Disabled plugin | `HOME=<fake> opencode debug info --print-logs` | exit 0, `plugins: none` |
| Smoke detects it | `SMOKE_HOME=<fake> scripts/smoke-plugin-load.sh` | exit 1, "did not initialise" |

## Maintaining this anchor

Re-point the tag (`git tag -f pcp-known-good-<date>`) and take a fresh backup after each stable
milestone. Never point it at a commit whose gate has not passed.

## Known issue: auto-created stale active task (2026-09-19)

When a PCP write runs with no active task, the plugin can create a task named from the session's
first message (e.g. `Reorder tasks: T157 before T156`). It then lingers as the active task and
blocks `pcp_start` for unrelated work. Observed repeatedly: T137/T139/T141/T146 (2026-09-18) and
T177/T179 (2026-09-19, T179 recreated immediately after T177 was pivoted).

Fixed 2026-09-20: the auto-create branch was removed — a write tool with no active task now only
activates the queued head and never invents a task from the session title (`pcp/task_flow.ts`
`decideAutoCreate` returns `skip-idle`; `plugins/pcp.ts` `autoActivateQueuedTask`; marker
`PCP_NO_TITLE_TASK_FIX`). Recovery via `pcp_pivot` remains available for any stale task.
