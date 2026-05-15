# Pi Mobile Client Research

Research options for getting `pi` coding-agent sessions onto mobile while preserving as much of the terminal TUI as possible.

## Executive summary

If full community TUI extension support matters more than a semantic chat UI, the most direct implementation is:

> Run real interactive `pi` sessions on each configured host inside a PTY/tmux, then stream terminal bytes to a mobile terminal view. Add a host daemon for pairing, session launch/resume/fork, keepalive, and notifications.

Everything else is a tradeoff:

- `pi --mode rpc` / SDK UIs are easier to make native-mobile, but they cannot render arbitrary `ctx.ui.custom()` components, custom editors, custom headers/footers, working indicators, themes, or custom TUI renderers.
- A semantic Happy/Remodex-style app is excellent for remote agent UX, configured machines, encryption, notifications, and Git actions, but it reimplements display instead of preserving Pi's TUI.
- An Agentuity-style remote `InteractiveMode` mirror is the best non-PTY prior art, but for a mobile client it still needs upstream Pi changes or private monkey-patching because `InteractiveMode` currently hardcodes `new TUI(new ProcessTerminal())`.

## Relevant Pi constraints

Pi has four useful integration surfaces:

1. **Interactive mode** — the real terminal TUI.
2. **RPC mode** — JSONL commands/events for custom UIs.
3. **SDK** — embedded `AgentSession` / `AgentSessionRuntime`.
4. **Session JSONL files** — persisted session tree under `~/.pi/agent/sessions`.

The important compatibility boundary is extension UI:

- Interactive mode supports arbitrary TUI components and extension display hooks.
- RPC mode only supports a limited extension UI protocol: dialogs, notifications, status, widgets, title, and editor text.
- RPC mode explicitly degrades TUI-specific APIs: `custom()` returns `undefined`; custom footer/header/editor, working indicator, tools-expanded, and theme APIs are no-op or unavailable.
- The `@earendil-works/pi-tui` package has a `Terminal` interface, but `InteractiveMode` currently constructs `ProcessTerminal` directly, so there is no clean injection point for a remote/mobile terminal implementation.

## Architecture options

### Option 1 — PTY terminal relay

**Shape**

- Install a small `pi-mobile-host` daemon on each configured machine.
- Pair the mobile app with hosts using a QR/deep-link flow.
- The daemon launches `pi` in interactive mode inside a PTY, preferably supervised by tmux for persistence.
- The mobile app attaches to the PTY through a WebSocket and renders with a terminal emulator.
- The daemon also lists historical sessions by reading Pi JSONL files and can start/resume/fork with normal Pi CLI flags.

**Why it fits**

- Preserves the exact Pi TUI and ANSI output.
- Preserves arbitrary community TUI extensions because extensions still run inside real interactive Pi.
- Requires no Pi upstream changes.
- Handles mobile session management from configured hosts.

**Tradeoffs**

- The UI is terminal-first, not native semantic mobile UI.
- Needs careful mobile keyboard support for Escape, Ctrl, Alt, Shift+Enter, Alt+Enter, arrow keys, paste, and resize.
- Image paste and advanced terminal features may be limited by mobile terminal support.
- Robust persistence is easier with tmux; raw node-pty alone dies with the daemon.

**Best use**

Use this as the MVP if the core promise is “Pi TUI on mobile.”

### Option 2 — Pure RPC/SDK semantic mobile UI

**Shape**

- Daemon starts `pi --mode rpc` or embeds the SDK.
- Mobile app renders chat, tools, dialogs, files, diffs, branches, and settings semantically.
- Session history comes from Pi RPC/SDK and JSONL files.

**Pros**

- Best native mobile UX.
- Easy to add mobile affordances: push notifications, Git actions, file/diff review, voice, offline queueing.
- Pi RPC already exposes prompt, steer, follow-up, abort, session switch/fork/clone, model/thinking, bash, commands, stats, and streamed events.

**Cons**

- Does not preserve full TUI extension compatibility.
- Must reimplement Pi's display semantics and keep up with upstream.
- Arbitrary `@earendil-works/pi-tui` components cannot run.

**Best use**

Use this if native mobile UX matters more than community TUI extensions.

### Option 3 — Hybrid PTY primary + semantic sidecar

**Shape**

- Keep PTY terminal relay as the authoritative control/display path.
- Add semantic side channels for host/session list, notifications, Git status, file/diff preview, and session metadata.
- Read Pi JSONL files and daemon state for mobile dashboards without interfering with the interactive session.

**Pros**

- Keeps full TUI fidelity where it matters.
- Adds mobile-native convenience around the terminal.
- Lets the app evolve toward semantic surfaces without breaking extension compatibility.

**Cons**

- More moving parts than pure PTY.
- Must avoid double-sending prompts through both PTY and RPC to the same session.

**Best use**

This is the recommended product path after the PTY MVP.

### Option 4 — Remote native `InteractiveMode` mirror

