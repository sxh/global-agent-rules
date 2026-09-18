// Classify a tool name for PCP's auto-lifecycle hooks.
//
// These live in pcp/ rather than plugins/ because opencode auto-discovers
// plugins/*.{ts,js} and invokes every export of such a module as a plugin
// factory. A helper exported there is called with a plugin-input object and
// throws (the 2026-09-18 unstartable-opencode incident). See
// scripts/check-contract.sh section 8.

const WRITE_PATTERNS = ["write", "edit", "patch", "create", "apply"];
const BASH_PATTERNS = ["bash", "shell", "exec", "run", "terminal"];

export function isWriteTool(name: string): boolean {
  const n = name.toLowerCase();
  return WRITE_PATTERNS.some((p) => n.includes(p));
}

export function isBashTool(name: string): boolean {
  const n = name.toLowerCase();
  return BASH_PATTERNS.some((p) => n.includes(p));
}
