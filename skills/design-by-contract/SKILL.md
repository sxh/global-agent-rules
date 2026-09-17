---
name: design-by-contract
description: "Language-agnostic Design by Contract — preconditions, postconditions, invariants, and the Liskov substitution criterion, with an encoding ladder per language family (pure-static, static-OO, dynamic, untyped-BEAM) and edge-validation discipline. Load when introducing or changing a type, a port, an API boundary, or any invariant-bearing data."
---

# Design by Contract

Contracts are design *thinking*, not Eiffel syntax. A contract is the obligation a
caller owes and the guarantee a callee returns; an invariant is what stays true
across every operation. Each language is only a different-strength encoder for
these ideas — some make a bad state impossible, others merely detect it at
runtime. This skill is the language-agnostic core plus the translation ladder;
`stack-playbooks` holds per-stack idioms.

## When to Use

- Introducing or changing a type, value object, or smart constructor
- Introducing a port, adapter, or any boundary crossing
- Changing an API request or response shape
- Any data carrying an invariant (ranks, IDs, money, dates, counts)
- Overriding a method or substituting an implementation
- Reviewing any of the above

## The Three Contracts

- **Precondition** — what the caller must guarantee before the call. If it does
  not hold, the callee's behaviour is undefined; a well-defended callee rejects
  rather than guesses.
- **Postcondition** — what the callee guarantees on return, *assuming the
  precondition held*.
- **Invariant** — what is true at every observable moment, before and after every
  operation — not only on return.

### A test is not a contract

A test is *existential*: it demonstrates an outcome for the inputs chosen. A
contract is *universal* with an admission condition. TDD gives you
postconditions for examples; it does not state the precondition, and it cannot
show an invariant holds for inputs nobody wrote down. Property-based tests over
generated inputs are what close that gap.

## The Encoding Ladder

For every contract, ask how far it can be pushed toward *unrepresentable*
(strongest) versus merely *checked* (weakest).

| Concept | Pure + static (Gleam, Rust, Haskell) | Static OO (Java, Kotlin, Scala, C#) | Dynamic (Python, Ruby, JS) | Untyped BEAM (Elixir) |
|---|---|---|---|---|
| Invariant | Smart constructor → invalid value unrepresentable | Constructor + private fields + immutability; `init {}`, records, `Objects.requireNonNull` | Factory/validator + tests; **DB constraints** | Pattern-match on construction; opaque module |
| Precondition | The signature itself (`Result`, non-empty type) | Guard clause + parameter validation + annotations (`@NonNull`, JSR-380) | Guard / `raise` at the function head; **validate at the edge** | Function-head pattern match + guards |
| Postcondition | Return type + purity | Return-type invariants + property tests | Property tests (Hypothesis, fast-check) | `@spec` / Dialyzer + property tests (StreamData) |
| Substitution | — type system fixes shape, not behaviour — | **Conformance suite** | **Conformance suite** | **Conformance suite** |

**Push every contract as far left as the language allows.** Prefer a
representation where the invalid value cannot be constructed over a runtime
check that catches it; prefer a construction-time check over an assertion deep in
a call graph.

## Two Cross-Cutting Rules

### Liskov substitution: the variance criterion

A subtype may **weaken preconditions**, **strengthen postconditions**, and must
**preserve invariants** — never the reverse. This is the concrete, testable
reading of "substitutable", and it is the review question for every override and
every adapter implementing a port:

- Does the override demand *more* of callers than the base? Violation.
- Does it promise *less* on return? Violation.
- Can it leave the object in a state the base's invariant forbids? Violation.

### Validate at the edge, rely inside

Channel checking to the boundary — parsing, construction, the entry point — and
then trust the invariant internally. Re-checking defensively at every layer is
the anti-pattern this discipline exists to remove: it is slow, it obscures where
the truth was established, and it lets an invalid value travel inward before
being caught. Establish the contract once; rely on it thereafter.

## Backend Translation

The payoff is largest on the backend, where untrusted input and remote failure
live.

- **Ports.** Every port is a contract boundary. Document its precondition,
  postcondition, and invariant; every implementation (prod adapter and test
  double) must satisfy them via a shared **conformance suite**.
- **API boundaries.** The request is the precondition (reject at the edge;
  fail fast, do not propagate bad input inward); the response schema is the
  postcondition. See the API Design section of `engineering-standards`.
- **Persistence.** Invariants that must survive process death, restarts, and
  concurrent writers — `NOT NULL`, `UNIQUE`, `CHECK`, foreign keys, transactions
  — belong in the data layer. A language-level assert reaches neither across
  processes nor across concurrent transactions.
- **Distributed postconditions.** Idempotency, at-least-once delivery, and
  eventual consistency are observable contracts; check them with state-machine
  or property tests, not example tests.

## Enforcement

Contract *quality* cannot be linted; review is the gate. What can be mechanised:

1. **Port conformance suites** — required for any port with more than one
   implementation (prod adapter vs test double). This is the coverage-analog for
   contracts.
2. **Edge validation** — one validation point at each external boundary,
   discharging the precondition before trusting the value.
3. **Data-layer constraints** — invariants the language cannot carry.
4. **Review questions** — the variance criterion and the validate-at-the-edge
   rule (above), applied in `code-review-and-quality`.

## Anti-Patterns / Red Flags

- Assertions scattered everywhere instead of validation once at the boundary
- Contracts stated only in prose and never embodied in a type or constructor
- An invariant written in a comment but violable by a public constructor
- An override that strengthens a precondition or weakens a postcondition
- The same edge validation duplicated deep inside the call graph
- "Business rules" living only in tests, with no type or constraint behind them

## See Also

- **engineering-standards** — architecture, SOLID, API design; the design-time home
- **testing-standards** — property-based testing and port conformance suites
- **code-review-and-quality** — the Architecture and Test Quality axes apply these checks
- **stack-playbooks** — per-stack idioms for the translation ladder
