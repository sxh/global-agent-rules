# OpenCode 2 × PCP — migration investigation

Date: 19 Nov 2026. Verified against the vendor's migration pages (`/docs/migrate-v1`,
`/docs/build/plugins/migrate-v1`, `/docs/plugins`) and against the published type packages
(`@opencode/plugin@2.3.2`, `@opencode/schema@2.3.2`, `@opencode/client@2.3.2`,
`@opencode-ai/plugin@1.19.6`). Not against the V2 binary itself — no empirical boot yet.

## 1. Where we are

| Thing | Version / state |
|---|---|
| Installed CLI | `opencode 1.19.6` — the curl install at `~/.opencode/bin/opencode` (via `~/.local/bin/opencode`); `~/.zshrc` alias points here |
| Homebrew copy | `opencode 1.17.15` still in the Cellar and **pinned**, now vestigial — the `opencode` formula has moved to the 2.x line, so brew cannot supply a 1.x build |
| Homebrew candidate | `opencode` formula is **2.3.2** — a plain `brew upgrade` crosses the major |
| V1 line on npm | `opencode-ai@1.19.6` (latest), `1.18.29`+ required for object plugin entrypoints |
| V2 line | `@opencode/cli@2.3.2` (bin `opencode`, also `opencode2`), `@opencode/plugin@2.3.2` |
| Repo | `~/.config/opencode` is a git repo → rollback is a checkout |
| PCP state | plain files: `<project>/.opencode/pcp/{stack.json,events.jsonl,WORKLOG.md}` — no server/API/schema coupling |

Two `opencode` binaries were installed: the Homebrew copy (1.17.15) and a curl install in
`~/.opencode` (was 1.17.15 too). The shell alias pointed at Homebrew, so that is the one that ran.
The alias now points at `~/.opencode/bin/opencode`, which `opencode upgrade 1.19.6 --method curl`
brought to 1.19.6 — the Homebrew Cellar copy is untouched and 1.17.15 stays available as
`/opt/homebrew/bin/opencode`.

**Object entrypoints verified on 1.19.6, not just documented.** A probe plugin in an isolated
`HOME` exporting `{ id, server }` was called through `.server()` and listed under `plugins:` by
`opencode debug info --print-logs`. The dual export is therefore viable on this install.

V2 does **not** install alongside V1: the installer replaces the binary. V1 config is read and
normalised in memory, so nothing must be converted to try V2.

## 2. The actual break surface

V1 plugin implementations do not run in V2 at all — the registry rejects them, silently.

PCP's coupling to the V1 plugin API is confined to **one file**, `plugins/pcp.ts`:

- 18 tool definitions built with `tool({description, args: tool.schema.*, execute})`; every
  `execute` returns a plain **string**; every one reads `context.directory`.
- 5 hooks by string key: `tool.execute.before`, `tool.execute.after`, `chat.message`,
  `experimental.chat.system.transform`, `experimental.session.compacting`.
- 1 server call: `client.session.get({ path: { id } })` (line 149, `getSessionDir`).
- 1 V1 SDK type import: `TextPart` from `@opencode-ai/sdk/v2` in `pcp/misplaced_state.ts`.

Everything else is already portable: `pcp/*.ts` (19 modules) are pure functions over
`node:fs`/`node:path`; the 25 `.mjs` suites exercise those modules, not the plugin; the
`.opencode/pcp` state format is untouched by V2; skills, agents, commands and `AGENTS.md`
keep working; the contract gate already allows only `default`/`*Plugin` exports.

Two gate scripts read `plugins/pcp.ts` **as text** and needed repointing once the prose moved:
`plugins/test/english-only.test.mjs` (now also scans `pcp/tools.ts` + `pcp/hooks.ts`) and
`plugins/test/plan-sprint-terminology.test.mjs` (now reads `plugins/pcp.ts` + `pcp/tools.ts`
together). `scripts/smoke-plugin-load.sh` greps `PCP initialized` out of
`opencode debug info --print-logs` — V2's service model changes where plugin logs land, so that
probe must be re-proven (or replaced by `opencode plugin list` showing id `pcp`).

## 3. V1 hook → V2 API

