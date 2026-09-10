# Local Setup — OpenCode Server, Local Models, Machine Notes

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

### Local models (llama.cpp)
- Runtime: Homebrew **llama.cpp 0.4.0** (ARM prefix `/opt/homebrew`), ggml 0.23.0.
  Backends (incl. Metal) load as `.so` plugins from ggml's `libexec/` at runtime —
  so `otool -L` will NOT show Metal even though it is active. Confirm with `-lv 5` and look
  for `ggml_metal_library_compile_pipeline` lines.
- MiniCPM5-2B (Q8_0, ~2.7GB) at `~/models/minicpm5-2b/MiniCPM5-2B-Q8_0.gguf`. Serve:
  `llama-server -m ~/models/minicpm5-2b/MiniCPM5-2B-Q8_0.gguf --port 1234 -c 65536 --parallel 1 -ngl 99`
  (`--parallel 1` matters: the default is 4 slots, which splits the context into 4×16k.)
- Provider in `~/.config/opencode/opencode.json`: `minicpm5` → `http://localhost:1234/v1`.
  A dormant `local-model` provider also points at :1234.
- LM Studio is **no longer installed**; `~/.lmstudio` does not exist.
- Qwen3.5-9B template-patch backup lives at `~/models/qwen3.5-9b/` (see the incident entries
  on the strict system-message template check).
- Guidance: OpenCode's global rules file makes requests ~30k tokens; any local model must be
  served with `-c 65536` or larger or it will reject the request outright.

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

