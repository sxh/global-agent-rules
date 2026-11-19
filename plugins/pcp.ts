import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Plugin as V2Api } from "@opencode/plugin";
import { z } from "zod";

import { PCP_TOOLS } from "../pcp/tools.js";
import { createPcpHooks } from "../pcp/hooks.js";
import { PCP_RULE } from "../pcp/pcp_rule.js";
import { textPart } from "../pcp/misplaced_state.js";

// Dual host adapter: one default export that satisfies both plugin APIs, so the same file
// runs on OpenCode 1.x (calls `server`) and 2.x (reads `id` + `setup`). All the substance
// lives in pcp/ — the 18 tool bodies in pcp/tools.ts, the hook decisions in pcp/hooks.ts —
// so neither half contains logic of its own. See docs/opencode2-pcp-migration.md.
//
// This directory may export only plugin factories: opencode invokes every export of a
// top-level plugins/*.ts as a plugin factory (see scripts/check-contract.sh section 8).
// Helpers belong in pcp/, a sibling directory opencode does not scan.

// ──────────────────────────────────────────────
// System-prompt rule
// ──────────────────────────────────────────────

// PCP behavioral rule — always injected to ALL agents.
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
// Shared plumbing (host-agnostic)
// ──────────────────────────────────────────────

type SessionDir = (sessionID: string) => Promise<string>;

/** The structural slice of a system prompt either host lets a plugin append to. */
type SystemParts = Array<{ type: "text"; text: string }>;

/**
 * Memoise a session → project directory lookup. Both hosts expose the session record
 * differently, so the caller supplies the lookup; the fallback covers lookup failures.
 */
function sessionDirs(
  fallback: string,
  lookup: (sessionID: string) => Promise<string | undefined>,
): SessionDir {
  const cache = new Map<string, string>();
  return async (sessionID) => {
    const hit = cache.get(sessionID);
    if (hit) return hit;
    try {
      const dir = (await lookup(sessionID)) ?? fallback;
      cache.set(sessionID, dir);
      return dir;
    } catch {
      return fallback;
    }
  };
}

/**
 * V1 had one `experimental.chat.system.transform` covering every request; V2 hooks are
 * per request kind (context / compaction / title / generate), so each one has to add the
 * rule itself or auxiliary requests lose it.
 */
function ensureRule(system: SystemParts): void {
  if (!system.some((part) => part.text === PCP_RULE)) {
    system.push({ type: "text", text: PCP_RULE });
  }
}

/** Flatten a V2 tool result's content to the text the unplanned-edit check reasons about. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
}

// ──────────────────────────────────────────────
// V1 host (OpenCode 1.x): `server(input)` returns the hooks object
// ──────────────────────────────────────────────

const v1Server: Plugin = async ({ directory, client }: PluginInput) => {
  console.log("PCP initialized");

  // Imported lazily so the V1 package is never loaded by a V2 host.
  const { tool } = await import("@opencode-ai/plugin/tool");

  const sessionDir = sessionDirs(directory, async (sessionID) => {
    const resp = await client.session.get({ path: { id: sessionID } });
    return (resp.data as any)?.directory as string | undefined;
  });

  const hooks = createPcpHooks({ sessionDir });

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
    tool: tools,

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

// ──────────────────────────────────────────────
// V2 host (OpenCode 2.x): `setup(ctx)` registers hooks, transforms and tools
// ──────────────────────────────────────────────

const v2Setup = async (ctx: V2Api.Context): Promise<void> => {
  console.log("PCP initialized");

  const sessionDir = sessionDirs(
    ctx.location.directory,
    async (sessionID) => (await ctx.session.get({ sessionID })).location.directory,
  );

  const hooks = createPcpHooks({ sessionDir });

  // Tools: V2 wants one schema per tool (a zod object qualifies as StandardSchemaV1) and a
  // structured result, so `run`'s text becomes `content`.
  await ctx.tool.transform((editor) => {
    for (const t of PCP_TOOLS) {
      editor.add({
        name: t.name,
        description: t.description,
        input: z.object(t.args),
        async execute(args, call) {
          const dir = await sessionDir(call.sessionID);
          return { content: await t.run(args, { dir, sessionID: call.sessionID }) };
        },
      });
    }
  });

  await ctx.tool.hook("execute.before", async (event) => {
    await hooks.beforeTool({ tool: event.tool, sessionID: event.sessionID });
  });

  await ctx.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed") return;
    const replacement = await hooks.afterTool(
      { tool: event.tool, sessionID: event.sessionID, args: event.input },
      resultText(event.result.content),
    );
    if (replacement !== null) {
      event.result = { ...event.result, content: replacement };
    }
  });

  // V2 has no parts array on the submitted prompt, so the misplaced-directory warning is
  // prepended to the prompt text instead of being injected as a synthetic part.
  await ctx.session.hook("prompt", async (event) => {
    const warning = await hooks.misplaced(event.sessionID);
    if (warning) event.prompt.text = `${warning}\n\n${event.prompt.text}`;
  });

  // One registration per request kind — see ensureRule.
  await ctx.session.hook("context", (event) => {
    ensureRule(event.system);
  });

  await ctx.session.hook("title", (event) => {
    ensureRule(event.system);
  });

  await ctx.session.hook("generate", (event) => {
    ensureRule(event.system);
  });

  await ctx.session.hook("compaction", async (event) => {
    ensureRule(event.system);
    const resume = await hooks.compaction(event.sessionID);
    if (resume) event.system.push({ type: "text", text: resume });
  });
};

const v2Plugin: V2Api.Plugin = { id: "pcp", setup: v2Setup };

export default {
  ...v2Plugin,
  server: v1Server,
};
