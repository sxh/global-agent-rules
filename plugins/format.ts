import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Plugin as V2Api } from "@opencode/plugin";

import { formatWrittenFile } from "../format/on_write.js";
import { isWriteTool } from "../pcp/tool_classify.js";

// B284: format the file an edit tool just wrote, so the pre-commit gate stops rediscovering
// formatting. The decision and the run live in format/on_write.ts; this file owns only the
// dual-host wiring (OpenCode 1.x calls `server`, 2.x reads `id` + `setup`), mirroring
// plugins/pcp.ts. See docs/opencode2-pcp-migration.md.
//
// This directory may export only plugin factories: opencode invokes every export of a
// top-level plugins/*.ts as a plugin factory (scripts/check-contract.sh section 8). Helpers
// belong in format/ or pcp/, sibling directories opencode does not scan.

const v1Server: Plugin = async ({ directory }: PluginInput) => ({
  "tool.execute.after": async (input) => {
    formatWrittenFile({
      tool: input.tool,
      args: input.args,
      workspace: directory,
      isWriteTool,
    });
  },
});

const v2Setup = async (ctx: V2Api.Context): Promise<void> => {
  await ctx.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed") return;
    formatWrittenFile({
      tool: event.tool,
      args: event.input,
      workspace: ctx.location.directory,
      isWriteTool,
    });
  });
};

const v2Plugin: V2Api.Plugin = { id: "format-on-write", setup: v2Setup };

export default {
  ...v2Plugin,
  server: v1Server,
};
