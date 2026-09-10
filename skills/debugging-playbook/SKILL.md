---
name: debugging-playbook
description: "Debugging discipline relocated from AGENTS.md — proven browser/platform limitations (cross-origin iframes, stale build caches), confirming problem understanding before coding, probe-before-building, serial guessing is not a process. Load when debugging a failure."
---

# Debugging Playbook

Relocated from `AGENTS.md` (branch `refactor/agent-layers`, 2026-09-09). Load when
debugging a failure or investigating unexpected behaviour.

---

### Browser Security & Proven Limitations

**Accept proven limitations** — When browser security or platform restrictions are proven (not assumed), accept the limitation and design around it. Don't spend hours trying to bypass security that cannot be bypassed. If something is impossible, document why and move on.
**Cross-Origin Iframe Rule** — Content in cross-origin iframes cannot be accessed via JavaScript, regardless of cookies or session state. This is a browser security fundamental with no workaround. If the target content is in a cross-origin iframe, either use a visible window (not hidden) or find an alternative (API, proxy, etc.).
**Verify proxy behavior with curl before modifying scraper code** — When debugging proxy-related scraper failures, test the proxy connection directly with `curl -x "http://user:pass@host:port" -k -s -o /dev/null -w "HTTP %{http_code}" "https://target.url"` before writing code changes. A two-second curl test can disprove an hour-long hypothesis.
**Serial guessing is not a process** — Making changes until something works is not engineering. Each attempt should be hypothesis-driven with verification. If an approach fails, analyze why before trying the next variation. **When a configuration parameter does not respond to its documented override mechanism, stop and research the actual implementation (e.g., check plugin source, Mojo `@Parameter` annotations, effective-POM output, or API documentation) before attempting another variation.**

### Confirm Problem Understanding Before Coding

**Define the role of any referenced codebase explicitly** — When describing a toolchain that involves an existing project, state its relationship upfront: "test fixture", "source of truth", "example", or "target for migration". Do not conflate "used for validation" with "is the input format" — they lead to fundamentally different architectures.

**Re-examine the full frame when a core assumption is contradicted** — When the user says "that's not how it works" about a fundamental design premise, do not patch the specific assumption. Re-run the full analysis from the corrected premise. A changed frame changes every conclusion below it.

**State your understanding of the problem in one sentence before making any code change.** Ask the user "Is this correct?" if uncertain. **Before implementing any fix, gather diagnostic data from the running system** — ask what they see, request coordinates, dimensions, parent hierarchy. The user has the actual output visible; do not guess at its behaviour when they can describe it. If the user says "stop guessing and investigate," stop and ask diagnostic questions before writing or changing any code.
**Read runtime output (logs, errors) carefully before proposing fixes.** The answer is often visible in the output — don't guess at what the data looks like when the user has already shown it.
**Do not change scope** — if the user asks about coverage analysis, do not also refactor loaders. Stick to the asked question. Unnecessary scope changes waste time and introduce risk.
**Incomplete-source spatial work** — When generating maps, diagrams, or other spatial output from incomplete or ambiguous source material, first articulate the inferred layout in text and have the user confirm it before producing the final artifact. Treat each correction as a potential full mental-model rebuild, not an isolated patch. A wrong assumption corrected still leaves other assumptions unchecked.

**A regression with unchanged infrastructure points at the newly-exercised path** — When a defect appears but the deployment/configuration is unchanged, the trigger is usually the code path that was newly exercised, not the unchanged infrastructure. The caching decorator was the first caller of the generated `list()` endpoint, surfacing a latent 500 from a corrupt legacy row the GSI queries had never hit.
**A regenerated web app failing to fetch is often a stale browser cache** — In Flutter web (and web apps generally), `ClientException: Failed to fetch` against a healthy, CORS-correct API after a rebuild/redeploy is usually the browser serving a stale build. Verify the API is healthy (curl the exact request, confirm no request reaches the server), then hard-refresh or test in incognito before investigating the backend.
