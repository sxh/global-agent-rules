---
name: testing-standards
description: "Testing standards relocated from AGENTS.md — testability rules (DI, no framework I/O), functional-over-technical tests, wire-format literals, hermetic tests, resilient selectors, pagination testing, coverage strategy. Load when writing or changing tests."
---

# Testing Standards

Relocated from `AGENTS.md` (branch `refactor/agent-layers`, 2026-09-09). Load when
writing, changing, or debugging tests.

---

### Testability Rules

These rules ensure code is testable:
1. **Dependency Injection is mandatory** - Never use `new SomeClass()` inside constructors or business logic
   - Pass dependencies as constructor parameters or use factory functions
   - This enables swapping real implementations with test doubles
2. **No direct framework I/O in business logic** - Separate external concerns:
   - DOM manipulation, setInterval/setTimeout, window events, localStorage, fetch
   - Inject adapters/ports that can be mocked in tests
3. **Every dependency must be injectable** - All external services must be provided via:
   - Constructor injection with interfaces
   - Factory functions that return interfaces
4. **"If it's hard to test, the code is wrong"** - When tests are difficult, refactor the code first
   - Don't build test utilities to work around bad design
   - Fix the design to make testing easy
5. **Side effects must be controllable in tests** - Any I/O (network, storage, timers) must:
   - Be injectable/mockable
   - Have sensible defaults for production
   - Not execute on module import

### Functional Tests Over Technical Tests

**Write tests that describe user outcomes, not implementation details.** A test should verify what the user sees or experiences, not how the code achieves it internally.
**Bad (technical):** `expect_text_accepts_application_json_response_test` — tests that a library function handles a content-type header. This is testing the plumbing, not the product.
**Good (functional):** `training_data_from_file_appears_on_ui_test` — tests that content from a data file is rendered in the user interface. This is what the user cares about.
**Rules for writing tests:**
1. **Name tests after the user outcome** — `training_data_appears_on_verify_page_test`, not `parse_training_examples_returns_nonempty_list_test`
2. **Test the wire, not the wrapper** — If data crosses a system boundary (file → server → client → UI), test that the data arrives, not that each layer's helper function works in isolation
3. **Break end-to-end flows into testable segments** — A full E2E test like "file content appears on UI" can be split:
   - "Content from the file is sent by the server" — verify the endpoint returns the file data
   - "Content that is sent is rendered by the UI" — verify the view function renders the data correctly
   - Each segment tests a real contract, not a mock
4. **Use real data, not fabricated data** — Read from actual data files (`simplifile.read("data/training_constraints.json")`) rather than constructing minimal test fixtures that hide integration bugs
5. **A passing technical test does not mean the feature works** — If a user reports "no data on the page" and all tests pass, the tests are testing the wrong thing. Rewrite them.
6. **Verify the result of the loop, not the loop condition** — A pagination test must assert that N items reached the repository, not that `hasNextPage()` returned a boolean. A test that passes by checking implementation details will not catch regressions when those details change.
7. **Use mock HTTP responses for boundary-crossing tests** — Use `MockWebConnection` or equivalent to simulate HTTP responses for pagination, error handling, and multi-page flows. Do not construct domain objects directly and pass them to the method under test — this bypasses the parsing layer and hides integration bugs.
8. **Tests must be hermetic** — Each test must clean up its own side effects. Use `vi.restoreAllMocks()` in `afterEach`, not `vi.clearAllMocks()` in `beforeEach`. A spy on `window.confirm` or other globals that leaks across test boundaries causes spurious failures and erodes trust in the test suite.
9. **Use resilient selectors** — Target elements with `data-testid` attributes in tests. Never rely on CSS class names (especially CSS module hashes), DOM structure position, or text content that may change. If you need a CSS module class hash to locate an element, the test is too fragile to survive refactoring.

### State-Changing Actions Need Field-Level Assertions

When an action mutates a data structure, assert the specific field that changed — not merely that the action returned successfully. A test proving a delete removes from the intended collection (and not a sibling collection) is the difference between a guard and a formality.

### Full-Flow Integrity Tests

For any create/edit/save workflow, add a test that drives the complete cycle — submit, process, persist, navigate back — and asserts the payload is identical and in the same order. Step-local tests pass while the round-trip silently reorders or mutates data.

### Verify Algorithm Scenarios Before Implementing

Before implementing a sorting, ranking, or volume-sensitive algorithm, restate the expected output for realistic scenarios (small change, large jump, multiple moves) and confirm before coding. Otherwise the implementation encodes the wrong definition of the goal.

### Parsing User-Supplied Delimited Data

User-supplied CSV/TSV can contain free-text fields with embedded newlines; never split rows with a naive `split(text, "\n")` — use a state machine that tracks quote state and handles escaped quotes (`""`). Test with a literal multiline quoted field plus a following normal row to prove the row boundary resets.

### API Pagination

**Verify the actual pagination mechanism before implementing** — Check HTTP headers AND response body structure with a real request (curl). Do not assume Link headers exist solely because the API is from a known platform (Shopify, etc.). Test with a real endpoint.
**Prefer response body pagination detection** (product count, next-page token) over HTTP headers when the body is already parsed for data extraction. An extra network dependency on headers is fragile.
**Pagination tests must use mock HTTP responses** that simulate multiple pages (e.g., MockWebConnection) and verify all pages were processed, not just that `hasNextPage()` returned a boolean.

### Coverage Strategy

**Focus on line coverage only** — Branch, function, and statement coverage are secondary metrics. Line coverage is the primary measurable target.

**Multi-package average, not per-package minimum** — When a project has multiple packages, the 95% target applies to the **average line coverage across all packages**, not to each package individually. This allows strategic allocation of effort.

**Maximize easy wins first** — When improving coverage across multiple packages:
1. Get packages closest to 100% to 100% (smallest effort, highest return)
2. Then work on the next closest package
3. Leave the hardest package for last — the easy wins from other packages reduce how much the hardest package needs to improve

**Do not assume packages above the target are done** — A package at 98% may be easier to bring to 100% than a package at 85% is to bring to 90%. Always evaluate the effort required before deciding where to focus.

