# Global Development Rules

## Technology Choices

These rules apply to **every** OpenCode session across **all** projects.

### Priority Order

1. **Testability is the first priority** - Every line of code written for the application should be testable.
   - If it is configuration code, the outcome of the configuration code should be testable.
   - This includes user interface code.
   - **Test coverage measurement is mandatory** - Every project must be able to run coverage reports.
2. **Simplicity** - Next priority is simplicity.
3. **Consistency** - Consistency across the entire stack.

### Process Rules

**NEVER make a commit without explicit instruction from the user** — Wait for the user to explicitly ask for a commit before creating one.
**Git commits are for WORKING code** — Commits should never be made during investigations or while experimenting. Only commit when code is verified working and tests pass. This is a prime directive.
**NEVER adopt a "move fast and fix" approach** — Always stick with the process. Don't skip steps because something "seems simple" or you're "pretty sure it will work". Follow the process even when it's slower - that's how we avoid mistakes.
**Verify backlog items before starting** — Before starting a task from the backlog or queue, check `git log --oneline -20` for recent related work. A prior commit may have already completed the task; stale backlog items waste effort.
**SpotBugs Heap for Large Projects** — The SpotBugs Maven plugin may run out of memory on projects with 400+ classes and many dependencies. Configure `<maxHeap>4096</maxHeap>` or higher in the plugin configuration to prevent OOM during analysis.
**PCP state files are part of the project** — `.opencode/pcp/` files track task state across sessions and omitting them breaks continuity. Default to committing them alongside code changes, but batch into the final commit at session end if the user prefers that cadence. Do not leave them unstaged at session end.
**Answer questions: state-then-stop before acting** — When the user asks a question about your code or a decision you made, your first response must be to restate the question in your own words, answer it concisely, then stop. No file edits, no code changes, no proposing a fix — just the answer. An explicit "yes", "proceed", or "implement it" from the user is required before any action.

**This is a positive script, not a prohibition.** The reason it exists is that the passive prohibition "don't take action" alone was insufficient — it failed repeatedly because the agent's instinct to "fix the problem" fired before the guard could stop it. The positive script replaces that instinct with a concrete action (state → answer → stop) that leaves no room for interpretation.

**When the prohibition fails, the positive script catches it.** The two rules together ensure that even if one is missed, the other intercepts the pattern. Neither should be removed without evidence that the agent can reliably distinguish questions from assignments for three consecutive sessions.

**`.git/` is radioactive and not versioned** — The `.git/` directory is repo metadata, never tracked content. Mutating it (e.g., via `npx husky` or `git config`) can break git operations without warning. Treat it as immutable during investigations. Never run binaries with lifecycle side effects (`husky`, `npm prepare`, etc.) when the intent is read-only.
**Investigation commands must be read-only** — Before running a command during investigation, verify it produces no side effects. Prefer reading source code or `package.json` to determine a tool's version instead of executing it. If a binary must be run, isolate it (docker, temp directory, `--dry-run` flag) to prevent state mutation.
**Align workspace dependency version ranges with root** — When workspace packages pin exact dependency versions (e.g., `"vitest": "4.0.18"`) while root uses a careted range (`"^4.0.18"`), the lockfile creates nested copies that diverge on `npm ci`. CI exposes the mismatch; local `npm install` may mask it by hoisting. All workspace packages should use version ranges matching the root to prevent lockfile divergence.
**Expect masked CI failures from consecutive red builds** — When CI has been failing for multiple commits, fixing the first blocker often reveals the next one. Do not assume the build will turn green after one fix. Each fix may surface a previously masked issue.

### Browser Security & Proven Limitations

**Accept proven limitations** — When browser security or platform restrictions are proven (not assumed), accept the limitation and design around it. Don't spend hours trying to bypass security that cannot be bypassed. If something is impossible, document why and move on.
**Cross-Origin Iframe Rule** — Content in cross-origin iframes cannot be accessed via JavaScript, regardless of cookies or session state. This is a browser security fundamental with no workaround. If the target content is in a cross-origin iframe, either use a visible window (not hidden) or find an alternative (API, proxy, etc.).
**Verify with real data before implementing** — Before writing extraction logic, get the actual page content and inspect it. Don't guess at selectors or HTML structure.
**Verify proxy behavior with curl before modifying scraper code** — When debugging proxy-related scraper failures, test the proxy connection directly with `curl -x "http://user:pass@host:port" -k -s -o /dev/null -w "HTTP %{http_code}" "https://target.url"` before writing code changes. A two-second curl test can disprove an hour-long hypothesis.
**Serial guessing is not a process** — Making changes until something works is not engineering. Each attempt should be hypothesis-driven with verification. If an approach fails, analyze why before trying the next variation. **When a configuration parameter does not respond to its documented override mechanism, stop and research the actual implementation (e.g., check plugin source, Mojo `@Parameter` annotations, effective-POM output, or API documentation) before attempting another variation.**

### Confirm Problem Understanding Before Coding

**Define the role of any referenced codebase explicitly** — When describing a toolchain that involves an existing project, state its relationship upfront: "test fixture", "source of truth", "example", or "target for migration". Do not conflate "used for validation" with "is the input format" — they lead to fundamentally different architectures.

**Re-examine the full frame when a core assumption is contradicted** — When the user says "that's not how it works" about a fundamental design premise, do not patch the specific assumption. Re-run the full analysis from the corrected premise. A changed frame changes every conclusion below it.

**State your understanding of the problem in one sentence before making any code change.** Ask the user "Is this correct?" if uncertain.
**Read runtime output (logs, errors) carefully before proposing fixes.** The answer is often visible in the output — don't guess at what the data looks like when the user has already shown it.
**Do not change scope** — if the user asks about coverage analysis, do not also refactor loaders. Stick to the asked question. Unnecessary scope changes waste time and introduce risk.
**Incomplete-source spatial work** — When generating maps, diagrams, or other spatial output from incomplete or ambiguous source material, first articulate the inferred layout in text and have the user confirm it before producing the final artifact. Treat each correction as a potential full mental-model rebuild, not an isolated patch. A wrong assumption corrected still leaves other assumptions unchecked.

### Language Preferences

