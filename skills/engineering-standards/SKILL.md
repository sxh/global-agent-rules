---
name: engineering-standards
description: "Cross-project engineering standards relocated from AGENTS.md — architecture (hexagonal), naming, SOLID, CLI vs test-framework entry points, documentation, security, error handling, API design, cloud environments, accessibility, zero-tolerance for warnings. Load when writing or reviewing code."
---

# Engineering Standards

Relocated from `AGENTS.md` (branch `refactor/agent-layers`, 2026-09-09). Situational
standards — loaded when writing or reviewing code.

---

### Architecture

All applications must implement **Hexagonal Architecture** (Ports and Adapters):
- **Domain** - Core business logic (entities, value objects)
- **Ports** - Interfaces/traits defining how the domain interacts with the outside world
- **Adapters** - Implementations of ports (driving or driven)

**DSL host language prioritises authoring experience over output alignment** — When generated code is a compile artifact never hand-edited by humans, choose the DSL host language for authoring experience (type safety, IDE support, builder ergonomics), not for alignment with the output language. Alignment matters when humans edit both model and output; it's irrelevant when the output is invisible.

### Naming & Organization

**Names reveal intent** — Module/file names must clearly describe the domain concept they represent. A file named `opencode.gleam` is too vague; prefer names like `opencode_session.gleam`, `obsidian_vault.gleam`, `electron_preload.gleam`. If a name describes what the code *is* rather than what it *does*, it is wrong. Every developer should be able to guess the file's contents from its name alone.
**Small units, one responsibility** — Every module must have exactly one clear responsibility. If a module contains both URL construction and base64 encoding, it has at least two responsibilities. Split it. Aim for modules under 60 lines. No "utility" or "misc" or "helpers" modules — every file name must correspond to a real domain concept someone familiar with the project would recognize.
**Organize by domain, not by technical layer** — A file at `src/opencode/gateway.gleam` is better than `src/gateways/opencode.gleam`. Group code by what it is *about*, not by what category of code it is (e.g. "interfaces", "services", "utils"). Each distinct concept gets its own file or directory.
**Each endpoint gets its own function** — Do not reuse a shared "base URL" function across different endpoints. If `server_base_url_from_encoded` is used for both session creation and iframe viewing, the function conflates two different URL patterns. Every distinct URL that crosses the wire must be constructed by its own named function.
**Test names reveal the contract, not the function** — A test named `server_base_url_from_encoded_test` describes which function runs. A test named `session_create_url_includes_session_path_test` describes what business outcome is verified. If the name does not tell another developer what guarantee the test provides, rename it.

### Object-Oriented Design

All code must follow **SOLID** principles:
- **S**ingle Responsibility - Every module/class has one reason to change
- **O**pen/Closed - Open for extension, closed for modification
- **L**iskov Substitution - A subtype may weaken preconditions, strengthen
  postconditions, and must preserve invariants — never the reverse. The
  criterion, the language encoding ladder, and the conformance-suite mechanism
  are in the `design-by-contract` skill.
- **I**nterface Segregation - Specific interfaces over generic ones
- **D**ependency Inversion - Depend on abstractions, not concrete implementations

### Contracts & Invariants

Every type and port boundary carries a contract — a precondition (what the
caller owes), a postcondition (what the callee guarantees), and an invariant
(what holds across every operation). Encode them in the type where possible — a
smart constructor that makes an invalid value unrepresentable beats a runtime
check — then validate at the edge and rely on the invariant internally. The full
ladder, including the backend translations, is in the `design-by-contract` skill.

### Refactoring

**Field modification checklist** — When retiring a field from logic (Phase A) or removing it from the type (Phase B), work systematically: grep every reference in source and tests, categorize each (type, decoder, serializer, logic, display), update callers and tests, strip it from persisted data, then verify coverage. Removing from the type additionally means deleting the message/field, fixing every constructor call (the shared test helper first), removing view parameters and CSS, and grepping for dead imports. A missed site silently reintroduces the retired data.

**Prefer wrapping over changing a shared signature** — Before adding a parameter to a broadly-used function (layout, shared container), check whether wrapping its output achieves the goal. A signature change ripples through every call site and test; wrapping is local.

**Prefer in-memory computation over a round-trip** — When data needed for a computation is already in memory, compute from it instead of re-fetching. A local recomputation beats an HTTP round-trip.

### CLI Tools vs Test Frameworks

