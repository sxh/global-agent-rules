import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Plugin as V2Api } from "@opencode/plugin";

import {
  createOverwriteGuard,
  gitTracked,
  lineCount,
} from "../pcp/overwrite_guard.js";
import { isReadTool, isWholeFileWrite, writtenPath } from "../pcp/tool_classify.js";

// B289: a whole-file write replaced a tracked test file holding eleven live tests, and the
// suite stayed green. The decision lives in pcp/overwrite_guard.ts; this file owns only the
// dual-host wiring, mirroring plugins/format.ts.
//
// This directory may export only plugin factories: opencode invokes every export of a
// top-level plugins/*.ts as a plugin factory (scripts/check-contract.sh section 8).

const guard = createOverwriteGuard({
  writtenPath,
  isWholeFileWrite,
  isReadTool,
  isTracked: gitTracked,
  lineCount,
});

/** The refusal a call would earn, thrown so the host aborts it before it runs. */
function refuse(call: Parameters<typeof guard.refusal>[0]): void {
  const refusal = guard.refusal(call);
  if (refusal !== null) throw new Error(refusal);
}

const v1Server: Plugin = async ({ directory }: PluginInput) => ({
  "tool.execute.after": async (input) => {
    guard.recordRead({
      tool: input.tool,
      args: input.args,
      workspace: directory,
      sessionID: input.sessionID,
    });
  },
  "tool.execute.before": async (input, output) => {
    refuse({
      tool: input.tool,
      args: output.args,
      workspace: directory,
      sessionID: input.sessionID,
    });
  },
});

const v2Setup = async (ctx: V2Api.Context): Promise<void> => {
  await ctx.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed") return;
    guard.recordRead({
      tool: event.tool,
      args: event.input,
      workspace: ctx.location.directory,
      sessionID: event.sessionID,
    });
  });

  await ctx.tool.hook("execute.before", async (event) => {
    refuse({
      tool: event.tool,
      args: event.input,
      workspace: ctx.location.directory,
      sessionID: event.sessionID,
    });
  });
};

const v2Plugin: V2Api.Plugin = { id: "overwrite-guard", setup: v2Setup };

export default {
  ...v2Plugin,
  server: v1Server,
};