**Strongly typed languages are preferred** over dynamic languages.
**Preferred platforms** (in order):
1. **BEAM** - Gleam, Lustre
2. **JVM** - Java, Kotlin, Scala
**Gleam over JS on BEAM** — When targeting BEAM, all logic must be implemented in Gleam. Using JavaScript is a last resort, permitted only when we have *proved* that the task cannot be done in Gleam (e.g., browser-only APIs, Electron IPC that require native Node.js modules). "It feels simpler to write this in JS" is not a valid reason — that is how JS becomes a dumping ground. Every FFI function must be justified by a comment explaining why Gleam cannot do it.
**Always use native Gleam idioms, especially for JSON parsing** — Do NOT write manual string manipulation to parse JSON. Use `gleam/json` with proper decoder types:
- Import `gleam/json` and define decoder functions with `json.decode`
- Never use `string.split`, `string.slice`, or recursive string parsing to extract JSON values
- Manual JSON parsing is a code smell indicating you're not using idiomatic Gleam
**FFI requires proof, not assumption** — Before adding FFI, always verify the functionality isn't already in stdlib. Many "impossible" tasks have pure alternatives:
- **Check gleam/uri first** — For URL encoding, `uri.percent_encode()` does what `encodeURIComponent()` does in JS
- **Declarative over imperative** — Lustre handles DOM declaratively. If you're reaching for `document.createElement()`, stop. Compute the value in Gleam, render it in the view.
- **"Can't do X" vs "doesn't expose X"** — Gleam compiles TO JS, so it CAN do anything JS can. The question is whether the stdlib exposes it.
- **Data: URIs replace file downloads** — For client-side downloads, encode with `uri.percent_encode()` and render as `data:` URI in href. No Blob, no createObjectURL, no click handler needed.
**Gleam Tech Stack** — We use Gleam for its strong static typing and functional programming model. Gleam brings:
- **Type safety** — Compile-time guarantees catch entire classes of bugs
- **Erlang VM (BEAM)** — Battle-tested runtime for concurrent, fault-tolerant applications
- **JavaScript target** — Same language runs in browser, server, or desktop via Electron
**Finding Gleam packages and extensions:**
- **Hex.pm** — Primary package registry: https://hex.pm/packages
- **gleam_stdlib** — Standard library (always available): https://hex.pm/packages/gleam_stdlib
- **Official Lustre packages** — `lustre`, `lustre/element`, `lustre/attribute`, `lustre/event`
- **gleam_js** packages — For JS interop when needed: https://hex.pm/packages?q=gleam_js
- **Community packages** — Search Hex for `gleam-*` or browse by category
- **Check first** — Many tasks are solved by gleam_stdlib or gleam_js; don't assume you need a third-party package

### Development Methodology

All development work must follow **Extreme Programming (XP)** principles, specifically **Test Driven Development (TDD)**:
- **Test first** - Write the test that verifies the outcome before writing the code
- **Red-Green-Refactor**:
  1. **Red**: Write a failing test that describes the desired outcome
  2. **Green**: Write minimal code to pass the test
  3. **Refactor**: Clean up code while keeping tests green
- **Tests verify outcomes** - Focus on showing that the code produces correct results
- **All code must be test-driven** - No code written without a failing test first. We write a test for the functionality we need, then implement code to make the test pass. We do not write code and then add tests afterward. Every line of code exists because we wrote it to make a test pass — not because a human wrote it and an automated test happens to cover it.
- **Test the wire format, not just the helper** - Every distinct URL, request body, or serialized payload that crosses a system boundary must have its own test containing the **literal expected string**. Testing a shared URL-building helper in isolation and assuming all derived URLs are correct is a tautology, not a verification. For example, `server_base_url_from_encoded_test` tests a function; `session_create_url_includes_session_path_test` tests a contract.
- **Profile before optimizing** - When targeting performance, measure first to identify the actual bottleneck. No optimization code should be written before the bottleneck is confirmed by empirical data (profiler, timing instrumentation, or benchmark). An optimization that doesn't change the measured bottleneck is waste.
- **Reference, don't reimplement** - When introducing new logic that parallels an existing abstraction (e.g., word boundaries, regex compilation), verify the behavior matches by reading the actual implementation first. An incorrect assumption about how existing code works will produce incorrect new code.

## Skills

The `skill` tool only works with pre-registered skills from the system prompt. For custom skills at user-specified paths, use this workaround: when the trigger phrase is detected, read the current contents of the skill file and follow its instructions for that session. This ensures the latest version is always used.

**Natural language skill resolution** — Do not require the user to remember exact skill names or trigger phrases. When the user asks to run an audit, review, or analysis task in natural language, scan `~/.agents/skills/` for installed skills, read their SKILL.md descriptions, and match the best one to the user's request automatically. The burden of mapping intent to skill is on the agent, not the human.

### XP Craftsman Skill (Always Active)

The user always wants XP. Load the XP Craftsman skill from `/Users/steve.hayes/.config/opencode/skills/xp-craftsman/SKILL.md` at the start of every session — it is the default mode for any task involving software implementation, code generation, infrastructure configuration, testing, or refactoring. Follow its instructions unless explicitly overridden by the user for a specific deviation.

Do not wait for a trigger phrase. This applies to all development work, including code generators, DSL builders, pipelines, scripts, and configuration-as-code. If the task involves writing output that will be executed, deployed, or compiled, the XP protocol is active.

### RPG Master Skill

When the user says "run rpg", "campaign", "NPC", "dungeon", or "quest", read the latest version of the RPG Master skill from `/Users/steve.hayes/.gemini/skills/rpg-master/SKILL.md` and follow its instructions for that session.

### Retrospective Skill

When the user says "run retrospective" or "reflect on session" or "do a retrospective" or "let's do a retrospective", read the latest version of the Retrospective skill from `/Users/steve.hayes/.config/opencode/skills/retrospective/SKILL.md` and follow its instructions for that session.

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
- **L**iskov Substitution - Objects can be replaced with subtypes without breaking
- **I**nterface Segregation - Specific interfaces over generic ones
- **D**ependency Inversion - Depend on abstractions, not concrete implementations

### CLI Tools vs Test Frameworks

**CLI tools must not use test frameworks as entry points** — Test frameworks (eunit, gleeunit, etc.) suppress output on success and are designed for CI verification, not user-facing tools. When a tool needs to:
- Log progress or status
- Report results without crashing on failure
- Be observable during execution
It should be a standalone program with `main()` that uses `io.println` for output, not a test. Test frameworks are for verification; CLI tools are for user experience.

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

### API Pagination