| V1 | V2 |
|---|---|
| `tool: {…}` map | `ctx.tool.transform(editor => editor.add({name, description, input, execute}))` |
| `tool.execute.before(input, output)` | `ctx.tool.hook("execute.before", event)` — `event.input` replaces `input.args` |
| `tool.execute.after`, mutate `output.output` | `ctx.tool.hook("execute.after", event)` — `event.result.content` (or `event.status === "error"`) |
| `chat.message`, push a synthetic part | `ctx.session.hook("prompt", event)` — `event.prompt` is a text/files prompt, **no parts array** |
| `experimental.chat.system.transform` | `ctx.session.hook("context", event)` — `event.system.push({type:"text", text})` |
| `experimental.session.compacting` | `ctx.session.hook("compaction", event)` — push to `event.system`, or set `event.result` |
| `client.session.get({path:{id}})` | `ctx.session.get({sessionID})` → `Session.Info.directory` |
| `directory` from plugin input | `ctx.location.directory` (plugin instance location, not the session's) |
| `tool.schema` (zod v4 raw shape) | `input:` one schema, JSON Schema or `StandardSchemaV1` (zod 4 qualifies) |
| string return from `execute` | `{ content: string }` (`Tool.Result` also takes `output`, `metadata`) |
| `event` / `dispose` / `config` | `ctx.event.subscribe({signal})` / cleanup returned by `setup` / domain transforms |

Behavioural deltas, not just renames:

1. **`context` fires only for the primary agent request.** V2 splits prompt admission
   (`prompt`), model-visible context (`context`), and the auxiliary request kinds `compaction`,
   `generate`, `title`. Keeping `PCP_RULE` in every request — today one hook does it — needs up
   to four registrations in V2, or an accepted narrowing.
2. **`chat.message` has no parts array.** The misplaced-directory warning is injected as a
   synthetic text part today; in V2 it can only be prepended to `event.prompt.text`.
3. **Tool context has no `directory`.** `ctx.location.directory` is the plugin's own location;
   for sessions whose directory differs (PCP deliberately handles that) use
   `(await ctx.session.get({sessionID})).directory`, i.e. keep `getSessionDir`.
4. **Tool results are structured.** 18 `return` sites become `{ content: … }`.
5. **`external_directory` is allowed by default in V2** (V1 asked first). Unrelated to PCP but
   it is a silent permission loosening for the agent unless
   `{"action":"external_directory","resource":"*","effect":"ask"}` is added.
6. `lsp` config is accepted but V2 runs no language servers — `jdtls` in `opencode.json` becomes
   inert.

## 4. Forward/backward compatibility: the dual entrypoint

The vendor documents one supported way to run a single implementation on both lines: a default
export that carries both shapes.

```ts
import { Plugin } from "@opencode/plugin";

export default {
  ...Plugin.define({ id: "pcp", setup(ctx) { /* V2 registrations */ } }),
  async server(input) { /* V1 hooks object */ },
};
```

- V2 reads `id` + `setup`; V1 reads `server` (its `PluginModule` type is `{id?, server, tui?}` —
  confirmed in `@opencode-ai/plugin@1.19.6` and `@1.4.10`).
- **V1 object entrypoints need OpenCode ≥ 1.18.29.** On 1.17.15 the loader would try to *call*
  the object as a factory, which is the "registry poisoned, every prompt fails" failure mode.
  So the first step of this plan is a same-line V1 bump to `opencode-ai@1.19.6`, not the V2
  crossing.
- The APIs stay separate — the dual export does **not** translate hooks. Which is why the port
  should push all logic behind a neutral descriptor layer, so a change made on V1 (in `pcp/`)
  shows up in V2 with no second edit.

### Layout (in place since the extraction)

```
plugins/pcp.ts        ~120-line V1 adapter: PCP_TOOLS → tool(), createPcpHooks → hook keys
pcp/tools.ts          PCP_TOOLS = {name, description, args: z.ZodRawShape, run(args, env)} × 18
pcp/hooks.ts          createPcpHooks(deps): beforeTool/afterTool/misplaced/compaction + auto-lifecycle
pcp/*.ts              unchanged pure logic
```

V1 shell: `tool({description, args: t.args, execute: (a, c) => t.run(a, {dir: c.directory, sessionID: c.sessionID})})`
V2 shell: `editor.add({name, description, input: z.object(t.args), execute: (a, c) => ({content: t.run(a, {dir: await sessionDir(c.sessionID), sessionID: c.sessionID})})})`

The `run` bodies are pure moves of the current `execute` bodies; the 18 tool surfaces are simple
(strings, optional strings, numbers, booleans, `array(string)`), so zod → StandardSchema poses no
conversion problem. `pcp/misplaced_state.ts` drops the `@opencode-ai/sdk` type import and returns
a locally-declared `{type:"text", text, synthetic:true}` shape.

## 5. Work breakdown

1. ~~Bump V1 to `opencode-ai@1.19.6`.~~ **Done (19 Nov 2026).** `opencode upgrade 1.19.6
   --method curl` moved the `~/.opencode` install from 1.17.15 → 1.19.6; the `~/.zshrc` alias now
   points at that binary instead of the Homebrew Cellar copy (which stays at 1.17.15, pinned, and
   is the reinstall route if a rollback is ever needed). Gates re-run green on 1.19.6, the plugin
   loads, all 18 tools register and a live `pcp_status` round-trips.
2. ~~Extract the 18 tools to `pcp/tools.ts` and the 5 hook bodies to `pcp/hooks.ts`.~~
   **Done (19 Nov 2026).** Still V1-only and behaviour-identical; `plugins/pcp.ts` is now a
   ~120-line adapter (`PCP_TOOLS` → `tool()`, `createPcpHooks` → the five string-keyed hooks).
   Verified: both tsconfigs clean, 232/232 test files pass, `check-contract.sh` green
   (coverage 97.31%), all 18 tools registered via `opencode debug agent stepwise`, and live
   `pcp_status` / `pcp_capture` + `pcp_backlog` runs against a scratch project wrote real state.
   The five hook paths were exercised directly against temp stacks under `bun` (auto-advance,
   `PCP-Task` trailer close, unrelated-commit no-op, unplanned-edit warning once per session,
   compaction context, misplaced warning).
   Note: `pcp/tools.ts` and `pcp/hooks.ts` import `./x.js` specifiers like the rest of `pcp/`, so
   `node --test` cannot load them — hook-level regression tests must run under `bun test`
   (the 25 existing `.mjs` suites stay valid because they only import the leaf modules).
3. ~~Rewrite `plugins/pcp.ts` as the dual shell.~~ **Done (19 Nov 2026).** One default export:
   `{ id: "pcp", setup: v2Setup, server: v1Server }`. Shared plumbing (`sessionDirs`,
   `ensureRule`, `resultText`) sits above both halves; each half is a thin registration layer.
   The V1 `tool` helper is imported lazily inside `server()`, so a V2 host never loads
   `@opencode-ai/plugin`. `@opencode/plugin@2.3.2` is a devDependency used for types only
   (installed with `--legacy-peer-deps` to keep its seven GUI/TUI peers — electron, vite,
   solid — out of the tree), and `zod` is now an explicit dependency.
   Verified: both tsconfigs clean; the V1 gates stay green (18 tools, live `pcp_status`);
   `scripts/probe-plugin-v2.mjs` drives `setup()` against a fake V2 context and passes —
   18 tools with zod schemas, a `pcp_capture` → `pcp_backlog` round-trip returning
   `{content}`, all seven hook registrations, the rule exactly once in
   context/title/generate/compaction, the unplanned-edit warning once per session, and the
   misplaced warning prepended to prompt text.
   Findings worth keeping: the V2 session directory is `info.location.directory` (not
   `info.directory`); `event.result` is assignable, so the after-hook replaces the result
   object rather than mutating readonly `content`; V1 1.19.6 ignores the extra `setup` key on
   the module object.
4. Behavioural deltas — **decided in code**: the rule is registered per request kind, the
   misplaced warning rides in the prompt text, tool results are structured. Still open:
   adding `{"action":"external_directory","resource":"*","effect":"ask"}` to the config so V2
   keeps V1's outside-project prompt.
5. Type-check both projects (done); `scripts/probe-plugin-v2.mjs` is the manual V2-half probe
   (needs bun, so it is deliberately outside `check-contract.sh`).
6. Update the smoke check for V2 (`opencode plugin list` showing `pcp` instead of grepping
   `PCP initialized` logs). Not started — needs a V2 binary to write against.
7. Cross the line on a scratch clone: install 2.3.2, `opencode plugin list` shows `pcp`, then
   exercise each of the 18 tools and each hook (before/after write, commit trailer, compaction,
   system rule, misplaced warning).
8. Only then unpin/upgrade the working install; keep the 1.17.15 reinstall command and the
   `git checkout` of `~/.config/opencode` as rollback.

Two `opencode` binaries make the crossing cheap: Homebrew holds the 2.x line and the curl
install in `~/.opencode` holds 1.x, so `brew upgrade opencode` produces a 2.3.2 binary at
`/opt/homebrew/bin/opencode` while the `opencode` alias keeps pointing at V1. There is no
in-place replacement and no rollback cliff — which is the opposite of the "all-or-nothing
install" note below, so treat that risk as resolved for this machine.

## 6. Risks

- ~~**All-or-nothing install.**~~ Resolved on this machine: Homebrew (2.x) and the `~/.opencode`
  curl install (1.x) coexist, so the major can be crossed without destroying the V1 path.
- **Config normalisation is in-memory.** After V2 writes config (or after a native-V2
  conversion) V1 may no longer read the same file — do not point V1 at converted files.
- **Silent plugin failure.** A rejected plugin leaves the agent running with no tools. Verify
  `pcp` appears in `opencode plugin list` before trusting any session.
- **Session history.** The migration page does not state whether V2 imports V1 session history;
  check before upgrading if old sessions matter.
- ~~**Plugin zod coupling.**~~ Resolved: `zod` is a declared dependency at 4.1.8 and is the single
  instance both hosts see (V1's raw shape, V2's `z.object(...)` as `StandardSchemaV1`).
