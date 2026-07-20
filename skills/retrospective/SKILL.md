---
name: retrospective
description: Analyze the current session to identify lessons learned and update AGENTS.md files. Use when the user says "run retrospective", "reflect on session", "do a retrospective", or "let's do a retrospective".
---

# Retrospective Skill

## Purpose
Analyze the work done in the current conversation context to extract lessons learned — both positive and negative — and update AGENTS.md files (global and/or local) to prevent recurrence of defects, reinforce good practices, and continuously improve the development process.

### Session Definition
A "session" is the span of conversation since the last retrospective was run, or since the start of the current conversation if no retrospective has been run yet. If the context window has rotated and earlier turns are no longer accessible, limit analysis to what is available in the current context. Do not fabricate or assume details from lost context — note "insufficient context" if needed.

## Process

### Step 1: Analyze Current Context
- Review the messages available in the current conversation context window.
- Identify what was worked on, what bugs were found and fixed, what design decisions were made, and what process feedback was given.
- Explicitly look for **both** problems and successes — what went well is as important as what went wrong.
- Look for explicit mentions of "the problem was...", "I found the issue...", "the bug was...", "I learned...", "we learned...", and any user feedback about the process itself.

### Step 2: Identify Defect Pattern and Positives
- **If a defect/bug was found and fixed in this session:**
  - Run the full 5-tier **Five Whys** analysis.
  - Document: root cause, the missing/insufficient test, the process gap, the guidance gap.
- **If no defect was found** (just feature work, refactoring, or discussions):
  - Skip Five Whys.
  - Extract lessons learned from the conversation.
- **Always also analyze positives** — for each significant positive outcome:
  - Run the full 5-tier **Positive Amplification Analysis**.
  - Document: the enablers at each layer (direct, practice, preparation, mindset).
  - The goal is to identify what to *repeat and reinforce*, not just what to fix.
- **If both a defect and a positive outcome occurred** (common): run both analyses independently.
- **At the end of analysis** — for every significant finding (defect root cause, positive enabler, lesson learned):
  - Formulate actionable backlog items: concrete tasks that can be executed in a future sprint.
  - See "Backlog Generation" guidelines below.

### Step 3: Generalize Findings to Principles

Before filtering or writing entries, generalize each finding:

**For each finding from Step 2, state the underlying principle** that produced it. A principle is a stable rule that, if followed or violated, explains the finding. The same principle should apply to a different scenario with different tooling.

Examples of principles vs findings:

| Finding (narrow) | Principle (general) |
|---|---|
| "Forgot `--mode=mono` on SST dev" | "Infrastructure config requires tool-specific syntax, not general reasoning" |
| "Shell quoting bugs in start.sh" | "Infrastructure config requires tool-specific syntax, not general reasoning" |
| "Wrong `$interpolate` syntax in SST config" | "Infrastructure config requires tool-specific syntax, not general reasoning" |
| "API test used wrong field name" | "Test assertions must reference the actual data, not assumptions about it" |
| "Validation didn't catch null URL" | "Every required field needs both a set and an unset test" |

If two or more different findings from this session (or from recent retrospectives) map to the same principle, propose **one entry for the principle**, not one per finding.

If a finding does not generalize to a principle that would prevent a different class of defect, it is likely a one-off — discard or move to backlog.

### Step 4: Check Principle Coverage, Not Entry Duplication

- Read `~/.config/opencode/AGENTS.md` (global) and `./AGENTS.md` (local).
- For each **principle** identified in Step 3:
  - Search existing entries for the same **principle**, not the same wording. Two entries may have different titles but the same governing idea.
  - If the principle is already covered by an existing entry: **do not add a new entry.** Instead, propose a refinement to the existing entry that clarifies its scope (e.g., add a sentence or an example from this session).
  - If the principle is **not** covered by any existing entry: propose a new entry.
  - If the principle is **contradicted** by an existing entry: mark the old one for removal or amendment.
- **Compression scan:** If 3+ existing entries from different sessions express the same principle, propose merging them into one entry and archiving the surplus.

### Step 5: Present Summary
Show the user a summary BEFORE confirming. The summary must include:

```
## Retrospective Summary

### Session Overview
[Brief description of what was worked on, with time boundary noted]

### What Went Well
1. [Positive practice or good outcome]
2. ...

### Defect Analysis (if applicable)
[5 Whys analysis or note that no defect was found]

### Positive Analysis (if applicable)
[Positive Amplification Analysis or note that no notable positive was identified]

### Lessons Learned
1. [Lesson 1 and where it should go: global/local]
2. ...

### Backlog Items
1. [Actionable task 1 — e.g., "Add NOT NULL constraint to products.url"]
2. [Actionable task 2 — e.g., "Set up automated schema validation in precommit hook"]
...

### Duplicate / Stale Entry Check
[Notes on existing similar content, entries to update or remove]

### Cross-Skill Impact
[Note if any other skill files (XP Craftsman, etc.) need updating]

### Proposed Changes
- Global AGENTS.md: [what to add, update, or remove, with exact section]
- Local AGENTS.md: [what to add, update, or remove, if applicable]
```