**Verify the actual pagination mechanism before implementing** — Check HTTP headers AND response body structure with a real request (curl). Do not assume Link headers exist solely because the API is from a known platform (Shopify, etc.). Test with a real endpoint.
**Prefer response body pagination detection** (product count, next-page token) over HTTP headers when the body is already parsed for data extraction. An extra network dependency on headers is fragile.
**Pagination tests must use mock HTTP responses** that simulate multiple pages (e.g., MockWebConnection) and verify all pages were processed, not just that `hasNextPage()` returned a boolean.
**Shopify public API has a 25K pagination cap** — The `/collections/.../products.json` endpoint caps any query at `page * limit <= 25000`. This is not rate limiting — the API simply stops returning data. Use sub-collections (by scale, vendor, etc.) to avoid the cap. The error message `{"errors":"Page * Limit exceeds the 25000 limit."}` indicates this cap has been hit.

### Required Per-Project Files

- **`start.sh`** - A shell script in the project root that starts the application.
  - Must be executable (`chmod +x start.sh`)
  - Must start the application in a way that users/developers can run it locally

### Required Git Precommit Hooks

Every project must have a precommit hook (at `hooks/pre-commit` or `.git/hooks/pre-commit`) that runs:
1. **Linting** - Check code style/formatting
2. **Tests** - Run the full test suite
3. **Coverage** - Verify code coverage is at least **95%**
4. **Smoke test** (for desktop/web apps) - Verify the app builds and launches without errors
For desktop apps (Electron, Tauri, etc.) and web apps, unit tests alone are not sufficient. The smoke test must verify:
- The build pipeline compiles without errors
- All referenced files exist (no dangling references in config files)
- The app process can start without crashing
- The renderer can load the app (no `ERR_FILE_NOT_FOUND` or equivalent)
If any of these checks fail, the commit must be rejected.

### Technology

#### Gleam + Lustre + Electron Stack

When building desktop apps with Gleam targeting JavaScript, served via Electron:
**Build Pipeline**
- `gleam build --target javascript` compiles Gleam to JavaScript in `build/dev/javascript/`
- `index.html` is copied to `build/dev/javascript/index.html` after the Gleam build
- Any JavaScript FFI modules are copied to the appropriate build output directory
- Electron loads `build/dev/javascript/index.html` directly in production mode
**Dependency Warnings**
- `gleam build` emits warnings from third-party packages (`gleam_erlang`, `gleam_otp`, etc.) in `build/packages/`
- These warnings do **not** cause a non-zero exit code — `gleam build` returns 0 even with warnings
- The precommit hook and `start.sh` must filter these out using this pattern:
  ```bash
  BUILD_OUTPUT=$(gleam build --target javascript 2>&1) || { echo "$BUILD_OUTPUT"; exit 1; }
  PROJECT_WARNINGS=$(echo "$BUILD_OUTPUT" | awk '/^warning:/{w=$0; next} /build\/packages\//{w=""; next} w{print w; w=""}') || true
  if [ -n "$PROJECT_WARNINGS" ]; then
      echo "ERROR: Warnings in project source code:"
      echo "$PROJECT_WARNINGS"
      exit 1
  fi
  ```
- `start.sh` should suppress dependency warnings for a clean dev experience but still show project warnings
**Coverage with Erlang (`cover` tool)**
- For Gleam projects using Erlang tests, coverage runs via custom escript
- The escript must include **all dependencies** in `-pa` paths, not just the main project
- Missing dependency paths causes `error:undef` at runtime because modules aren't loaded
- Example: if using `simplifile`, the escript must include `-pa build/dev/erlang/simplifile/ebin -pa build/dev/erlang/filepath/ebin
**Code Coverage with c8**
- Gleam tests run via `gleam test --target javascript`
- c8 measures coverage on the compiled JavaScript output
- c8 reports on the `.mjs` files in `build/dev/javascript/`, not the original `.gleam` files
- **Coverage must be enforced at 95%+ on statements, lines, and branches** — c8 does not fail on low coverage by default
- **Do NOT enforce function coverage** — Gleam compiles wrapper functions that are never called internally
- Use `.c8rc.json` to configure coverage thresholds
- Use `npx c8 --check-coverage --lines 95 --branches 95 --statements 95` in the precommit hook
- **Exclude `main.mjs` from coverage** — the `main()` function requires a browser DOM

### Snapshot Testing with Birdie

**What is Birdie?**
Birdie is a snapshot testing tool for Gleam. Instead of writing manual assertions for complex outputs (like checking every single tag in a Lustre view), Birdie captures the entire output and saves it as a "snapshot" file. On subsequent runs, it compares the current output against the saved version and highlights any differences with a visual diff.
**When to Use It:**
- UI/Lustre Views: To ensure that changes to view functions don't accidentally break the HTML structure or remove critical CSS classes.
- Large Data Structures: When a function returns a complex record or list that would be tedious to assert field-by-field.
- Integration Bridges: To verify the final string output of serialisers or FFI-bound data before it leaves the Gleam boundary.
**The Workflow:**
1. **Record**: Run `gleam test`. New snapshots are created and fail the test by default.
2. **Review**: Run `gleam run -m birdie` to see the visual diff of the new/changed output.
3. **Accept**: If the change is intentional, run `gleam run -m birdie accept` to set the new version as the baseline.
**Why Use It in this Project?**
Birdie provides high-confidence coverage of Lustre view functions. It ensures that critical UI elements are rendered with the correct classes and hierarchy without requiring fragile unit tests.
**Electron Configuration**
- `electron/main.js` should load the build output directly: `win.loadFile(path.join(__dirname, '..', 'build', 'dev', 'javascript', 'index.html'))`
- Use `contextIsolation: true` and `nodeIntegration: false` for security
- IPC communication uses preload scripts and `contextBridge`
**Context Boundary Pattern: Env Vars in Electron**
In Electron, the renderer process does **not** have access to shell environment variables. To pass env vars to the renderer:
1. **Main process**: Read `process.env.VAR` directly
2. **Preload script**: Expose via `contextBridge.exposeInMainWorld('__key__', process.env.VAR)`
3. **FFI function**: Read from `window.__key__` in the Gleam renderer
```javascript
// electron/preload.js
contextBridge.exposeInMainWorld('__deepseekKey__', process.env.DEEPSEEK_API_KEY || '');
```

```javascript
// src/app.ffi.mjs
export function get_deepseek_key_from_window() {
  if (typeof window === 'undefined') return "";
  return window.__deepseekKey__ || "";
}
```

**Start Script (`start.sh`)**
- Must clean stale artifacts before rebuilding: `rm -rf build dist dist-electron coverage`
- Must filter dependency warnings (see pattern above)
- Must show compilation summary line
- Must **build both JavaScript and Erlang targets** before running tests
- Must start dev server: `npm run dev`
**Precommit Hook (`hooks/pre-commit`)**
- Must run `gleam format --check`
- Must build both JavaScript and Erlang targets, filter dependency warnings, fail on project warnings
- Must run `npx c8 --check-coverage --lines 95 --branches 95 --statements 95 gleam test --target javascript`
- Must run smoke test: clean build, verify files exist, start Electron, confirm it launches
- Must use `set -e` for fail-fast behavior
**Project Structure**
- Gleam project root contains `gleam.toml`, `manifest.toml`, `src/`, `test/`
- `electron/main.js` sits at project root level
- `index.html` is the renderer entry point
- `start.sh` is the entry point for developers
- `hooks/pre-commit` enforces quality gates
**Common Pitfalls**
- `gleam format --check` only checks project source, not dependencies — this is correct
- `gleam build` exit code 0 does not mean "no warnings" — must inspect output
- c8 coverage percentages are informational only — must be explicitly gated
- **Function coverage on compiled Gleam JS is meaningless** — Gleam compiles wrapper functions that are never called internally
- Electron smoke test must wait for window to appear (poll, don't assume instant startup)
- **Lustre drag-and-drop requires preventDefault()** — In HTML5 drag-and-drop, the `dragover` event has a default "no drop" behavior. To allow a drop, use `event.prevent_default(event.on("dragover", decoder))` to wrap the handler. Without `prevent_default()`, the browser won't allow the drop even though the handler fires.
- **Snapshot tests catch view logic errors** — Birdie tests would have caught incorrect state machine logic earlier if all states were covered. When implementing multi-state UI components, write snapshot tests for each distinct state.
- **Test environment ≠ production environment** — Unit tests run in Node.js, but Electron renderer and other contexts may not have access to shell environment variables, browser APIs, or Node.js-specific modules. Code that passes tests may fail in production if it depends on context-specific features.
- **Electron renderer has no shell env vars** — Never use `envoy.get()` or `process.env` in the renderer. Environment variables must be passed through preload via `contextBridge.exposeInMainWorld()`.
**FFI is STRICTLY PROHIBITED** — No `@external` declarations in project source unless **explicitly permitted by the user**. Before adding ANY `@external`:
1. Check **Hex.pm for pure Gleam alternatives first**
2. **Prove** no pure Gleam solution exists
3. Add a code comment citing WHY pure Gleam won't work
4. The user must explicitly authorize the FFI
The precommit hook rejects ALL commits containing `@external`:
```bash
FFI_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(gleam|mjs)$' | xargs grep -l '@external' 2>/dev/null || true)
if [ -n "$FFI_FILES" ]; then
    echo "ERROR: FFI files detected in commit"
    exit 1
