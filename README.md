# Pi Mobile RPC UI Plan

Research and implementation plan for a mobile-specific client that controls `pi` coding-agent sessions on configured hosts using Pi RPC mode, instead of trying to preserve the terminal TUI.

## Executive summary

Yes: **a mobile-native UI over Pi RPC is easier than a PTY/tmux terminal relay** if the product goal is remote control and good mobile rendering rather than exact TUI fidelity.

The best direct implementation is:

> Install a small host daemon on each configured machine. The daemon starts and supervises `pi --mode rpc` sessions, parses Pi's strict JSONL protocol, stores/replays semantic events, and exposes a mobile-oriented WebSocket/HTTP API. The mobile app renders chat, tools, queues, extension dialogs, files, diffs, Git state, model settings, and session history natively.

Keep the old PTY/tmux plan as an optional compatibility path, not the main MVP. PTY/tmux is still the fastest route only when the promise is “the exact Pi terminal TUI, including arbitrary community TUI extensions, on a phone.”

## What changed from the prior plan

The earlier recommendation prioritized full TUI/community-extension fidelity, so it chose PTY/tmux first. Under the revised assumption — native mobile UI is acceptable and arbitrary TUI components can degrade — RPC becomes the better starting point:

- No mobile terminal emulator, terminal resize model, tmux integration, or Pi keybinding accessory row is required for the core experience.
- Pi already exposes semantic commands and events for prompting, steering, follow-ups, abort, model/thinking controls, session switch/fork/clone, compaction, bash, stats, messages, and slash-command discovery.
- Extension UI has a useful RPC subset: `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, and `setEditorText`/`set_editor_text`.
- The mobile app can optimize for phone UX: push notifications, compact tool cards, file/diff review, image attachments, Git actions, offline/reconnect, and multi-host session lists.

## Non-negotiable Pi RPC constraints

These are the important boundaries from Pi docs/source:

1. **Framing is strict JSONL over stdin/stdout.** Split only on LF (`\n`), strip optional trailing CR, and do not use generic line readers that split on Unicode separators. Pi's `jsonl.js` exists specifically because Node `readline` is not protocol-compliant.
2. **Command responses are not turn completion.** `prompt` responds when the prompt is accepted/queued/handled. The running turn finishes later through normal events such as `agent_end`, `turn_end`, or error events.
3. **Session replacement requires rebinding.** `new_session`, `switch_session`, `fork`, and `clone` replace the active runtime. Pi RPC rebinds internally; a host using the SDK must re-subscribe and re-bind extensions after replacement.
4. **RPC is not full TUI.** In RPC mode, `ctx.hasUI` is true for the RPC UI subset, but TUI-specific APIs are degraded:
   - `ctx.ui.custom()` returns `undefined`.
   - Working message/visibility/indicator, hidden-thinking label, custom footer/header/editor, autocomplete providers, tool expansion, and theme switching are unavailable or no-op.
   - `getEditorText()` returns `""`; `getToolsExpanded()` returns `false`.
   - Custom tool/message renderers returning `@earendil-works/pi-tui` components cannot be rendered by the mobile UI.
5. **Interactive-only built-ins are not slash commands in RPC.** `get_commands` returns extension commands, prompt templates, and skills; built-in TUI commands such as `/settings` or `/hotkeys` must become native mobile controls or explicit RPC calls.
6. **RPC process lifetime depends on stdin.** If the owner of stdin closes, `pi --mode rpc` shuts down. A daemon must keep the pipe alive while sessions run; surviving daemon restarts needs a keeper/sidecar or equivalent later hardening.

## Recommended architecture

```text
┌──────────────────┐       direct LAN/Tailscale or relay       ┌───────────────────────┐
│  Mobile app      │ ◄───────────────────────────────────────► │  pi-mobile-host      │
│  native UI       │        app-level JSON protocol            │  daemon per machine  │
└──────────────────┘                                           └──────────┬────────────┘
                                                                            │ strict JSONL
                                                                            ▼
                                                                     ┌──────────────┐
                                                                     │ pi --mode rpc│
                                                                     │ per session  │
                                                                     └──────────────┘
                                                                            │
                                                                            ▼
                                                                  ~/.pi/agent/sessions
