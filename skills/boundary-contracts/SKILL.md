---
name: boundary-contracts
description: "Derivation procedure for verifying a system as a graph of boundaries. Use when planning any feature or fix, reviewing a change, or diagnosing a defect that crossed a seam between two parts. Produces a checked-in boundary map, one executable contract per edge, gate placement, and an outside-in task order — so the checks are derived from the structure instead of invented per incident."
---

# Boundary Contracts

## The principle

Correctness lives on the edges. A codebase is a graph: nodes (modules, functions, components) and edges (the contracts between them). Every conventional quality gate — lint, type-check, line/branch/function coverage, mutation score, structural scan — measures a **node**. A seam defect is a property of an **edge**, so no nodal check can see it, and no amount of extra node tests reduces the recurrence.

The rule:

> Every edge in the dependency graph must be bound by one executable contract that exercises both real sides, enumerates that edge's whole surface, and fails when either side changes alone. A mock is permitted only on an edge that already has such a contract. An unbound edge is a defect in the test suite, not a risk in the code.

Four corollaries:

1. **A mock is an untested promise.** Every mocked collaborator encodes an assumption nobody verified. The contract test is the price of the mock.
2. **Absence needs enumeration, not sampling.** Example tests prove behaviour that exists; only a check over an enumerated surface can detect what is missing — a route, a field, a binding, a migration.
3. **A rule that cannot fail is a wish.** A check not yet seen failing for the reason it exists is not a control. Demonstrate the failure.
4. **Recurrence means the last fix was an instance fix.** When a class of defect repeats, change the derivation, not the instance.

## When to use

- Planning any feature or fix — before the first test is written
- Reviewing any change
- Diagnosing a defect that crossed a seam between two parts
- Auditing a project or a layer for verification gaps

## Step 1 — Derive the edge set

Walk the dependency graph by boundary kind. Do not invent checks; derive them from what this system actually spans.

| Edge kind | Typical two sides | The contract |
|---|---|---|
| UI ↔ state/hook | component ↔ hook/store | props, events, state the component may call or observe |
| state/hook ↔ client | hook ↔ repository/api client | method signatures, return shapes, error behaviour |
| client ↔ transport | api client ↔ HTTP/RPC/IPC/file | method + path + body + status + error shape |
| handler ↔ domain/repository | route/controller ↔ repository/service | calls and their inputs/outputs |
| repository ↔ storage | repository ↔ table/item/schema/index | written attributes, read defaults, key/index shape |
| config ↔ runtime | deployment config ↔ handler/env/bindings | routes, env vars, resource grants, permissions |
| writer ↔ reader | writer ↔ reader / legacy rows | field presence, optionality, defaults, versions |
| external ↔ adapter | third-party API/DB ↔ adapter | wire shape, error codes, retry semantics |

For each edge record: the two real sides, the contract surface, and the failure a one-sided change causes.

## Step 2 — Classify each edge

- **BOUND** — one executable test exercises both real sides, enumerates the surface, and has been seen failing on a one-sided change.
- **PARTIAL** — one side real, the other simulated for part of the surface.
- **SAMPLED** — behaviour is tested, but the surface is not enumerated (example tests only).
- **MOCKED** — each side is tested against a double; nothing spans the edge.
- **ABSENT** — neither side is tested.

Only BOUND satisfies the rule. PARTIAL, SAMPLED and MOCKED are debts with names.

## Step 3 — Write the contract

- Run the **real code on both sides**. Prefer in-process adapters (a fetcher backed by the real router, a repository backed by an in-memory store) over spinning up infrastructure.
- Drive the test from the **enumerated surface**: iterate every method, route, field and schema version. A hand-written example is a sample, not a contract.
- Assert the observable contract (status, shape, stored effect), not internals.
- Do not delete a failing contract test to make a change pass; fix the side that broke the contract.

## Step 4 — Put the contract in the gate, and prove it fails

- The default gate (pre-commit / CI) must run it. A check nobody runs is another green artefact.
- Demonstrate the failure: remove or change one side, confirm the contract goes red, restore. Record the demonstration.

## Step 5 — Order the work outside-in

1. **Outer loop:** write the failing contract test for the outermost edge the work crosses. For a user-visible change that is the transport/deploy edge, not the deepest function.
2. **Inner loop:** unit-TDD inward, one edge at a time, until the outer test passes.
3. Inner tests never substitute for the outer one.

This is double-loop TDD: the outer loop fixes *what* is correct (the seam); the inner loop fixes *how*.

## Step 6 — Check omission-prone surfaces explicitly

Where the likely defect is **absence** (routes, bindings, fields, migrations), the contract must enumerate the expected set and compare it. Sampling cannot find a missing member. Examples: every client call resolves to a handler route; every handler route is attached in the deployment config; every written field is readable by its reader.

## Step 7 — Record the map

Check the boundary map into the repository (architecture doc or its own file) and update it when an edge is added, removed or changes contract. The map is the input to review and to the definition of done.

## Definition of Done

- [ ] The change's touched edges are listed, and each is BOUND or has an owned, dated debt item.
- [ ] Each touched edge has one contract that spans both real sides and enumerates its surface.
- [ ] The contract runs in the default gate and has been seen failing on a one-sided change.
- [ ] The work ran outside-in: the boundary test predates the internals.
- [ ] The boundary map is updated.

## What does not count

- A client test with a mocked transport (SAMPLED at best).
- A handler test covering the routes that happen to exist (cannot see absence).
- Line/branch/function coverage, lint, type-check, mutation — all nodal.
- A prose rule with no failing mechanism.
- "It's covered" when the collaborator was mocked.

## Worked derivation: the missing-route class

Symptom: the client reports 404/500 for an operation whose unit tests are green.

1. Derive the edge `client repository ↔ HTTP route`.
2. Classify: client tests mock `fetch` (MOCKED); handler tests cover existing routes (SAMPLED). The edge is MOCKED, not BOUND.
3. Write the contract: instantiate each real client repository with a fetcher backed by the real router; call every method; assert the route resolves with the expected status. Enumerate every method from the repository surface — not one example.
4. Gate it; remove a route and confirm the contract reddens.
5. The check now fails on the next missing route before it ships.

## If the procedure required invention

If applying this skill to a system needed a check the taxonomy and steps do not derive, the skill is incomplete: extend the taxonomy or the step and record the case. The skill's output must be artefacts that fall out of the structure, not cleverness supplied in the moment.

## Relationship to other skills

- `design-by-contract` defines what a contract *is* (pre/postcondition, invariant, substitution).
- `testing-standards` defines test quality and the mock/conformance rules.
- `xp-craftsman` supplies the TDD loop; this skill fixes its *order* (outside-in).
- `code-review-and-quality` supplies the review axes; this skill adds the edge/relationship question they lack.
- `project-scaffold` owns the gate; this skill supplies which checks the gate must contain.
- `retrospective` records a lesson; this skill decides which *edge* was unbound and therefore which derivation step failed.