fi
```

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

### CI/CD

All projects must have GitHub Actions configured:
- **Lint check** - Run linter in CI
- **Test suite** - Run all tests in CI
- **Coverage check** - Verify 95%+ coverage in CI
- **Build** - Verify project builds successfully
- **Production gating** - Only deploy to production on main branch or tagged releases
- **[2026-06-12] [CI/CD] Reusable workflow permissions must be explicit** — Calling workflows that use reusable workflows must explicitly grant any permissions the reusable workflow requests (e.g., `pull-requests: write`). Missing permissions cause validation failures at the `uses:` line. Read GitHub's file/line/column error message to identify the exact permission needed.
- **[2026-06-23] [CI/CD] GitHub Actions Checkout Depth for Merge Commits** — `actions/checkout@v4` with `ref: refs/pull/N/merge` defaults to `fetch-depth: 1`, fetching only the merge commit. Parent SHAs (`base.sha`, `head.sha`) referenced in git operations will fail with exit code 128 unless `fetch-depth: 0` (or `2`) is explicitly set.

### Code Review

**Empty-Config-First for Analysis Tools** — When adding a new analysis tool to the build, start with the strictest sensible configuration (e.g., `maxIssues: 0`) and only add suppressions for actual, proven violations. Do not pre-suppress rules you haven't seen fail — run the tool first, fix what it finds, then decide whether remaining violations are worth suppressing.

Add code quality tools to precommit hooks:
- **Linting** - Style and format checking
- **Static analysis** - Code quality tools (e.g., ESLint, Clippy, SonarQube)
- **Security scanning** - Vulnerability detection
- **Complexity check** - Flag overly complex code
When addressing code review findings (from automated tools, PR comments, or AI reviewers):
- **Verify before acting** — Read the relevant source lines and confirm the claim is accurate before implementing a fix. Code reviews can produce false positives (e.g., flagging imports as unused when they are used, or claiming CSS classes are missing when they exist in other files).
- **If verified** — proceed with the fix. **If false** — do not make the change and document why it was rejected.
- **Linter rules take precedence over code review suggestions** — If a code review finding conflicts with an enforced linter rule, follow the linter rule and find an alternative approach (e.g., scoping constants more narrowly rather than removing them entirely). The precommit hook enforces linter rules, so any fix that violates them will be rejected regardless of the code review's intent.

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

### Application

These rules apply to all agent invocations in any project that does not explicitly override them.

## Obsidian ↔ OpenCode Server Setup

This configuration lives outside any project — it's a macOS launchd agent that keeps the opencode server permanently running for the Obsidian plugin (`opencode-obsidian`).

### The Problem

The Obsidian plugin spawns opencode as a child process, inheriting Obsidian's environment. Obsidian is a macOS GUI app and **does not** inherit shell environment variables from `.zshrc`/`.bashrc`. This means:

- `OPENCODE_DEEPSEEK_API_KEY` set in `.zshrc` is invisible to the server
- Every reboot or plugin restart requires re-entering or re-setting the API key
- The vault-level `opencode.json` (at `ForgottenRealmsVault/opencode.json`) can specify a mismatched model that overrides the global config

### The Fix: Launchd Agent

The server is managed by `~/Library/LaunchAgents/com.opencode.server.plist`:

```xml
<key>Label</key>
<string>com.opencode.server</string>
<key>ProgramArguments</key>
<array>
    <string>/opt/homebrew/bin/opencode</string>
    <string>serve</string>
    <string>--port</string>
    <string>14096</string>
    <string>--hostname</string>
    <string>127.0.0.1</string>
    <string>--cors</string>
    <string>app://obsidian.md</string>
