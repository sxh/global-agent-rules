// Always-injected PCP trigger — see the PCP_CACHE_FIX note in pcp.ts.
//
// C4/B010: this is deliberately a short, constant trigger. The stable policy lives in
// skills/pcp-operations/SKILL.md so the injected system prompt stays small and byte-identical
// (a changing system array invalidates the prompt cache). pcp-rule.test.mjs guards both the
// trigger's shape and that the skill still carries the moved policy.

export const PCP_RULE = `[PCP] PCP-managed project. Before planning, executing, or committing, load the pcp-operations skill for the task rules (task granularity, completion review, capture/pivot triggers, done-before-commit). Non-negotiable: close each task with pcp_done before its commit and stage .opencode/pcp in that commit.`;