Wait for user confirmation before proceeding.

### Step 6: Apply Changes (after confirmation)
If user confirms:
- **Add, update, or remove** entries in global AGENTS.md (`~/.config/opencode/AGENTS.md`) as proposed. When updating, replace the existing entry with the corrected version. When removing, delete the line(s).
- **Add, update, or remove** entries in local AGENTS.md (`./AGENTS.md`) if in a project with a local AGENTS.md.
- **Update skill files** if the lesson reveals a gap in a skill (XP Craftsman, RPG Master, etc.). Propose the specific edits to the user.
- **Capture backlog items into PCP** — for each proposed backlog item, call `pcp_capture` with a clear title and optional context. The item is now tracked in the PCP backlog for future sprint planning.
- Show confirmation that all updates were made.

### Step 7: Compact (every session)
Every retrospective must propose a compaction pass, even if no new entries are added:
- Scan the last 20 entries in AGENTS.md (or all entries since the last compaction).
- Identify any 2+ entries that express the same principle (different titles, same idea) and propose merging them.
- If merging, keep the principle and update the date of the surviving entry to the current date. Archive the surplus entries.
- Also apply the principle-coverage check from Step 4: if a new principle subsumes older entries, those older entries should be archived.
- Propose the specific merges and archive actions in the summary for user confirmation.

## Guidelines

### 5 Whys Analysis Template
For each defect found, trace through 5 levels:

1. **Immediate symptom** — What was the user-facing bug?
2. **Direct cause** — What code/behavior caused this?
3. **Design/process issue** — What naming, module, or architectural issue allowed this?
4. **Process gap** — What development step was skipped or inadequate?
5. **Guidance gap** — What principle or rule was missing from team understanding?

The goal is not a single "root cause fix" but a set of complementary investments at every layer of the chain.

**After the 5 Whys, extract the underlying principle** — what rule, if followed, would prevent this class of defect regardless of the specific tool or scenario? The principle is the Level 5 answer stated as a positive action ("Verify generated output by running it") rather than a negative observation ("The generated start.sh had escaping bugs").

### Positive Amplification Analysis (5 Wins)

For each positive outcome, trace through 5 levels to identify what enabled it and how to reproduce it:

1. **Positive outcome** — What specific result exceeded expectations? (e.g., "Found the root cause in 5 minutes instead of an hour")
2. **Direct enabler** — What specific action, tool, or piece of information directly produced this outcome? (e.g., "Querying the database directly confirmed zero null URLs")
3. **Practice/process enabler** — What habit, workflow step, or convention made that action natural to take? (e.g., "The investigation traces through all layers before reaching a conclusion")
4. **Preparation enabler** — What earlier investment made that practice possible? (e.g., "Direct psql access was set up and credentials documented")
5. **Mindset/principle enabler** — What underlying value or principle drove those investments? (e.g., "Empirical verification over assumption — trust data, not schema analysis alone")

The goal is not a single "root cause" but a chain of enablers at every layer that can be reinforced, documented, and repeated.

**After the 5 Wins, extract the underlying principle** — what practice or mindset, if maintained, would continue producing this kind of positive outcome regardless of the specific tool or scenario? State it as a positive rule to reinforce.

### What Went Well
Capture specific, concrete examples of successes identified through the Positive Amplification Analysis (or from direct observation):
- **Practices** that saved time or prevented errors (e.g., "Writing snapshot test before refactoring caught a margin bug")
- **Tooling** that worked effectively (e.g., "Birdie diff revealed the missing state transition")
- **Process** that flowed well (e.g., "User caught the scope creep before I implemented it")
- **Decisions** that proved correct (e.g., "Injecting the HTTP client made the pagination test trivial")

These entries go into AGENTS.md with a `[Positive]` prefix to distinguish them from defect-driven entries.

### Backlog Generation

For each finding from the Five Whys or Positive Amplification Analysis, decide whether it should become a backlog item:

**Good backlog items are:**
- **Concrete** — "Add NOT NULL constraint to products.url migration", not "Improve data quality"
- **Executable in one sprint** — small enough to complete, large enough to matter
- **Actionable by an agent or developer** — clear what needs to be done and how to verify it's done
- **Linked to the finding** — include the context so future work understands why it matters

**Sources of backlog items:**
- **Level 2 (Direct cause)** from Five Whys — fix the symptom (e.g., "Add NOT NULL to url column")
- **Level 4 (Process gap)** from Five Whys — fix the process (e.g., "Add schema review to precommit hooks")
- **Level 3 (Practice/process enabler)** from 5 Wins — reinforce the practice (e.g., "Document multi-layer investigation pattern")
- **Any lesson that failed AGENTS.md triage** but is still a concrete, doable task