</array>
<key>EnvironmentVariables</key>
<dict>
    <key>OPENCODE_DEEPSEEK_API_KEY</key>
    <string><API_KEY_HERE></string>
</dict>
<key>RunAtLoad</key>
    <true/>
<key>KeepAlive</key>
    <true/>
```

Key properties:
- **`RunAtLoad: true`** — starts at user login (launchd loads all `~/Library/LaunchAgents/` plists at login)
- **`KeepAlive: true`** — auto-restarts if it crashes
- **`EnvironmentVariables`** — the API key lives **inside the plist**, not in a shell config file, so it survives reboots
- **Port 14096** — matches the Obsidian plugin's configured port

### Obsidian Plugin Settings

The plugin should NOT manage its own server since launchd handles it:

```json
{
  "port": 14096,
  "hostname": "127.0.0.1",
  "autoStart": false,
  "useCustomCommand": false,
  "opencodePath": "/opt/homebrew/bin/opencode",
  "projectDirectory": ""
}
```

Set in the plugin settings panel:
- **Auto-start server**: OFF
- **Use custom command**: OFF
- **OpenCode executable path**: `/opt/homebrew/bin/opencode`

### Verification Commands

```bash
# Check server is running
lsof -i :14096 | grep LISTEN

# Verify the API key is in the server's environment
ps eww -p $(pgrep -f "opencode.*14096.*obsidian" | head -1) | tr ' ' '\n' | grep DEEPSEEK

# Check launchd registration
launchctl list | grep opencode

# View server logs
cat /tmp/opencode.out.log
cat /tmp/opencode.err.log

