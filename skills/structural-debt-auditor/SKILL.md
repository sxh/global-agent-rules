---
name: structural-debt-auditor
description: "Finds missing abstractions continuously and incrementally — the coverage-analog for structure. Use on a cadence (per sprint, per layer touched, per milestone) to surface duplication, over-abstraction, and wrong-level boundaries before they accumulate into review-after-review symptom fixing."
---

# Structural Debt Auditor

## What This Is

Code coverage measures "code executed" continuously and gates it. This skill measures **"structure unified"** the same way: a continuous, quantitative, gated signal (duplication ratio) plus an iterative, layer-scoped discovery pass. It exists because per-diff review **cannot** see missing abstractions — the `Fetcher` duplicated across three repositories, the error-handling contract repeated in 23 methods, the `notifyError` helper defined three times. Those are visible only when you scan the whole layer, and they only accumulate silently because structural typing blesses each duplicated shape as "valid."

The goal is not a one-off audit. It is a **repeatable mechanism** that makes the missing-abstraction discovery happen on a schedule, so you stop finding one small problem after another.

## When to Run

| Trigger | Command |
|---|---|
| **Cadence** (per sprint, per N commits) | Scan the whole repo |
| **Layer touched** (any change to repositories, hooks, components, API handlers) | Scan that layer |
| **Milestone / pre-release** | Scan whole repo with a hard threshold |
| **After any extraction/refactor** | Scan to verify ratio dropped, not rose |

## How It Works

### 1. The Continuous Signal (coverage-analog)

```
node ~/.config/opencode/skills/structural-debt-auditor/scripts/structural-debt-scan.mjs [dir] [--json] [--fail-on N]
```

- Scans for repeated **top-level named declarations** (same `type`/`interface`/`const`/`function`/`class`, same name, same body) across files — the primary, language-agnostic signal of a missing abstraction.
- Excludes `node_modules`, `dist`, `build`, `.git`, coverage, and test files by default.
- Reports a **duplication ratio** (duplicated declarations / total) and a per-candidate list with `pattern_signature`, files, and reason.
- `--fail-on N` exits 1 when ratio ≥ N — the gate.

**Ratchet rule (same as coverage):** once you set a threshold, never lower it. When the gate fails, investigate the rise and unify — do not relax the number. A rising ratio is the early warning that replaces "we keep finding one small problem."

### 2. The Discovery Pass (per-layer re-derivation)

For each layer the scan flags, ask the re-derivation question: **"If I wrote this layer fresh, what would the boundaries be?"** Do not ask "what's wrong with this change?" — that frame ratifies the existing baseline.

Workflow per candidate:

1. **Evidence gate:** is it truly the same shape in ≥2 files? (Same name, same body, same ownership/lifecycle?) — The scanner gives you the candidates; verify each at the source.
2. **Layer-2 check:** is the duplication *intentional*? Different security contexts, divergent evolution paths, or decoupling-by-design are legitimate — downgrade those.
3. **Decide the boundary:** unify (extract the shared module/type/helper/base class), or explicitly record why not.
4. **Encode it as a contract** once unified (see below), so the gate *refuses* the next copy instead of relying on review.

### 3. Encode the Abstraction as an Enforceable Contract

A unified abstraction that isn't enforced will re-diverged. After extracting, add a guard that makes the 2nd copy fail:

- A **contract test** asserting all implementations delegate to the shared helper (e.g., "all repositories route `response.ok` handling through the shared client").
- A **local lint rule** rejecting a second local definition of the extracted symbol.
- **Architecture validation** (dependency-cruiser, ArchUnit) forbidding the pattern elsewhere.

This is the same mechanism as the `no-n-plus-one-dynamo` local rule: a defect class that kept recurring is now *impossible to commit*. The gate is what ends the whack-a-mole; the scan is what tells you *when* to build the next gate.

## Severity Categorization

| Signal | Severity | Action |
|---|---|---|
| Same named type/const/function in ≥3 files | **High** | Extract shared abstraction this pass |
| Same named declaration in 2 files | **Medium** | Evaluate; extract if ownership matches |
| Single-implementation abstraction (interface/base with 1 impl) | **Medium (KISS)** | Consider inlining — unused extensibility is dead weight |
| Ratio rising across scans without a unifying commit | **High** | Stop and investigate the rise now |
| Ratio stable or falling | **Green** | No action |

## Findings Output

Each finding should be captured with:

```
pattern_signature: type_Fetcher          # stable key for cross-scan aggregation
kind:              duplicate-declaration
files:             [repo1.ts, repo2.ts, repo3.ts]
reason:            declared identically in 3 files — likely a missing shared abstraction
```

Record findings to the project backlog (PCP `pcp_capture`) so they are tracked, not lost to the session.

## Definition of Done

- [ ] Scan ran on the target scope (whole repo or layer)
- [ ] Ratio recorded (and compared to the previous scan's baseline)
- [ ] Every candidate verified at the source (evidence gate) — none reported from the scan alone
- [ ] Intentional duplication downgraded with a recorded reason
- [ ] Each unified abstraction encoded as a contract (test, lint rule, or architecture rule)
- [ ] Gate threshold maintained (never lowered)
- [ ] Findings captured to backlog

## Relationship to Other Skills

- **code-review-and-quality** — reviews *the diff*; this skill reviews *the structure between diffs*. Run this on cadence; run that on every change.
- **ln-623-duplication-overabstraction-auditor** — the deeper DRY/KISS/YAGNI evidence audit; use for Layer-2 verification of scanner candidates when the scanner lacks context.
- **retrospective** — when a defect recurs despite review, the missing abstraction is often the cause; run this skill before writing the retrospective entry.

## The Core Insight

Per-diff review validates new code **against** the existing baseline, so it ratifies the current abstraction level forever. This skill breaks that by measuring the baseline itself — continuously, like coverage — and forcing the re-derivation question on a schedule. The one change that kills the "one small problem after another" exhaustion is the enforcement contract: once an abstraction is a gate, it stops being something you rediscover review-after-review.