**Use `pcp_capture`** to add each item with a descriptive title. For example:
> `pcp_capture("Add NOT NULL constraint to products.url column")`
> `pcp_capture("Document multi-layer investigation pattern in AGENTS.md")`

### Global vs Local Decision
- **Global** — Framework-specific lessons, general development principles, tool gotchas, OpenCode platform knowledge. Everything should default to global unless there's a strong reason not to.
- **Local** — Project-specific conventions, domain terms, project-specific infrastructure, repository layout knowledge.
- **Edge cases:**
  - *Cross-project but not universal:* Prefer global with a qualifying phrase like "In Gleam projects using Lustre..." rather than duplicating across local files.
  - *Meta-lessons about the retrospective skill itself:* Add to global AGENTS.md under a `## Skills Maintenance` section.
  - *No local AGENTS.md exists:* If the lesson applies locally but no file exists, mention it in the summary and ask the user if they want one created.
  - *Lesson applies to both:* Write once to global and reference it from local (do not duplicate content).

### Lesson Significance Triage
Not every observation belongs in AGENTS.md. Apply these filters:
1. **Would this prevent a future defect?** If yes, keep.
2. **Is this a repeatable pattern or a one-off?** Only keep repeatable ones.
3. **Does this correct or clarify an existing entry?** If yes, update the existing entry rather than adding.
4. **Is this a positive practice worth institutionalising?** If yes, keep with `[Positive]` prefix.
5. **Would a new developer benefit from reading this?** If no, discard.

### Revision and Compaction
- **Updating:** When a lesson supersedes an existing entry, replace the old text in-place rather than appending. This keeps AGENTS.md accurate rather than accumulating corrections.
- **Removing:** When an entry is no longer relevant (fixed tool bug, outdated practice), delete it. Mention the removal in the retrospective summary.
- **Archiving:** Moved entries are placed under a `## Archived Entries (YYYY-MM-DD)` heading at the bottom of AGENTS.md so the history is preserved without cluttering active guidance.
- **Threshold:** Propose compaction whenever AGENTS.md exceeds 600 lines or 5 retrospectives have run since the last compaction.

### Cross-Skill Feedback
If a lesson reveals a gap or improvement opportunity in another skill file:
- The retrospective summary must include a `Cross-Skill Impact` section identifying which skills need updates.
- Apply the same Red-Green-Refactor protocol to skill file edits: propose the change, wait for confirmation, then write.
- Do not edit skill files silently — the user must approve changes to their tooling configuration.

## Format for AGENTS.md Entries

### Principle-First Structure
Every entry must express a general principle, not a specific observation. The title should state the principle itself, not which tool or scenario triggered it.

```
- **[YYYY-MM-DD] [Category] Principle Title** — Principle statement (one sentence). Example of the principle in action (one sentence).
```

**Rules:**
- `[YYYY-MM-DD]` is the date of the retrospective, not the date the bug was introduced.
- `[Category]` is one of: `Gleam`, `Lustre`, `Electron`, `Testing`, `Coverage`, `Process`, `Tooling`, `Architecture`, `Security`, `Positive`, `Skill`.
- "Title" states the principle (e.g., `Generated Output Must Be Run`, `Infrastructure Config Is Discovery`), not the specific tool or scenario (not `SST StaticSite Setup`, `Start.sh Escaping`).
- The body is exactly two sentences: one stating the principle, one giving an illustrative example.
- If multiple findings from different sessions map to the same principle, write one entry covering them all.
- Do not use emoji.
- Do not wrap in backticks — the entry is plain markdown list item.

**Before (narrow, tool-specific):**
```
- **[2026-05-28] [Gleam] Coverage Isolation** — c8 measures coverage on compiled JS, not original Gleam. Use `.c8rc.json` to exclude dependency output and enforce 95% on statements/lines/branches only.
```

**After (principle, generalisable):**
*(In practice the "Before" would be refined to this rather than archived — the principle was correct, the title was too narrow.)*
```
- **[2026-05-28] [Coverage] Target Language Coverage Measurement** — Coverage tools measure the compiled output, not the source language. Configure the coverage tool (c8, kover, etc.) to exclude dependency output and enforce thresholds on the compiled artifact, not the original source.
```

### Local Entry Format
Same structure, but categories may be project-specific (e.g., `[Domain]`, `[Deployment]`). Keep the `[YYYY-MM-DD]` and two-sentence body rule.

### Positive Entry Prefix
Positive entries use the `[Positive]` category and follow the same principle-first format:

```
- **[2026-05-28] [Positive] Snapshot Before Structural Change** — Render the full output of a function before modifying its internal structure. A snapshot test caught a missing state transition that unit tests missed, because it tested the entire output surface rather than isolated conditions.
```