# Manually load/unload
launchctl load ~/Library/LaunchAgents/com.opencode.server.plist
launchctl unload ~/Library/LaunchAgents/com.opencode.server.plist
```

### Vault-Level opencode.json

The file at `ForgottenRealmsVault/opencode.json` should only override model if intentional. The global config at `~/.config/opencode/opencode.json` is the source of truth for provider/model setup.

### When It Breaks

If the connection is lost after a reboot:
1. Verify the launchd agent is loaded: `launchctl list | grep opencode`
2. Verify the server is listening: `lsof -i :14096`
3. Verify the API key is present: `ps eww -p <PID> | grep OPENCODE`
4. If missing, recreate the plist with a fresh API key and `launchctl load`

## Process Integrity

Nothing should ever be "skipped" - our process must be thorough and repeatable:
- **No skipping tests** - All tests must pass, never use `.skip()` or disable tests
- **No skipping linting** - All linting must pass, never disable rules
- **No skipping coverage** - Coverage must meet the 95% threshold
- **No skipping precommit hooks** - All checks must pass before commit
- **No workarounds** - Fix problems properly, don't bypass them
- **No self-granted exceptions** — Never decide a process rule doesn't apply without asking the user. If you believe an exception is warranted (e.g., "this is just config, no test needed"), propose it explicitly and wait for approval. Default to applying the rule; shift the burden of proof onto the exception, not the compliance.
Every outcome must be verifiable and every verification must be repeatable.

### Incident Analysis: Five Whys

When bugs or failures occur, apply the **Five Whys** technique to trace from symptom to systemic root cause. For each level of "why", identify a small, concrete improvement that would reduce the chance of recurrence at that level. These improvements are often independent — invest in all of them, not just the root.
- **Level 1 (immediate symptom)** — What could detect or guard against this symptom earlier? (e.g., validation, error handling)
- **Level 2 (direct cause)** — What test or check would catch this specific mistake?
- **Level 3 (design issue)** — What naming convention, module boundary, or architectural rule would make this mistake harder to make?
- **Level 4 (process issue)** — What step in the development workflow was skipped or inadequate?
- **Level 5 (guidance gap)** — What principle or rule was missing from the team's shared understanding?
The goal is not a single "root cause fix" but a set of complementary investments at every layer of the chain.

### Defects Are Process Failures

Any time a human reports a defect — in functionality, a code artifact, a build step, a process — it means **a test is missing** and **the process has failed**. Humans should report the need for new features or changes, not that existing things do not work. Every defect report must be treated as a process failure investigation, not a "fix the symptom" ticket. The investigation must identify:
- Which test was missing (or was insufficient) to catch the defect
- Which process step failed (skipped, inadequate, unenforceable)
- What change to tooling, hooks, or AGENTS.md prevents recurrence

## Done Criteria

A change is not complete until it passes **all** precommit hook checks:
1. **Linting** - Code style/formatting checks pass
2. **Tests** - All tests pass
3. **Coverage** - Code coverage is at least 95%
4. **Smoke test** (for desktop/web apps) - The app builds, starts, and renders without errors
This applies even if the change is not committed. Running the precommit hook is the definition of "Done".

### Smoke Test Principle

**Unit tests verify logic. Smoke tests verify integration.** For any app with a build pipeline (Vite, Webpack, etc.) or a desktop shell (Electron, Tauri), you must verify the app actually launches and renders after changing:
- Build configuration files (`webpack.config.js`, `gleam.toml`, etc.)
- Entry points (`electron/main.js`, `preload.js`, etc.)
- HTML templates or shell files
- Any file that is referenced by config but not compiled
If you delete or rename a file, verify that no config still references it. A missing file reference is a build-time error that unit tests cannot catch.

## Retrospective Findings

**Tag convention:** Entries with a tech-stack prefix (`[React]`, `[Gleam]`, `[TypeScript]`) apply only to projects using that stack. Entries with only a category tag (`[Process]`, `[Testing]`, `[Architecture]`, `[Positive]`, `[Tooling]`, `[Coverage]`) are tech-stack-agnostic. Multi-tag entries like `[React/Tooling]` are specific to that tech stack within that category.

### Compliance Drift Prevention

Projects drift from AGENTS.md compliance when:
- Feature commits bypass process rules without detection
- Global rules are updated but project configs aren't migrated
- Hooks are incrementally fixed but never fully aligned
**Prevention principles:**
1. **Automated enforcement** — Pre-commit hooks must detect rule violations (FFI, coverage, etc.)
2. **Coverage isolation** — Measure only project source, not dependencies
3. **Five Whys** — Trace defects to missing tests and process gaps, not just symptoms

- **Retrospectives assess documentation/artifact gaps** — Each retrospective should review whether future interactions with the project could be improved by adding or updating supporting files, artifacts, or documentation (module maps, pattern indexes, dependency-flow diagrams, architecture decision records, etc.). Consider the maintenance burden: documentation that isn't kept in sync actively misleads. Prefer automatically generated or validated documentation over hand-written prose. If a gap is identified and worth addressing, capture it as a backlog item for implementation outside the retrospective.

- **[2026-06-06] [Testing] Test Resource Cleanup** — When adopting a test pattern from another file, verify resource management (streams, sockets, clients) is equivalent between source and destination. A copy that omits `.use {}` or `close()` creates a leak that may go undetected until CI runs hit file-descriptor limits.

- **[2026-06-06] [Architecture] Manual Pagination as Last Resort** — Before writing a custom pagination loop, check if the base class already handles it via a `nextPage()` hook. Adding a `nextPage()` override to the listing page is almost always cleaner than duplicating the loop logic.

- **[2026-06-08] [Positive] Incremental Module Split** — Splitting a monolithic module one domain at a time with a commit after each extraction keeps tests green throughout large refactorings. Build and test after each extract step before moving to the next domain to prevent cascading failures.

- **[2026-06-21] [Process] No software installation or system changes without explicit permission** — Diagnosing a problem and immediately executing a fix (e.g., `brew reinstall awscli`) without asking is a process violation. System-level changes — installing packages, modifying PATH, altering configuration files outside the project — must be proposed first, with options presented, and explicitly approved before execution. This applies regardless of how obvious or "safe" the fix appears.

#### 2026-06-23 Process Rules

- **No Self-Granted Exceptions** — The agent may subconsciously categorize a change as "not real code" and skip test-first or other TDD steps. Never decide a rule doesn't apply without asking. Default to applying the rule; shift the burden of proof onto the exception, not the compliance. A request to "prototype" or "explore" does not waive this rule — a prototype's test can change as the design evolves, but it must exist before implementation.

- **Verify deployment pipeline before modifying deployment files** — Before changing deployment scripts, readme deployment sections, or infrastructure, verify the actual deployment mechanism by checking CI/CD config (GitHub Actions, Amplify, etc.), build logs, automation like `enableAutoBuild` on Amplify branches, or by asking the user. A stale readme describing a deprecated manual process can lead to wasted effort and incorrect infrastructure changes.

- **Pre-commit Hook Must Work in Non-TTY** — Tooling with terminal UI (tcell, etc.) crashes in agent/CI/headless environments. When using CLI tooling in the pre-commit hook, verify compatibility with non-interactive execution (e.g., `--mode=mono` flag for SST).

- **Let the Pre-commit Hook Manage Infrastructure Lifecycle** — When the pre-commit hook script already handles starting, waiting for, and probing dependent services, do NOT start those services manually for debugging. Read the hook script to understand the lifecycle before intervening. Starting services separately wastes time and creates conflicts.

- **Backlog Items Describe Goals, Not Solutions** — A backlog item should state what needs to be achieved (the outcome), not prescribe how to achieve it (the implementation). The solution is determined during execution. Prescribing a fix in the backlog title assumes an unverified diagnosis.

- **[2026-06-25] [Process] Review Prompt Should Not Suppress Refactoring Findings** — The system prompt told the model to ignore "refactoring opportunities that are out of scope for this change," which suppressed findings when the PR was itself a refactoring. Review prompts must not use broad suppression categories that overlap with the PR's purpose.

- **[2026-06-25] [Process] Largest Files Need the Most Review** — The review script excluded files >50K chars, silently skipping the most complex files. Per-file size exclusion is wrong — include large files and suggest splitting them.

- **[2026-06-25 / 06-27] [Process] "Pre-existing" Is Never a Valid Reason to Dismiss an Error** — Dismissing a test failure, LSP error, or build warning as "pre-existing" violates process integrity. Every issue must be fixed or explicitly acknowledged — never hand-waved as "not my changes" or "not a real issue."

- **[2026-06-25] [Process] Code Review Claim Verification** — Code review tools (AI and automated) can produce false positives. Before acting on any review finding, verify the claim against the actual source code by reading the relevant lines. If confirmed, proceed; if false, reject and document why.

- **[2026-06-25] [Positive] Systematic Backlog Processing** — Processing a backlog of 9 items one-at-a-time with clear propose/confirm/implement/commit cycles prevented batch confusion and allowed false positives to be caught early. Maintain this rhythm for backlog-driven sessions.

- **[2026-06-26] [Testing] userEvent over fireEvent for Interaction Tests** — `fireEvent.keyDown` only tests the keyDown handler in isolation and does not simulate the browser's default click dispatch for buttons on Enter/Space. `@testing-library/user-event` simulates the full event chain including default actions, `preventDefault` propagation, and disabled-state blocking. Prefer `userEvent.keyboard()`/`userEvent.click()` over `fireEvent.keyDown`/`fireEvent.click` for any interaction test that should reflect real browser behavior.

- **[2026-06-26] [Process] Multi-File Git Blame for Stale Test Investigation** — When a test fails and the feature it tests appears to be missing from the component, run `git log --follow` on both the component and test files. Crossed commits (one adding a test, another removing the feature on a divergent branch) are invisible when checking either file in isolation. Multi-file history trace prevents misdiagnosis.

- **[2026-06-27] [Architecture] Parent Key Prop Replaces ID-Change Effects** — When a component resets local state on prop ID changes, check if the parent already passes `key={id}`. If so, the component remounts on ID change and no `useEffect` + `useRef` pattern is needed, eliminating `set-state-in-effect` lint violations entirely. The simplest solution is discoverable by checking usage context first.

- **[2026-06-27] [Positive] Context-Aware Refactoring** — Before simplifying a component's internal state management, check how it's actually used by its callers. The parent's `key` prop pattern eliminated two `useEffect` hooks that had been considered necessary. Understanding the call site context is often the key to simpler internal implementation.

- **[2026-06-28] [Process] Questions About Plans Are Not Go-Aheads** — When a user asks "what's the plan", "what's the approach", or similar, they want a description of the proposed course of action, not execution. State the plan in text and wait for an explicit go-ahead before taking any implementation action.

- **[2026-06-28] [Positive] Refactoring Special Cases to General Principles** — When a design accumulates many narrow rules for individual scenarios, step back and identify the general principles that subsume them. The DeepSeek SYSTEM_PROMPT was reduced from 15 specific bullets to 2 principles (Indirection, Inconsistency). This pattern applies to any ruleset, configuration, or abstraction that keeps growing with band-aids.

- **[2026-06-29] [Process] PCP Backlog Lifecycle After Commits** — Commits referencing `B###` IDs do not auto-dismiss backlog items in PCP. Call `pcp_dismiss B###` immediately after making a resolving commit, regardless of whether the item was promoted or worked on directly. Do not wait for the user to ask or for a follow-up turn.

