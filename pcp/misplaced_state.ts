import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// The shape the host needs to inject a synthetic text part into the current turn.
// Declared locally rather than imported from @opencode-ai/sdk/v2, so this module
// stays free of V1-only types (it is shared with the V2 plugin port).
export interface SyntheticTextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  synthetic: true;
}

// PCP state lives at <projectDir>/.opencode/pcp. When opencode is started one level *above* the
// project (e.g. the repo root instead of the java/ project dir), the plugin would otherwise create
// a second, divergent state there. This detector looks only at the session directory and its
// immediate children — enough to catch "you ran opencode in the parent folder". It does not
// redirect anything; see misplacedStateWarning's caller.
export function misplacedStateWarning(sessionDir: string): string | null {
  if (hasState(sessionDir)) return null;

  const child = childStateDirs(sessionDir)[0];
  if (!child) return null;

  return (
    `⚠️ PCP: opencode is running in ${sessionDir}, but this repo's PCP state is at ` +
    `${path.join(child, ".opencode", "pcp")}. Run opencode from ${child}.`
  );
}

// The synthetic text part a caller injects into the current turn so the warning reaches the user.
// Returns null when there is nothing to warn about.
export function misplacedMessagePart(
  sessionDir: string,
  sessionID: string,
  messageID: string,
): SyntheticTextPart | null {
  const warning = misplacedStateWarning(sessionDir);
  if (!warning) return null;
  return textPart(warning, sessionID, messageID);
}

/** Wrap already-computed warning text in the synthetic part shape. */
export function textPart(
  text: string,
  sessionID: string,
  messageID: string,
): SyntheticTextPart {
  return {
    id: `prt_${randomUUID()}`,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  };
}

export function hasState(dir: string): boolean {
  return existsSync(path.join(dir, ".opencode", "pcp"));
}

function childStateDirs(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return names
    .filter((name) => !name.startsWith(".") && name !== "node_modules")
    .sort()
    .map((name) => path.join(dir, name))
    .filter(hasState);
}
