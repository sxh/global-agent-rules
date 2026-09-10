---
name: stack-playbooks
description: "Per-stack engineering playbooks relocated from AGENTS.md — Gleam + Lustre + Electron, Birdie snapshot testing, React/TypeScript, JVM. Load when working in the named stack."
---

# Stack Playbooks

Relocated from `AGENTS.md` (branch `refactor/agent-layers`, 2026-09-09). Load this when
working in one of the named stacks; it is not needed for other work.

---

Rules in this section apply only when working in the named stack. **AWS is the exception** — it is common infrastructure and its rules live in the generic sections (Cloud Environments, etc.).

#### Gleam + Lustre + Electron Stack

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
- **[2026-06-08] [Coverage] Erlang Cover Tool Assert Ok Dead Branches** — Erlang `cover` counts unreachable `assert Ok` error branches for hardcoded patterns as uncovered lines. Prefer `case` with a safe fallback over `assert Ok` to eliminate false coverage gaps without crashing.

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

#### Snapshot Testing with Birdie

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

#### React / TypeScript Stack

- **[2026-06-27] [React/Architecture] Parent Key Prop Replaces ID-Change Effects** — When a component resets local state on prop ID changes, check if the parent already passes `key={id}`. If so, the component remounts on ID change and no `useEffect` + `useRef` pattern is needed, eliminating `set-state-in-effect` lint violations entirely. The simplest solution is discoverable by checking usage context first.

- **[2026-07-31] [React] Render-Phase State Adjustment for Prop-Driven Resets** — When a prop change must reset local state but the parent does not guarantee `key={id}`, track the previous id in state and adjust state during render instead of using a `useEffect`. PaintRangeNotes compared `prevRangeId !== paintRange.id` during render to sync notes and exit edit mode on range switches while preserving the user's in-progress draft on same-id updates.

- **[2026-06-30] [React/Tooling] replaceAll String Constant Gotcha** — ESLint `no-duplicate-string` fixes using `replaceAll` also replace inside the constant definition itself, creating a self-referencing variable. Always verify the definition line immediately after `replaceAll` and fix `const X = X` to `const X = "X"`. **JSX extension:** `replaceAll` on JSX prop strings also strips required curly braces: `placeholder="Search..."` becomes `placeholder=SEARCH_PLACEHOLDER` instead of `placeholder={SEARCH_PLACEHOLDER}`. Fix both the definition line and any JSX curly braces after using `replaceAll` on JSX content. **Cross-file extension:** `replaceAll` on a test file also replaces matching strings in imported production files (same literal in `aria-label`, test assertions, etc.). Verify the entire diff, not just the target file, when using `replaceAll` in test files. **Script extension (2026-08-20):** the same self-reference and missed-insert failure modes apply to any string-based bulk replacement (python/sed scripts, not just editor `replaceAll`) — a python replace of `'Comp 1'` mangled the `const COMPONENT_NAME = 'Comp 1';` definition into `= COMPONENT_NAME;`, and a follow-up insert silently missed because it anchored on the mangled line; verify the definition line and re-check that follow-up inserts matched after any bulk replace.

- **[2026-06-30] [Architecture] Imperative API for Module-Level UI Triggers** — When a module-level utility (e.g., `notifyError`) needs to trigger React UI updates, use an imperative API with a `useEffect` that assigns a module-level function pointer. A Context hook is not usable from module scope. Example: `showToast` in Toast.tsx.

- **[2026-07-08] [React/Testing] Controlled Component State Simulation** — For controlled components, invoking a callback (e.g., `fireEvent.click` on a clear button) only fires the `onChange` callback. The UI only updates when the parent re-renders with the new prop value via `rerender`. Tests must simulate the parent state update to verify UI state changes.

- **[2026-07-19] [React/ESLint] No eslint-disable Directives** — Eslint-disable directives of any form are prohibited. When `jsx-a11y/no-noninteractive-element-interactions` fires on a modal backdrop, use a `<button>` with reset CSS styles instead of `<div>` + eslint-disable. When `onKeyDown` is needed on a `role="dialog"` div, attach the listener via `useEffect` + `addEventListener` on the ref instead of a JSX prop. Permission to add an eslint-disable will not be granted — restructure to comply.