- **[2026-06-30] [React/Tooling] replaceAll String Constant Gotcha** — ESLint `no-duplicate-string` fixes using `replaceAll` also replace inside the constant definition itself, creating a self-referencing variable. Always verify the definition line immediately after `replaceAll` and fix `const X = X` to `const X = "X"`. **JSX extension:** `replaceAll` on JSX prop strings also strips required curly braces: `placeholder="Search..."` becomes `placeholder=SEARCH_PLACEHOLDER` instead of `placeholder={SEARCH_PLACEHOLDER}`. Fix both the definition line and any JSX curly braces after using `replaceAll` on JSX content.

- **[2026-06-30] [Architecture] Imperative API for Module-Level UI Triggers** — When a module-level utility (e.g., `notifyError`) needs to trigger React UI updates, use an imperative API with a `useEffect` that assigns a module-level function pointer. A Context hook is not usable from module scope. Example: `showToast` in Toast.tsx.

- **[2026-07-04] [Tooling] Vitest autoUpdate Unreliable** — Vitest's `autoUpdate: true` can decrease coverage thresholds despite some documentation claiming otherwise. Do not rely on it. Use a manual ratchet script that parses vitest's text output and only updates thresholds upward, as demonstrated by `scripts/ratchet-coverage.ts` in scheduler4.

- **[2026-07-01] [Positive] Cross-Review Gap Analysis for Prompt Improvement** — When two AI reviewers (e.g. Gemini vs DeepSeek) disagree and one misses an issue the other catches, that gap is a direct candidate for prompt improvement. Use side-by-side comparison of reviews to identify blind spots in the SYSTEM_PROMPT and add targeted rules with regression tests.

- **[2026-07-01] [Testing] Global State Mutation Restoration** — Tests that mock global objects (e.g., `navigator.clipboard`, `window`) must save the original value and restore it in `afterEach` to prevent isolation leaks. Pattern: `const original = target.prop; afterEach(() => { Object.assign(target, { prop: original }) })`.

- **[2026-07-04] [Coverage] Threshold Adjustment After Code Removal** — Removing dead code (optional parameters, if-guards, unused test scenarios) changes the branch/line count, causing coverage percentages to shift slightly. This is different from lowering thresholds to hide untested code. When this happens, adjust thresholds with a commit comment explaining that code was removed, not left untested. **Never lower thresholds to cover up untested code** — instead, investigate the uncovered lines and add tests. If you cannot determine the cause, ask the user before adjusting.

- **[2026-07-05] [Process] Relay PCP Tool Output in Text Responses** — Tool results from `pcp_backlog`, `pcp_status`, `pcp_history`, etc. are returned to the assistant and may not be visible to the user. Always include the key information from PCP tool calls in your own text response. Do not call a PCP tool silently and assume the user saw the result.

- **[2026-07-05] [Process] Compile Errors Are Not Failing Tests** — A type mismatch or compile failure prevents compilation entirely, meaning no test can run. In TDD, the "red phase" requires a test that compiles and fails at runtime. A compile error is a broken state, not a failing test. Before writing the test, first fix the types so the code compiles; only then can you write a test that runs and fails with the expected behavior.

- **[2026-07-05] [Positive] Multi-Layer Bug Fix Pattern** — When a bug manifests across multiple layers (backend error type → server handler → client UI), fix each layer independently with its own test rather than one monolithic change. The three-commit chain (error propagation → MIME type → UI display) kept each commit focused and testable, with a clean TDD gate for each. Propose the layer breakdown to the user first to confirm the approach.

- **[2026-07-06] [Process] Compaction Threshold Ignores Blank Lines** — The AGENTS.md compaction rule says to propose compaction when the file exceeds 600 lines, but blank lines should not count toward the threshold. Only content lines (non-whitespace, non-empty) matter for determining file size. Cosmetic blank-line removal is not compaction.

- **[2026-07-07] [Coverage] Investigate Before Lowering Thresholds** — When the pre-commit hook rejects a commit due to coverage threshold violations, do not lower thresholds as a first response. Investigate what caused the drop, identify uncovered lines, and add tests. Only when dead code removal is the confirmed cause should thresholds be adjusted, and only with a commit comment explaining why.

- **[2026-07-08] [React/Testing] Controlled Component State Simulation** — For controlled components, invoking a callback (e.g., `fireEvent.click` on a clear button) only fires the `onChange` callback. The UI only updates when the parent re-renders with the new prop value via `rerender`. Tests must simulate the parent state update to verify UI state changes.

- **[2026-07-08] [Process] Search for Regression Tests Before Behavior Changes** — Before modifying event handlers or component behavior, search for all test files referencing the component or behavior. Existing regression tests may depend on the current behavior and must be understood before making changes.

- **[2026-07-08] [Positive] Batch Similar Refactorings with Analysis** — Constants extraction across 14 files was efficient because: a thorough `grep`/`rg` analysis identified all occurrences first, the user explicitly approved batching, and the constants file was pre-tested. Repeat this pattern for other cross-file refactorings.

- **[2026-07-12] [Process] Two-Turn Protocol Is Not Optional After Tests Pass** — Committing immediately after tests pass without proposing first violates the two-turn protocol. Passing tests are a prerequisite for commit, not a substitute for the proposal step. The proposal-and-execution cycle must complete every time, even when the change feels trivial or obviously correct.

- **[2026-07-12] [Testing] Optional Clearable Fields in API Services** — An API service test for `updateQuality` with name only missed a bug where clearing an optional description to empty sent `null`, which the service silently skipped. Every optional clearable field needs tests for both setting and clearing (empty string) the value, not just for omitting it.

- **[2026-07-14] [Testing] Validate Generated Output Against Real Parser** — When generating code or models in an existing format (CML, PlantUML, etc.), test the output against that format's actual parser, not just against expected strings. String-matching tests pass even when the output is structurally invalid; the real parser catches schema violations.