**Shape**

- Run agent execution remotely via RPC/SDK.
- Run a local/native Pi `InteractiveMode` renderer for display.
- Monkey-patch prompt/steer/follow-up/abort to remote commands.
- Mirror remote session events into the local Pi session so `InteractiveMode` renders them.

**Prior art**

`@agentuity/coder-tui` does this for terminal clients. It creates a local `AgentSessionRuntime + InteractiveMode`, patches methods to remote RPC, mirrors remote events, handles hydration/replay/dedup, and lets native Pi TUI render.

**Pros**

- More TUI-faithful than a semantic chat UI.
- Could become a clean architecture if Pi exposes terminal/TUI injection and stable event hydration APIs.

**Cons**

- Current Pi hardcodes `ProcessTerminal`, so a mobile app cannot cleanly supply its own renderer.
- Mirroring all event/state edge cases is complex.
- Still not exact for extensions that depend on local process terminal behavior unless the local renderer can run them.

**Best use**

Consider this as a later upstream collaboration path, not the fastest mobile MVP.

## Existing projects and references

### Pi-specific / community

- **BlackBelt pi-agent-dashboard** — mature mobile-friendly dashboard with a bridge extension, server, React client, PromptBus dialogs, headless/tmux spawning, auth/tunnel options, and xterm.js/node-pty terminal manager. Great operational reference; not full arbitrary TUI preservation.
- **@woxqaq/pi-web** — Pi package launched via `/web`, SDK/WebSocket bridge, detached sessions, headless UI context. Useful web UI reference; TUI-specific APIs are no-op in headless context.
- **@agegr/pi-web** — Next.js/SSE web UI over Pi sessions with browser/fork/branch/model/tools/compaction features. Strong semantic session UI reference.
- **Dwsy/pi-tui-web** — claims full TUI rendering, but uses `pi --mode rpc` and browser-side rendering of RPC events/extension UI. Cannot preserve APIs that RPC itself does not expose.
- **Agentuity coder remote-tui** — best reference for native Pi TUI mirroring over remote execution.
- **Agent of Empires** — multi-agent session manager with Pi.dev support, tmux persistence, web dashboard/PWA, remote phone access via Tailscale/Cloudflare, worktrees, Docker, and diffs. Strong orchestration/PTY reference.

### Adjacent mobile agent systems

- **OpenAI Codex app-server** — strong JSON-RPC protocol reference: threads/turns/items, typed notifications, approvals, sandbox policies, file/process APIs, resume/fork/list, and backpressure.
- **Remodex** — native iOS + Mac bridge for Codex. Useful for local-first bridge design, E2EE pairing, trusted reconnect, daemon service, git/workspace handlers, notifications, and shared thread history.
- **Happy** — open-source mobile/web client for Claude Code and Codex. Useful for configured machines, daemon spawn/resume RPC, encrypted relay, push notifications, offline/reconnect, and local/remote handoff. It is semantic mobile rendering, not a TUI wrapper.

## Recommended direct path

### Phase 1: PTY/tmux MVP

Build the smallest thing that preserves the real Pi TUI:

1. Host daemon
   - Runs on each configured host.
   - Starts and tracks Pi sessions.
   - Uses tmux for process persistence.
   - Attaches to tmux through a PTY for terminal streaming.
2. Mobile client
   - Host list and pairing.
   - Session list grouped by project/cwd.
   - Terminal view with resize and binary input/output streaming.
   - Mobile keyboard accessory row for Pi shortcuts.
3. Session operations
   - New session in cwd.
   - Continue latest session.
   - Resume by session file/id.
   - Fork/clone where Pi CLI supports it.
   - Attach/detach running terminal.
4. Transport/security
   - Start with direct LAN/Tailscale or SSH tunnel if acceptable.
   - Add Remodex/Happy-style relay + E2EE if internet/mobile-network access is required.

### Phase 2: Mobile-native sidecars

Add semantic convenience without replacing the terminal:

- Push notifications for idle/needs-input/completed/error.
- Session cards from JSONL metadata.
- File/diff/Git panels.
- Clipboard and image-attachment helpers.
- Read-only transcript view for quick scanning.
- Optional voice-to-prompt that pastes/submits into the terminal path.

### Phase 3: Upstream-friendly TUI injection

If a native mobile renderer becomes important, propose upstream Pi changes:

- Let `InteractiveMode` accept a `Terminal` or `TUI` factory.
- Stabilize a TUI frame/update protocol or virtual screen abstraction.
- Make extension UI component rendering testable outside `ProcessTerminal`.

That would make an Agentuity-style mirror or custom mobile renderer much less fragile.

## Bottom line

For the stated goal, do not start with a semantic RPC chat app. Start with a PTY/tmux terminal relay managed by a secure host daemon. It is the only direct path that preserves real Pi interactive mode and community TUI extensions today. Then layer semantic mobile features around it instead of replacing it.
