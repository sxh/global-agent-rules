import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { PCP_TOOLS } from "../pcp/tools.js";
import { createPcpHooks } from "../pcp/hooks.js";
import { PCP_RULE } from "../pcp/pcp_rule.js";
import { textPart } from "../pcp/misplaced_state.js";

// V1 host adapter. Everything substantive lives in pcp/ — the 18 tool bodies in
// pcp/tools.ts and the hook decisions in pcp/hooks.ts — so this file only wires the V1
// plugin API to them. That keeps the logic portable to the V2 plugin API (see
// docs/opencode2-pcp-migration.md) instead of forking it.
//
// This directory may export only plugin factories: opencode invokes every export of a
// top-level plugins/*.ts as a plugin factory (see scripts/check-contract.sh section 8).
// Helpers belong in pcp/, a sibling directory opencode does not scan.

// ──────────────────────────────────────────────
// System-prompt rule
// ──────────────────────────────────────────────

// PCP behavioral rule — always injected to ALL agents via system.transform.
//
// PCP_CACHE_FIX (forked locally; not re-downloaded):
// This rule is the ONLY thing injected into the system prompt. It is a constant, so the system
// array is byte-identical on every request and the prompt cache stays warm for the whole
// session. Volatile state used to be appended alongside it, which put changing values at the very
// front of each request: any change (PCP advances the active task on every commit) invalidated the
// prefix and forced a full re-prefill of the entire conversation — measured at ~140s for 37k
// tokens on the M1 Pro. Task state is available on demand via pcp_status / pcp_backlog.
// Do NOT reintroduce changing values here.

// ──────────────────────────────────────────────
// Plugin
// ──────────────────────────────────────────────

export const PCPPlugin: Plugin = async ({ directory, client }) => {
  console.log("PCP initialized");

  // ── Session helpers (cached to avoid repeated API calls) ────

  const sessionDirCache = new Map<string, string>();

  async function getSessionDir(sessionID: string): Promise<string> {
    const cached = sessionDirCache.get(sessionID);
    if (cached) return cached;
    try {
      const resp = await client.session.get({ path: { id: sessionID } });
      const dir: string = (resp.data as any)?.directory ?? directory;
      sessionDirCache.set(sessionID, dir);
      return dir;
    } catch {
      return directory;
    }
  }

  const hooks = createPcpHooks({ sessionDir: getSessionDir });

  const tools = Object.fromEntries(
    PCP_TOOLS.map((t) => [
      t.name,
      tool({
        description: t.description,
        args: t.args,
        async execute(args, context) {
          return t.run(args, { dir: context.directory, sessionID: context.sessionID });
        },
      }),
    ]),
  );

  return {
    // ── Tools ──────────────────────────────────

    tool: tools,

    // ── Auto-lifecycle hooks ────────────────────

    "tool.execute.before": async (input) => {
      await hooks.beforeTool(input);
    },

    "tool.execute.after": async (input, output) => {
      const replacement = await hooks.afterTool(input, output.output);
      if (replacement !== null) output.output = replacement;
    },

    // Warn immediately (once per session) when opencode is running one level above its PCP state
    // — e.g. in the repo root instead of the project dir — so a divergent state is not created
    // silently. Injected as a synthetic message part: the dynamic channel, since the system array
    // is cached and must stay constant (see PCP_CACHE_FIX above).
    "chat.message": async (input, output) => {
      const warning = await hooks.misplaced(input.sessionID);
      if (!warning) return;
      output.parts.push(textPart(warning, input.sessionID, output.message.id));
    },

    // ── Context injection hooks ─────────────────

    // Constant only — see the PCP_CACHE_FIX note. Anything that changes between turns
    // belongs at the *end* of the request (a message), never in the system array.
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        if (!output.system.includes(PCP_RULE)) output.system.push(PCP_RULE);
      } catch {
        // silent
      }
    },

    "experimental.session.compacting": async (input, output) => {
      const ctx = await hooks.compaction(input.sessionID);
      if (ctx) output.context.push(ctx);
    },
  };
};

export default PCPPlugin;