- **[2026-07-12] [Architecture] Eventual Consistency After GSI Write** — When a PATCH writes to DynamoDB's primary table and the subsequent read queries a GSI, the GSI may still be stale. Use the PATCH response directly to update in-memory state via a mutable provider (e.g., `AsyncNotifierProvider`) rather than invalidating and refetching from the eventually-consistent index.

- **[2026-07-12] [Process] Two-Layer Defect Investigation** — The quality description update bug had two independent root causes (null-vs-empty payload handling + stale GSI read), each sufficient to reproduce the symptom. When investigating a defect, continue searching for additional contributing factors even after finding one plausible cause — a single fix may not resolve the issue.

- **[2026-07-13] [Positive] Coverage-Driven Service Extraction** — Extracting state management from StatefulWidgets into pure-Dart services (like `PassageAssociationService`) simultaneously improves testability and architecture. The service reached 100% coverage with unit tests that run in milliseconds, while the widget wrapper became a thin delegation layer. When a widget's internal logic is hard to test through the widget tree, extract it into a service first.

- **[2026-07-13] [Process] No Untested Code Is "Trivial"** — Every line of code has behavior that should be verified. Dismissing code as "trivial" or "just a loading indicator" creates blind spots where regressions can hide. If a line cannot be tested, it should be removed or refactored — not hand-waved.

- **[2026-07-13] [Coverage] Coverage Tooling Enables Improvement** — Setting up `lcov` and a pre-commit coverage gate was the catalyst that made all subsequent improvement possible. Coverage enforcement is not an end goal — it's the feedback mechanism that reveals where extraction, refactoring, and testing are needed. Every project should have visible, enforced coverage thresholds before any optimization work begins.

- **[2026-07-16] [Process] Urgency Does Not Waive Two-Turn Protocol** — Your process is what you do under stress. If you don't do it under stress, it's not actually your process. Perceived urgency, user frustration, or "FIX THIS NOW" language does not waive the requirement to propose before executing and ask permission before committing. An unauthorized fix compounds the original problem with a process violation. Propose each step; wait for the go-ahead.

- **[2026-07-18] [Process] Pre-commit Hook Timeout Alignment** — The `runTests.sh` health probe uses `curl` with a 5s timeout while the integration test's `ensureBackendReachable` uses `fetch` with a 2s AbortController timeout. An API Gateway cold start that takes 3-4s passes the health check but fails the integration test. When the pre-commit hook tests the same endpoint twice, ensure both use the same timeout.

- **[2026-07-19] [React/ESLint] No eslint-disable Directives** — Eslint-disable directives of any form are prohibited. When `jsx-a11y/no-noninteractive-element-interactions` fires on a modal backdrop, use a `<button>` with reset CSS styles instead of `<div>` + eslint-disable. When `onKeyDown` is needed on a `role="dialog"` div, attach the listener via `useEffect` + `addEventListener` on the ref instead of a JSX prop. Permission to add an eslint-disable will not be granted — restructure to comply.

- **[2026-07-19] [Process] Optimization TDD: Existing Tests as Safety Net** — Behavior-preserving optimizations (caching, algorithm improvements, data structure changes) don't require a new "failing test" since the behavior doesn't change. The existing test suite serves as the regression gate. Write documentation tests for uncovered functions if desired, but the optimization itself is a green-to-green transition.

- **[2026-07-20] [Process] Run Generated Output Immediately** — A generator that compiles is not verified. Generated output (shell scripts, config files, deployment artifacts) must be run at least once to confirm it produces the intended result. Treat the first execution as the final step of code generation, not the start of debugging.

- **[2026-07-20] [Process] Infrastructure Config Is Discovery, Not Design** — When output doesn't work, the gap is almost always in tool-specific syntax (shell quoting, SST interpolate, CDK annotations). Don't guess at fixes — find and read a working example that uses the same tool. The answer exists in someone else's project or the tool's docs; deriving it from first principles produces serial guesswork.

- **[2026-07-20] [Testing] Test Generator with Varied Input Configurations** — A code generator must be tested with at least two different input configurations to expose hardcoded assumptions and copy-paste paths that only surface with a different model shape. The Dynamo repo emitter's update/delete methods hardcoded `passageId` because every test used the Passage entity where `passageId` is the ID field; the bug only appeared when generating a Quality entity with `qualityId`.

- **[2026-07-21] [Testing] Assert Structural Constraints in Generated Output** — When testing generated code, verify structural properties (count, uniqueness, type) rather than string presence alone. An assertion using `split("subtitle:").size - 1` catches duplicate named arguments generically, while a plain `contains("subtitle:")` assertion would pass even with duplicates, letting a compile error reach the user.

- **[2026-07-21] [Architecture] Unconsumed Data Is Dead Weight** — Any field or property that flows through a pipeline but is never consumed by downstream code should be removed. `repositoryName` on `Crudable`/`CrudPane` was set in 19 places but never read by any emitter; removing it simplified the interface with zero behavior change. Apply this principle to any layer boundary: if a value is passed through but never used, delete it.

## Archived Entries (2026-07-06)

These entries have been archived as of this retrospective. They document specific platform/tool gotchas that are no longer frequently encountered but preserved for reference.
- **[2026-06-08] [Coverage] Erlang Cover Tool Assert Ok Dead Branches** — Erlang `cover` counts unreachable `assert Ok` error branches for hardcoded patterns as uncovered lines. Prefer `case` with a safe fallback over `assert Ok` to eliminate false coverage gaps without crashing.
- **[2026-06-21] [Process] Login Item Service Environment Verification** — When a macOS Login Item starts a service with required env vars, verify the running process actually has them by checking `ps eww -p <PID> | grep VAR`. Dependent apps with autoStart must be disabled — they spawn their own server instance sharing the same port but without the Login Item's env var injection.
- **[2026-06-23] [CloudFront] CloudFront Distribution Discovery and CNAME Locks** — When a domain is served behind CloudFront but the distribution doesn't appear in `aws cloudfront list-distributions`, check AWS Amplify which creates managed CloudFront distributions for custom domains. Before creating a new distribution for an existing domain, verify the domain isn't already associated with another distribution via `CNAMEAlreadyExists`.
- **[2026-07-05] [Exposed] Domain Operations Require Transaction Context** — Exposed lazy entity properties (e.g., `entity.reducedProductDescription`) can only be accessed within an active transaction. Domain classes that access these properties must be called inside `withTransaction { }` or `transaction { }`.