# Local Setup — OpenCode Server, Machine Notes

Relocated and corrected from `AGENTS.md` (branch `refactor/agent-layers`, 2026-09-09).
This is a human-facing machine document, not agent instructions.

## Current state (verified 2026-09-09)

### OpenCode server for Obsidian (port 14096)
- Managed by the **OpenCodeServer login item**, not launchd:
  `~/Applications/OpenCodeServer.app` — a shell script that execs
  `opencode serve --port 14096 --cors app://obsidian.md`.
- The old launchd plist (`~/Library/LaunchAgents/com.opencode.server.plist`) was
  **deleted** — it crash-looped against the login item's port and could not read the Keychain.
- Why a login item: Obsidian is a GUI app and does not inherit `.zshrc` environment
  variables, and the app-bundle approach sidesteps TCC/iCloud access issues.
- **API keys are single-sourced from the macOS Keychain** — service `opencode-server`,
  accounts `deepseek` and `mimo`. Both `~/.zshrc` and the login-item script read them via
  `security find-generic-password -s opencode-server -a <account> -w`. Rotate with:
  `security add-generic-password -s opencode-server -a deepseek -w '<new>' -U`
- The Obsidian plugin's **autoStart must stay disabled in all three vaults** — otherwise it
  spawns a second server on the same port without the Keychain-injected keys.
- Restart: kill the opencode PID listening on 14096, then `open ~/Applications/OpenCodeServer.app`.
- Verify the running process actually has the key:
  `ps eww -p $(pgrep -f "opencode.*14096" | head -1) | tr ' ' '\n' | grep DEEPSEEK`

### Local models — ABANDONED (decision, 2026-10-05)
- **Decision:** local inference is abandoned on this machine. User's words: "Local does not
  work on this machine, I have given up."
- **Consequence — do not do this again:** do not propose, configure, benchmark, or
  troubleshoot a local model provider. Use a hosted model instead; the cheap hosted options
  are materially better than anything that ran locally.
- **Removed 2026-10-05:** the `qwen36` and `local-model` provider blocks in
  `~/.config/opencode/opencode.json` (both pointed at `http://localhost:1234/v1`).
- **Left in place, unreferenced:** Homebrew `llama.cpp` (`/opt/homebrew`), the GGUF files
  under `~/models/` (`qwen3.6-35b-a3b`, `minicpm5-2b`, `qwen3.5-9b`), and
  `~/models/qwen3.6-35b-a3b/serve.sh`. Nothing in the config points at them any more.
- **Why it failed (for the record):** OpenCode's global rules file makes every request
  ~30k tokens, so a local model needs `-c 65536` or it rejects the request outright; on a
  32GB M1 Pro that context is wired memory and cannot page, which left no headroom.
  Measured decode was also unusably slow at long context.

### Hermes — what actually gates a command (verified 2026-10-05)

Context: on 2026-10-05 an agent session ran `uv pip install` into the Hermes venv without
asking. The rule that covers it ("System changes need permission") was scoped to OpenCode
sessions and had no enforcement in Hermes, so this records what Hermes can actually enforce.

- **`approvals.mode` (manual/smart/off) does NOT gate package installs.** An approval prompt
  only happens for commands matching the ~107 patterns in `tools/approval_detection.py`
  (`rm -rf`, pipe-remote-to-shell, …). `tools/approval.py` returns early on anything
  unflagged — `if not is_dangerous: return _approved()` — so `pip install`, `brew install`
  and `npm install` were auto-approved with no prompt in **every** mode, including manual.
  Adding `approvals.smart_policy` text would not help either: the smart reviewer only ever
  sees already-flagged commands. **There is no native "ask before this command" gate for
  unflagged commands.**
- **The only unconditional, user-editable lever is `approvals.deny`**
  (`tools/approval_floors.py`): a list of fnmatch globs, case-insensitive, matched against
  the same normalised/deobfuscated command variants the danger detector uses, and it fires
  *before* yolo / `mode: off`. Semantics are **BLOCK, not ask** — it can never be approved
  through the agent.
- **Set 2026-10-05** so Hermes cannot change the environment without the user doing it:
  globs for `brew install|upgrade|uninstall`, `pip|pip3 install`,
  `uv pip|tool|python install`, `npm install`, `npm i -g`, `yarn global add`,
  `pnpm add -g`, `gem|cargo|go install`, and the apt/dnf/pacman/apk forms.
  Scope: the Hermes terminal tool only — OpenCode sessions are unaffected.
  Inspect with `hermes config get approvals.deny`; lift or narrow with
  `hermes config set approvals.deny '[...]'`.
- **Expected consequence:** a legitimate project-local install now fails with
  "BLOCKED: this command matches the user-defined deny rule …". The user runs it themselves,
  or the pattern is narrowed. That trade is intended — under-blocking is what failed.
- **Verified the gate fires** (both paths): `echo "pip install nothing-here"` and the
  compound `cd /tmp && echo "uv pip install probe"` both BLOCK; `echo gate-control-ok` runs.
  Probes that are harmless if the gate *doesn't* fire are deliberate — never probe a
  deny rule with a command that would actually install something.
- **Not yet filed upstream:** user-configurable *require-approval* globs (the ask-counterpart
  of `approvals.deny`) would replace the blunt block. `approvals.deny` is the workaround.

### Hermes — web search backend health check (2026-10-05)

For 13 days the configured search backend was missing from the runtime venv. Every
`web_search` call failed, was silently served by the keyless rescue ring, and returned an
empty list that read as "no results" — see the search-rescue response issue filed upstream
(`NousResearch/hermes-agent#133473`) and the root cause (`#125556`).

- Script: `~/.hermes/scripts/search_backend_health.sh` — asserts `ddgs` imports in the
  runtime venv and that a live control query returns ≥1 result.
- Cron: **Web search backend health check** (`bccf672a2731`), daily 08:00, `no_agent`,
  delivers to WhatsApp. Watchdog pattern: silent stdout sends nothing, so it speaks only
  when broken.
- Test the alert path without breaking anything:
  `HERMES_HEALTH_PY=/opt/homebrew/bin/python3.11 bash ~/.hermes/scripts/search_backend_health.sh`

---

## Legacy documentation (launchd era — superseded, kept for the diagnosis notes)

The section below is the original AGENTS.md text describing the launchd-based setup. The
launchd agent no longer exists; the API-key-inheritance problem it documents is still the
reason the login-item architecture exists.

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

