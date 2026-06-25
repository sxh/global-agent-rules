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

### Step 3: Triage and Filter Lessons
Before proposing additions to AGENTS.md, evaluate each lesson against these criteria:

| Keep if... | Discard if... |
|---|---|
| It caused a measurable defect or waste | It's a one-off observation unlikely to recur |
| It would prevent a future mistake | It's obvious/common knowledge |
| It's a tool/platform gotcha worth remembering | It's specific to a bug that was already fixed |
| It's a positive practice to reinforce | It duplicates an existing entry |
| It clarifies or corrects an existing entry | It's an opinion, not a verifiable fact |

When in doubt, lean toward discarding — AGENTS.md is a reference, not a journal.

**Note:** Lessons that fail the AGENTS.md triage (one-off, obvious, opinion) may still be valid backlog items if they describe a concrete, doable task. Move them to the backlog rather than discarding entirely.

### Step 4: Check for Duplicates and Stale Entries
- Read `~/.config/opencode/AGENTS.md` (global).
- Read `./AGENTS.md` in current project (local, if exists).
- For each lesson to be added:
  - Check if similar content already exists. If it does, note the overlap and decide whether to **update/replace** the existing entry instead of adding a new one.
  - If an existing entry is **contradicted** or **superseded** by the new lesson, mark the old one for deletion or amendment.
- Note any cross-project intersections.

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

### Step 7: Compact (as needed)
If the global AGENTS.md has grown past 600 lines, or if the retrospective produced more than 3 new entries, propose a compaction pass to the user:
- Archive removed or superseded entries to a dated section at the bottom.
- Merge adjacent entries on the same topic.
- Remove entries that are clearly obsolete (e.g., workarounds for fixed tooling bugs).

## Guidelines

### 5 Whys Analysis Template
For each defect found, trace through 5 levels:

1. **Immediate symptom** — What was the user-facing bug?
2. **Direct cause** — What code/behavior caused this?
3. **Design/process issue** — What naming, module, or architectural issue allowed this?
4. **Process gap** — What development step was skipped or inadequate?
5. **Guidance gap** — What principle or rule was missing from team understanding?

The goal is not a single "root cause fix" but a set of complementary investments at every layer of the chain.

### Positive Amplification Analysis (5 Wins)

For each positive outcome, trace through 5 levels to identify what enabled it and how to reproduce it:

1. **Positive outcome** — What specific result exceeded expectations? (e.g., "Found the root cause in 5 minutes instead of an hour")
2. **Direct enabler** — What specific action, tool, or piece of information directly produced this outcome? (e.g., "Querying the database directly confirmed zero null URLs")
3. **Practice/process enabler** — What habit, workflow step, or convention made that action natural to take? (e.g., "The investigation traces through all layers before reaching a conclusion")
4. **Preparation enabler** — What earlier investment made that practice possible? (e.g., "Direct psql access was set up and credentials documented")
5. **Mindset/principle enabler** — What underlying value or principle drove those investments? (e.g., "Empirical verification over assumption — trust data, not schema analysis alone")

The goal is not a single "root cause" but a chain of enablers at every layer that can be reinforced, documented, and repeated.

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

### Global Entry Format
Every entry must follow this exact structure:

```
- **[YYYY-MM-DD] [Category] Title** — Context. What to do instead / What to continue.
```

**Rules:**
- `[YYYY-MM-DD]` is the date of the retrospective, not the date the bug was introduced.
- `[Category]` is one of: `Gleam`, `Lustre`, `Electron`, `Testing`, `Coverage`, `Process`, `Tooling`, `Architecture`, `Security`, `Positive`, `Skill`.
- "Title" starts with a verb-like noun phrase: `Coverage Isolation`, `Precommit Hook Ordering`, `Snapshot State Coverage`.
- The body after `—` is exactly two sentences: one for context, one for action.
- Do not use emoji.
- Do not wrap in backticks — the entry is plain markdown list item.

**Example:**
```
- **[2026-05-28] [Gleam] Coverage Isolation** — c8 measures coverage on compiled JS, not original Gleam. Use `.c8rc.json` to exclude dependency output and enforce 95% on statements/lines/branches only.
```

### Local Entry Format
Same structure, but categories may be project-specific (e.g., `[Domain]`, `[Deployment]`). Keep the `[YYYY-MM-DD]` and two-sentence body rule.

### Positive Entry Prefix
Positive entries use the `[Positive]` category:

```
- **[2026-05-28] [Positive] Snapshot Testing Before Refactoring** — Writing a Birdie snapshot test before restructuring view logic caught a missing state transition. Always snapshot the full view before modifying render logic.
```
