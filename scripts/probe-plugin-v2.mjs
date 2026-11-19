#!/usr/bin/env bun
// Probe the V2 half of the dual plugin without a V2 binary.
//
// plugins/pcp.ts carries two hosts: `server()` for OpenCode 1.x and `setup(ctx)` for 2.x.
// Node cannot import the plugin (its modules use `.js` specifiers), and the gate in
// check-contract.sh must not depend on V2 being installed — so this probe calls setup()
// against a fake V2 context that records what it registers, then exercises the registrations.
//
// Usage:  bun scripts/probe-plugin-v2.mjs
//
// It is deliberately not part of check-contract.sh: it needs bun, and it imports a plugins/
// module at runtime, which section 7b forbids for node --test suites.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { default: pcp } = await import(join(root, "plugins/pcp.ts"));
const { PCP_RULE } = await import(join(root, "pcp/pcp_rule.ts"));

/** A fake V2 context: records tools and hooks, resolves every session to `dir`. */
function fakeContext(dir) {
  const tools = [];
  const toolHooks = {};
  const sessionHooks = {};
  const editor = {
    add: (t) => tools.push(t),
    update: () => {},
    remove: () => {},
    list: () => tools,
    get: (id) => tools.find((t) => t.name === id),
    namespace: () => {},
  };
  const ctx = {
    location: { directory: dir, project: { id: "probe" } },
    options: {},
    tool: {
      transform: async (cb) => {
        cb(editor);
        return { dispose: async () => {} };
      },
      hook: async (name, cb) => {
        toolHooks[name] = cb;
        return { dispose: async () => {} };
      },
    },
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: dir } }),
      hook: async (name, cb) => {
        sessionHooks[name] = cb;
        return { dispose: async () => {} };
      },
    },
  };
  return { ctx, tools, toolHooks, sessionHooks };
}

const dir = mkdtempSync(join(tmpdir(), "pcp-v2-probe-"));
const parent = mkdtempSync(join(tmpdir(), "pcp-v2-parent-"));

try {
  assert.equal(typeof pcp.setup, "function", "default export must carry setup() for V2");
  assert.equal(typeof pcp.server, "function", "default export must still carry server() for V1");
  assert.equal(pcp.id, "pcp", "default export must carry the plugin id");

  const { ctx, tools, toolHooks, sessionHooks } = fakeContext(dir);
  await pcp.setup(ctx);

  // 1. Tools: 18 registered, each with a zod schema and an execute.
  assert.equal(tools.length, 18, `expected 18 tools, got ${tools.length}`);
  for (const t of tools) {
    assert.equal(typeof t.name, "string");
    assert.equal(typeof t.description, "string");
    assert.ok(t.input && typeof t.input.safeParse === "function", `${t.name} input is not a zod schema`);
    assert.equal(typeof t.execute, "function");
  }
  console.log(`setup: ${tools.length} tools registered with zod schemas ✓`);

  // 2. A tool round-trips through the V2 execute signature and writes real state.
  const captured = await tools.find((t) => t.name === "pcp_capture").execute(
    { title: "v2 probe item" },
    { sessionID: "s1" },
  );
  assert.ok(captured && typeof captured.content === "string", "execute must return {content}");
  assert.match(captured.content, /Logged to backlog/);
  const listed = await tools.find((t) => t.name === "pcp_backlog").execute({}, { sessionID: "s1" });
  assert.match(listed.content, /v2 probe item/);
  console.log("execute: pcp_capture → pcp_backlog round-trip ✓");

  // 3. Hooks landed on the V2 names.
  for (const name of ["execute.before", "execute.after"]) {
    assert.equal(typeof toolHooks[name], "function", `missing tool hook ${name}`);
  }
  for (const name of ["prompt", "context", "title", "generate", "compaction"]) {
    assert.equal(typeof sessionHooks[name], "function", `missing session hook ${name}`);
  }
  console.log("hooks: execute.before/after + prompt/context/title/generate/compaction ✓");

  // 4. V2 splits request kinds, so the rule must reach every one of them — exactly once.
  for (const name of ["context", "title", "generate", "compaction"]) {
    const event = { sessionID: "s1", system: [], messages: [], options: {}, model: { providerID: "p", id: "m" } };
    await sessionHooks[name](event);
    await sessionHooks[name](event);
    const rules = event.system.filter((part) => part.text === PCP_RULE);
    assert.equal(rules.length, 1, `${name} carries the rule ${rules.length} times`);
  }
  console.log("system rule: exactly once in context/title/generate/compaction ✓");

  // 5. execute.after appends the unplanned-edit warning, once per session.
  const after = {
    tool: "edit",
    sessionID: "s9",
    agent: "build",
    messageID: "m1",
    id: "call1",
    input: {},
    status: "completed",
    result: { content: "file written" },
  };
  await toolHooks["execute.after"](after);
  assert.match(after.result.content, /No active task was engaged/, "warning not appended");
  const second = { ...after, result: { content: "file written" } };
  await toolHooks["execute.after"](second);
  assert.equal(second.result.content, "file written", "warned twice in one session");
  console.log("execute.after: unplanned-edit warning, once per session ✓");

  // 6. prompt: silent in a correct directory…
  const clean = { sessionID: "s1", prompt: { text: "hello" } };
  await sessionHooks.prompt(clean);
  assert.equal(clean.prompt.text, "hello");
  console.log("prompt: no misplaced warning in a correct directory ✓");

  // 7. …and prepended to the prompt text when opencode sits above its PCP state.
  mkdirSync(join(parent, "child", ".opencode", "pcp"), { recursive: true });
  const misplacedCtx = fakeContext(parent);
  await pcp.setup(misplacedCtx.ctx);
  const misplaced = { sessionID: "s7", prompt: { text: "hello" } };
  await misplacedCtx.sessionHooks.prompt(misplaced);
  assert.match(misplaced.prompt.text, /PCP: opencode is running in/, "warning not prepended");
  assert.ok(misplaced.prompt.text.endsWith("hello"));
  console.log("prompt: misplaced warning prepended to the prompt text ✓");
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(parent, { recursive: true, force: true });
}