**CLI tools must not use test frameworks as entry points** — Test frameworks (eunit, gleeunit, etc.) suppress output on success and are designed for CI verification, not user-facing tools. When a tool needs to:
- Log progress or status
- Report results without crashing on failure
- Be observable during execution
It should be a standalone program with `main()` that uses `io.println` for output, not a test. Test frameworks are for verification; CLI tools are for user experience.

### Security

Security rules for all projects:
- **No secrets in code** - Never commit API keys, credentials, or secrets; use environment variables
- **Input validation** - Validate all inputs; never trust user input
- **Dependency scanning** - Check for vulnerabilities in dependencies (e.g., `npm audit`, `cargo audit`)
- **Secrets handling** - Use vault/secrets manager for production; environment variables for local dev

### Zero Tolerance for Errors and Warnings

Cosmetics matter. All executions and builds must be free of **both errors and warnings**. If developers come to expect errors and warnings they will start to ignore things that matter. The only solution is to maintain a clean environment:
- **Builds must be clean** - No warnings during compilation, bundling, or any build step
- **Tests must be clean** - No warnings in test output, no deprecated API usage
- **Linting must be clean** - No warnings from any linter or formatter
- **No noise** - Suppress or fix every warning; a single warning is a failure
- **Fix by refactoring, not suppressing** — When a linter or static analysis tool flags an issue, refactor the code to address the root cause. Adding `@Suppress` annotations bypasses the check without improving code quality. If a warning genuinely cannot be fixed (e.g., false positive from a tool limitation), document the reason explicitly rather than silently suppressing.

### Documentation

Documentation is generated as needed by the agent based on:
- Project structure and setup in `AGENTS.md`
- Architecture decisions in `docs/`
- API documentation for any exposed APIs

### Error Handling

- **Never ignore errors** - Every error must be handled or explicitly acknowledged
- **User-facing errors** - Display meaningful errors to users with details for debugging
- **Logging** - Log errors with sufficient context for debugging; logging is a feature, not default
- **No silent failures** - Never swallow errors without logging
- **Validate HTTP responses before parsing** - Never decode `.json()` or similar on a response without first checking the status code. A JSON parse error on an HTML body is a misleading symptom; check `response.ok` first and surface a meaningful error about what the server actually returned.
- **Include HTTP response body in error messages** — When an API returns a non-200 status, the response body often contains the actual error reason (rate limit, validation error, etc.). Always read the body and include it in the exception message, not just the status code and URL. The body is essential for debugging and is lost if only the status code is logged.

### API Design

For API projects:
- **REST** conventions for HTTP APIs
- **JSON** responses
- **Proper HTTP status codes**
- **Input/Output validation**

### Cloud Environments

- **Dev** - Local development
- **Production** - Cloud deployment gated by GitHub Actions
- **Simplicity first** - Use AWS if cloud is needed
- **Infrastructure as code** - Define infrastructure in code (Terraform, CDK)

### Accessibility

- **Check linting** - Include accessibility linting in code quality tools
- **WCAG compliance** - Follow WCAG guidelines for UI projects
- **Icon-only buttons** — Every `<button>` with only an icon (no visible text) MUST have both `title` and `aria-label`. The `aria-label` is the primary accessible name for screen readers; `title` provides a visible tooltip fallback.
- **Inputs need accessible names** — Every `<input>` and `<textarea>` MUST have an accessible name via `aria-label` or a `<label>` element. Do NOT rely solely on `placeholder` — it disappears on focus and is insufficient for accessibility.
- **CSS over inline styles** — Layout and typography properties (`flex`, `margin`, `padding`, `gap`, `width`, `height`, `fontSize`, `color`) MUST be defined in CSS, not as inline `style={{...}}` props. Inline styles are permitted only for truly dynamic values (e.g., color derived from data at runtime).
- **Explicit button types** — Every `<button>` MUST have an explicit `type` attribute (`type="button"` or `type="submit"`). Buttons without `type` default to `type="submit"`, causing unintended form submissions.

**Align workspace dependency version ranges with root** — When workspace packages pin exact dependency versions (e.g., `"vitest": "4.0.18"`) while root uses a careted range (`"^4.0.18"`), the lockfile creates nested copies that diverge on `npm ci`. CI exposes the mismatch; local `npm install` may mask it by hoisting. All workspace packages should use version ranges matching the root to prevent lockfile divergence.
**Expect masked CI failures from consecutive red builds** — When CI has been failing for multiple commits, fixing the first blocker often reveals the next one. Do not assume the build will turn green after one fix. Each fix may surface a previously masked issue.