- **[2026-07-21] [Positive] Callback Ref as Lint-Compliant Middle Ground** — When both `useEffect`+`useRef` and `autoFocus` are blocked by lint rules (`no-noninteractive-element-interactions`, `no-autofocus`), use a `useCallback` ref with `node?.focus()` for imperative focus-on-mount paired with a document-level `useEffect` for Escape key handling. The callback ref avoids both the `useRef`+`useEffect` import footprint and the `no-autofocus` rule, while the document-level listener avoids JSX event handlers on non-interactive elements.

#### JVM Stack

- **SpotBugs Heap for Large Projects** — The SpotBugs Maven plugin may run out of memory on projects with 400+ classes and many dependencies. Configure `<maxHeap>4096</maxHeap>` or higher in the plugin configuration to prevent OOM during analysis.

- **[2026-07-05] [Exposed] Domain Operations Require Transaction Context** — Exposed lazy entity properties (e.g., `entity.reducedProductDescription`) can only be accessed within an active transaction. Domain classes that access these properties must be called inside `withTransaction { }` or `transaction { }`.

#### Other

- **Shopify public API has a 25K pagination cap** — The `/collections/.../products.json` endpoint caps any query at `page * limit <= 25000`. This is not rate limiting — the API simply stops returning data. Use sub-collections (by scale, vendor, etc.) to avoid the cap. The error message `{"errors":"Page * Limit exceeds the 25000 limit."}` indicates this cap has been hit.

- **[2026-06-12] [CI/CD] Reusable workflow permissions must be explicit** — Calling workflows that use reusable workflows must explicitly grant any permissions the reusable workflow requests (e.g., `pull-requests: write`). Missing permissions cause validation failures at the `uses:` line. Read GitHub's file/line/column error message to identify the exact permission needed.

- **[2026-06-23] [CI/CD] GitHub Actions Checkout Depth for Merge Commits** — `actions/checkout@v4` with `ref: refs/pull/N/merge` defaults to `fetch-depth: 1`, fetching only the merge commit. Parent SHAs (`base.sha`, `head.sha`) referenced in git operations will fail with exit code 128 unless `fetch-depth: 0` (or `2`) is explicitly set.

- **[2026-08-01] [Coverage] Coverage Thresholds Are Hardcoded, Canonically Measured, and Investigated** — Coverage thresholds must be hardcoded from one canonical measurement command and never auto-ratcheted; when the gate fails, investigate the drop and add tests rather than lowering the threshold. Vitest's `autoUpdate` silently rewrote thresholds, a split config reported different numbers per directory, and a coverage drop from a test change was traced to an uncovered fallback path instead of excusing a threshold edit. One legitimate carve-out: removing dead code (optional parameters, if-guards, unused scenarios) shifts branch/line counts and may justify a threshold adjustment with a commit comment explaining that code was removed, not left untested; if the cause of a drop cannot be determined, ask the user before adjusting. A ratchet must also be validated against the canonical command on the **merged tree**, not the PR branch: PR #218 raised thresholds from a scoped measurement that exceeded what repo-wide `npm run coverage` produced post-merge, leaving main unable to pass its own gate — before attributing a red gate to your change, run the canonical command at clean HEAD and at the pre-merge base to confirm the failure is or is not pre-existing. Thresholds should carry a deliberate buffer below the canonical measurement rather than sitting exactly at it: an exact-at-threshold baseline trips the gate on 0.01 rounding from any legitimate change (adding or removing fully-covered code) and invites per-incident downward reductions — a "thousand cuts" ratchet that erodes the gate by small, individually-plausible steps. Set each threshold once a few tenths below the measured value (e.g. statements 96.0 vs a measured 96.26, functions 94.0 vs 94.27, branch 88.5 vs 88.89, lines 97.0 vs 97.54) and treat only real coverage loss — which moves whole percentage points — as a reason to revisit.

- **[2026-07-31] [Architecture] Zod's Default strip Mode Removes Unknown Keys** — `z.object()` strips unknown keys by default during parsing, so extra properties like `guestId` vanish after validation. If a handler relies on extra properties being present after validation, either include them in the schema or use `.passthrough()` on the object. A union alone is not sufficient when some variants need unvalidated properties.

- **[2026-07-31] [Testing] Throw Outside the Catching Try** — When a `catch` block handles parse failures, do not `throw` from inside the same `try` — the throw is caught by its own `catch`, silently replacing the real error with the generic fallback. Parse into a variable inside the `try`, then throw the parsed detail after the `try` block. A SystemSettings test asserting the JSON error detail exposed that the parsed `details`/`error` field was swallowed and replaced with "Failed: status - text".