```

### 1. Host daemon

Responsibilities:

- Pair the phone with the host and advertise host metadata: hostname, platform, Pi version, home path, available workspaces, and daemon status.
- Start, stop, and track active Pi RPC sessions.
- List historical sessions by reading Pi's `~/.pi/agent/sessions` through `SessionManager` or a compatible parser.
- Maintain an active-session registry keyed by Pi session file/id and host-local process id.
- Own strict JSONL parsing/writing for `pi --mode rpc`.
- Store raw Pi events plus derived mobile timeline events with monotonically increasing per-session sequence numbers.
- Replay events to reconnecting mobile clients and serve snapshots when the client is too far behind.
- Provide workspace helpers at the boundary: list files, read files with truncation, render diffs, Git status/branch/commit helpers, and image preview resizing.

Recommended first implementation: **spawn `pi --mode rpc` subprocesses** rather than embedding the SDK. It is simpler to isolate, matches documented Pi behavior, and keeps the daemon from depending on in-process AgentSession internals. Revisit SDK embedding later if process overhead or advanced customization becomes a problem.

### 2. Session runner

Each active session runner should:

- Spawn `pi --mode rpc` in the selected cwd.
- Optionally pass CLI session/fork flags when opening an existing session.
- Send commands with request ids and route `type: "response"` records back to callers.
- Treat every non-response record as a Pi event, including `extension_ui_request`.
- Keep a pending map for extension UI requests that require mobile responses.
- Emit session state changes after `get_state`, queue updates, model/thinking changes, compaction, agent start/end, and process exit.
- Prevent duplicate live runners for the same session file unless explicitly forked/cloned.

For session history, use Pi's persisted JSONL as the source of truth. The daemon's event store is a transport/replay cache, not a replacement for Pi sessions.

### 3. Mobile app protocol

Do not expose raw Pi RPC directly as the whole phone protocol. Wrap it in a host protocol that covers mobile concerns.

Minimum message families:

- `host.list`, `host.status`, `host.pair`, `host.unpair`
- `workspace.list`, `workspace.register`, `workspace.readFile`, `workspace.gitStatus`, `workspace.gitDiff`
- `session.list`, `session.open`, `session.new`, `session.switch`, `session.fork`, `session.clone`, `session.rename`, `session.close`
- `session.command` for Pi RPC commands such as `prompt`, `steer`, `follow_up`, `abort`, `set_model`, `set_thinking_level`, `compact`, `bash`, `get_commands`
- `session.eventsSince(seq)` and `session.snapshot` for reconnect
- `extensionUi.respond` for `select`/`confirm`/`input`/`editor`
- `notification.registerDevice` and `notification.test` once push exists

Server-to-mobile events should include:

- `session.updated` — model, thinking level, streaming/compacting flags, queue counts, session name, current cwd, unread/attention state
- `timeline.snapshot` — bounded full timeline for initial render
- `timeline.upsert` / `timeline.delta` — derived message/tool/thinking updates
- `tool.updated` — accumulated output, result, error state, duration
- `queue.updated` — steering/follow-up queue contents
- `extensionUi.request` — mobile dialog or fire-and-forget UI update
- `workspace.changed` / `git.changed` — optional invalidation events
- `process.exited` — Pi RPC runner ended or crashed

Always retain raw Pi event records for debugging and future re-projection.

### 4. Mobile UI surfaces

MVP screens:

- Host list and pairing/reconnect status.
- Workspace/session browser grouped by host and cwd.
- Native transcript view with streaming markdown.
- Tool cards for `read`, `edit`, `write`, `bash`, `grep`, `find`, and extension tools.
- Composer with Send, Steer, Follow-up, Abort, image attach, and command picker.
- Model and thinking controls.
- Extension dialogs: select, confirm, input, editor.
- Session details: name, path, tokens/cost/context usage, current queue, export/share actions.

Next mobile-native surfaces:

- Tree view, branch selection, fork/clone flows.
- File browser and syntax-highlighted file viewer.
- Diff review and Git status/branch/commit/push helpers.
- Push notifications for turn complete, needs input, error, or long-running tool.
- Offline prompt draft and follow-up queueing while disconnected.

### 5. Extension UI handling

Implement the Pi RPC subset faithfully:

| Pi RPC UI request | Mobile rendering |
|---|---|
| `select` | Action sheet / picker, response `{ value }` or cancel |
| `confirm` | Confirmation dialog, response `{ confirmed }` |
| `input` | Single-line prompt, response `{ value }` or cancel |
| `editor` | Multi-line modal editor, response `{ value }` or cancel |
| `notify` | Toast/in-app notification; optionally push if important |
| `setStatus` | Session status chips keyed by extension |
| `setWidget` | Simple text widget above/below composer or in session info |
| `setTitle` | Session title/window title hint |
| `set_editor_text` | Prefill or replace composer text |

Do not pretend arbitrary TUI custom UI works. For extensions that need richer mobile GUI, add a later **mobile GUI extension layer** inspired by dashboard systems: extensions declare schemas/slots/data over `pi.events`, and mobile renders known components with generic fallback.

### 6. Transport and security

Start simple, but keep the boundary clean:

- Phase 1 can use direct LAN/Tailscale/SSH tunnel with QR pairing and a per-host token.
- The daemon should bind localhost by default unless explicitly configured for LAN.
- Pairing should pin a host identity and rotate/revoke tokens.
- Validate every file/Git/workspace request at the host boundary; never let the phone send arbitrary filesystem paths without scope checks.
- For internet access or cellular use, add a relay with end-to-end encrypted application payloads. Remodex's QR bootstrap/trusted reconnect/sequence replay design and Happy's user/session/machine socket scopes are the best references.

### 7. Persistence and reconnect

Mobile disconnect must not stop Pi. The host daemon remains the process owner and continues receiving Pi events.

Implement:

- Host-side append-only event log with per-session `seq`.
- Mobile local database keyed by `(hostId, sessionId, seq)`.
- Resume by `eventsSince(lastSeq)` when possible.
- Fallback to `get_messages` and/or session JSONL snapshot when the replay window expired.
- Attention state derived from events: turn completed while not viewing, extension UI waiting, error, or process exited.

Daemon restart survival is a separate hardening topic. If required, add a keeper process that owns Pi stdin/stdout and exposes a local Unix socket/named pipe so the daemon can reconnect without closing Pi stdin.

## Implementation phases

### Phase 0 — RPC spike

Goal: prove the core loop locally.

- Build a tiny Node host runner that spawns `pi --mode rpc --no-session`.
- Implement strict LF-only JSONL parser/writer.
- Send `prompt`, render `message_update` text deltas, and handle `agent_end`.
- Send `abort`, `steer`, and `follow_up` during a run.
- Trigger a demo extension UI request and answer it from a test client.

Exit criteria: local web/test client can prompt, stream, abort, queue, and answer an extension dialog without terminal UI.

### Phase 1 — Single-host mobile MVP

- Host daemon with pairing token and direct connection.
- Session list from Pi JSONL.
- New/open/resume session in cwd.
- Native transcript rendering from derived timeline events.
- Prompt/steer/follow-up/abort.
- Model/thinking controls, compaction, session name, stats.
- Generic extension dialogs and notifications.
- In-app reconnect with `eventsSince(seq)`.

This is the first useful product if TUI fidelity is not required.

### Phase 2 — Mobile coding workflow

- Workspace registration and file browser.
- File read previews with size limits and syntax highlighting.
- Git status, diff, branch switch/create, commit draft helper.
- Tree view, fork, clone, branch navigation.
- Image attachments and mobile photo picker.
- Push notifications for completion/needs-input/error.
- Better queue UI and offline follow-up drafts.

### Phase 3 — Multi-host and relay

- Configured host list with online/offline presence.
- Optional relay reachable from cellular networks.
- End-to-end encrypted relay payloads.
- Push notification service integration.
- Host daemon service installation (`launchd`/`systemd`) and update flow.
- Keeper/sidecar for Pi RPC stdin survival across daemon restarts.

### Phase 4 — Extension ecosystem and compatibility

- Schema-based mobile GUI extension layer for richer non-TUI UI.
- Extension-declared status panels, forms, tables, and action buttons.
- Optional PTY terminal tab for sessions/extensions that truly need real TUI.
- Upstream proposal for cleaner InteractiveMode terminal/TUI injection if exact mobile TUI mirroring becomes important.

## RPC vs PTY/tmux comparison

| Concern | RPC mobile UI | PTY/tmux relay |
|---|---|---|
| Native mobile UX | Best | Terminal-first |
| Implementation for chat/tools/files | Easier; semantic events already exist | Must parse/augment terminal or add side channels |
| Keyboard complexity | Low | High: Esc/Ctrl/Alt/arrows/resize/paste |
| Arbitrary TUI extension fidelity | Not supported | Best |
| Custom `ctx.ui.custom()` components | No | Yes, because real TUI runs |
| Session control APIs | Direct RPC commands | CLI flags and terminal input unless side channel added |
| Mobile notifications/files/Git | Natural side panels | Extra sidecar work |
| Process persistence | Needs daemon/keeper discipline | tmux naturally helps |
| Upstream Pi changes required | No for MVP | No for PTY; yes for clean native TUI mirroring |

Bottom line: **choose RPC first for a mobile app; choose PTY only for exact TUI compatibility.**

## Key references

- Pi RPC docs/source: `docs/rpc.md`, `dist/modes/rpc/rpc-mode.js`, `jsonl.js`, `rpc-types.d.ts`
- Pi SDK/session docs: `docs/sdk.md`, `docs/sessions.md`, `docs/session-format.md`
- Pi extension docs: `docs/extensions.md`
- Pi web references: `@agegr/pi-web`, `woxQAQ/pi-web`, `BlackBeltTechnology/pi-agent-dashboard`
- Adjacent mobile systems: OpenAI `codex app-server`, Remodex, Happy
- Protocol adapters: `pi-acp`
