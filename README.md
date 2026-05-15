# Pi Mobile SDK/RPC UI Plan

Research and implementation plan for a mobile-specific client that controls `pi` coding-agent sessions on configured hosts using Pi's semantic session APIs, instead of trying to preserve the terminal TUI.

## Executive summary

Yes: **a mobile-native UI over Pi's semantic session events is easier than a PTY/tmux terminal relay** if the product goal is remote control and good mobile rendering rather than exact TUI fidelity.

The best direct implementation for a TypeScript host is:

> Install a small Node/TypeScript host daemon on each configured machine. The daemon embeds Pi through the SDK (`AgentSessionRuntime` + `AgentSession`), binds a mobile-compatible extension UI context, stores/replays semantic events, and exposes a mobile-oriented WebSocket/HTTP API. The mobile app renders chat, tools, queues, extension dialogs, files, diffs, Git state, model settings, and session history natively.

Keep `pi --mode rpc` subprocesses as a fallback for non-Node hosts, stronger crash isolation, or protocol compatibility testing. Pico uses the subprocess route because its backend is Rust; that is not the simplest path for a TypeScript `pi-mobile-host`.

Keep the old PTY/tmux plan as an optional compatibility path, not the main MVP. PTY/tmux is still the fastest route only when the promise is “the exact Pi terminal TUI, including arbitrary community TUI extensions, on a phone.”

## What changed from the prior plan

The earlier recommendation prioritized full TUI/community-extension fidelity, so it chose PTY/tmux first. Under the revised assumption — native mobile UI is acceptable and arbitrary TUI components can degrade — Pi's semantic session APIs become the better starting point:

- No mobile terminal emulator, terminal resize model, tmux integration, or Pi keybinding accessory row is required for the core experience.
- Pi already exposes semantic SDK/RPC commands and events for prompting, steering, follow-ups, abort, model/thinking controls, session switch/fork/clone, compaction, bash, stats, messages, and slash-command discovery.
- Extension UI has a useful RPC subset: `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, and `setEditorText`/`set_editor_text`.
- The mobile app can optimize for phone UX: push notifications, compact tool cards, file/diff review, image attachments, Git actions, offline/reconnect, and multi-host session lists.

## Non-negotiable Pi semantic/RPC constraints

These are the important boundaries from Pi docs/source. They still shape the mobile protocol even when the host embeds the SDK instead of spawning RPC mode:

1. **Framing is strict JSONL over stdin/stdout only in subprocess RPC mode.** If the host falls back to `pi --mode rpc`, split only on LF (`\n`), strip optional trailing CR, and do not use generic line readers that split on Unicode separators. SDK-hosted sessions avoid this parser entirely for Pi events.
2. **Prompt acceptance is not turn completion.** RPC `prompt` responds when the prompt is accepted/queued/handled. SDK `session.prompt()` resolves after the full run, so an SDK host should expose mobile command acknowledgement from `PromptOptions.preflightResult` and stream completion through events such as `agent_end`, `turn_end`, or error events.
3. **Session replacement requires rebinding.** `new_session`, `switch_session`, `fork`, and `clone` replace the active runtime. Pi RPC rebinds internally; a host using the SDK must re-subscribe and re-bind extensions after replacement.
4. **RPC-style extension UI is not full TUI.** In RPC mode, `ctx.hasUI` is true for the RPC UI subset, but TUI-specific APIs are degraded:
   - `ctx.ui.custom()` returns `undefined`.
   - Working message/visibility/indicator, hidden-thinking label, custom footer/header/editor, autocomplete providers, tool expansion, and theme switching are unavailable or no-op.
   - `getEditorText()` returns `""`; `getToolsExpanded()` returns `false`.
   - Custom tool/message renderers returning `@earendil-works/pi-tui` components cannot be rendered by the mobile UI.
5. **Interactive-only built-ins are not slash commands in RPC.** `get_commands` returns extension commands, prompt templates, and skills; built-in TUI commands such as `/settings` or `/hotkeys` must become native mobile controls or explicit SDK/RPC calls.
6. **Process lifetime tradeoffs move with the host choice.** A subprocess RPC runner exits when its stdin closes, so it needs a keeper/sidecar if daemon restarts must preserve active turns. An SDK-hosted runner removes the stdin problem but ties active turns to the daemon process; persisted JSONL sessions can be resumed after restart, but an in-flight turn is not crash-isolated.

## Recommended architecture

```text
┌──────────────────┐       direct LAN/Tailscale or relay       ┌────────────────────────┐
│  Mobile app      │ ◄───────────────────────────────────────► │  pi-mobile-host       │
│  native UI       │        app-level JSON protocol            │  Node/TS daemon       │
└──────────────────┘                                           └──────────┬─────────────┘
                                                                            │ SDK calls/events
                                                                            ▼
                                                                  ┌──────────────────────┐
                                                                  │ AgentSessionRuntime  │
                                                                  │ AgentSession per run │
                                                                  └──────────┬───────────┘
                                                                             │
                                                                             ▼
                                                                  ~/.pi/agent/sessions

Fallback path for non-Node hosts or isolation:
pi-mobile-host ── strict JSONL ──► pi --mode rpc per active session
```

### 1. Host daemon

Responsibilities:

- Pair the phone with the host and advertise host metadata: hostname, platform, Pi version, home path, available workspaces, and daemon status.
- Start, stop, and track active Pi sessions through `AgentSessionRuntime` in-process.
- List historical sessions by reading Pi's `~/.pi/agent/sessions` through `SessionManager`.
- Maintain an active-session registry keyed by Pi session file/id and host-local runner id.
- Bind extensions with a mobile `ExtensionUIContext` equivalent to the RPC UI subset.
- Store raw Pi events plus derived mobile timeline events with monotonically increasing per-session sequence numbers.
- Replay events to reconnecting mobile clients and serve snapshots when the client is too far behind.
- Provide workspace helpers at the boundary: list files, read files with truncation, render diffs, Git status/branch/commit helpers, and image preview resizing.

Recommended first implementation: **embed Pi with the TypeScript SDK (`AgentSessionRuntime`) in the Node host daemon**. `runRpcMode()` is mostly a JSONL adapter around the same runtime; embedding removes subprocess/framing overhead, keeps type safety and direct state access, and matches Pi's own SDK guidance for same-process TypeScript apps. Keep `pi --mode rpc` as the fallback when the host is not Node/TypeScript, when crash isolation matters more than simplicity, or when testing exact documented RPC wire behavior.

### 2. Session runtime runner

Each active session runner should:

- Create an `AgentSessionRuntime` for the selected cwd and `SessionManager` target (`create`, `open`, `continue`, fork/import flows as needed).
- Subscribe to `runtime.session` events and project them into raw event logs plus mobile timeline updates.
- Bind extensions with a mobile UI context that implements `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, and `setEditorText`/`set_editor_text`.
- Treat `prompt` as fire-and-forget after `preflightResult(true)` so mobile acknowledgement semantics match RPC instead of waiting for `session.prompt()` completion.
- Route `steer`, `followUp`, `abort`, `setModel`, `setThinkingLevel`, compaction, bash, stats, message, and command calls directly to `AgentSession` methods.
- Use `AgentSessionRuntime` for `newSession`, `switchSession`, `fork`, `clone`, and import; after replacement, re-subscribe to the new `runtime.session` and re-bind extensions before emitting the new state.
- Keep a pending map for extension UI requests that require mobile responses.
- Emit session state changes after initialization, queue updates, model/thinking changes, compaction, agent start/end, runtime replacement, and process/daemon lifecycle events.
- Prevent duplicate live runners for the same session file unless explicitly forked/cloned.

For session history, use Pi's persisted JSONL as the source of truth. The daemon's event store is a transport/replay cache, not a replacement for Pi sessions. If the subprocess fallback is used, wrap the runner with strict LF-only JSONL parsing and the same derived event/timeline layer.

### 3. Mobile app protocol

Do not expose raw Pi RPC directly as the whole phone protocol. Wrap it in a host protocol that covers mobile concerns.

Minimum message families:

- `host.list`, `host.status`, `host.pair`, `host.unpair`
- `workspace.list`, `workspace.register`, `workspace.readFile`, `workspace.gitStatus`, `workspace.gitDiff`
- `session.list`, `session.open`, `session.new`, `session.switch`, `session.fork`, `session.clone`, `session.rename`, `session.close`
- `session.command` for Pi semantic commands such as `prompt`, `steer`, `follow_up`, `abort`, `set_model`, `set_thinking_level`, `compact`, `bash`, `get_commands`
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
- `runner.exited` — SDK runner ended, daemon restarted, or fallback RPC process crashed

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

### 5. Recommended mobile app stack

Use **Expo / React Native + TypeScript** for the first iPhone app.

Reasons:

- Pi and the recommended host daemon are TypeScript, so protocol types, event reducers, command builders, validation schemas, and fixtures can be shared across host, app, and tests.
- Pico and Happy both validate this stack for agent companion apps: QR pairing, SecureStore, camera/photo/file attachments, push notifications, streaming lists, markdown/tool rendering, deep links, and web/tablet variants are already natural in Expo.
- It still supports an iPhone-first product: ship an iOS app with EAS, use Expo prebuild/dev-client when native modules are needed, and only add Android/web polish after the iPhone workflow is solid.
- The UI workload is mostly semantic rendering and state synchronization, not low-level platform UI. React Native makes that iteration faster than duplicating Pi protocol models in Swift.

Use **SwiftUI** only if the product is intentionally iOS-only and native platform polish outweighs shared TypeScript/protocol reuse. Remodex proves SwiftUI can deliver a polished iPhone coding-agent client, but it also shows the extra cost: custom Swift models, networking, crypto, history projection, and bridge protocol code that cannot directly share Pi's TypeScript SDK types.

### 6. Extension UI handling

Implement the Pi RPC-style UI subset faithfully, whether it comes from SDK-bound extensions or a fallback RPC process:

| Pi UI request | Mobile rendering |
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

### 7. Transport and security

Start simple, but keep the boundary clean:

- Phase 1 can use direct LAN/Tailscale/SSH tunnel with QR pairing and a per-host token.
- The daemon should bind localhost by default unless explicitly configured for LAN.
- Pairing should pin a host identity and rotate/revoke tokens.
- Validate every file/Git/workspace request at the host boundary; never let the phone send arbitrary filesystem paths without scope checks.
- For internet access or cellular use, add a relay with end-to-end encrypted application payloads. Remodex's QR bootstrap/trusted reconnect/sequence replay design and Happy's user/session/machine socket scopes are the best references.

### 8. Persistence and reconnect

Mobile disconnect must not stop Pi. The host daemon remains the process owner and continues receiving Pi events.

Implement:

- Host-side append-only event log with per-session `seq`.
- Mobile local database keyed by `(hostId, sessionId, seq)`.
- Resume by `eventsSince(lastSeq)` when possible.
- Fallback to `get_messages` and/or session JSONL snapshot when the replay window expired.
- Attention state derived from events: turn completed while not viewing, extension UI waiting, error, or process exited.

Daemon restart survival is a separate hardening topic. In the SDK-first design, a daemon crash kills in-flight work but persisted sessions can be reopened. If the subprocess fallback becomes necessary and active turns must survive daemon restarts, add a keeper process that owns Pi stdin/stdout and exposes a local Unix socket/named pipe so the daemon can reconnect without closing Pi stdin.

## Implementation phases

### Phase 0 — SDK semantic spike

Goal: prove the core loop locally without a terminal UI or subprocess RPC boundary.

- Build a tiny Node/TypeScript host runner that creates `AgentSessionRuntime` in the selected cwd.
- Bind a mobile `ExtensionUIContext` for dialog and fire-and-forget UI requests.
- Use `session.prompt(..., { preflightResult })` to acknowledge prompt acceptance immediately, then render `message_update` text deltas and handle `agent_end`.
- Send `abort`, `steer`, and `followUp` during a run.
- Trigger a demo extension UI request and answer it from a test client.
- Add an optional `pi --mode rpc` subprocess runner behind the same host interface only after the SDK path works.

Exit criteria: local web/test client can prompt, stream, abort, queue, and answer an extension dialog without terminal UI or Pi subprocess framing.

### Phase 1 — Single-host mobile MVP

- Node/TypeScript host daemon with pairing token and direct connection.
- Session list from Pi JSONL via `SessionManager`.
- New/open/resume session in cwd via `AgentSessionRuntime`.
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
- Keeper/sidecar only if the fallback subprocess RPC runner needs stdin survival across daemon restarts.

### Phase 4 — Extension ecosystem and compatibility

- Schema-based mobile GUI extension layer for richer non-TUI UI.
- Extension-declared status panels, forms, tables, and action buttons.
- Optional PTY terminal tab for sessions/extensions that truly need real TUI.
- Upstream proposal for cleaner InteractiveMode terminal/TUI injection if exact mobile TUI mirroring becomes important.

## SDK host vs `pi --mode rpc` subprocess

| Concern | SDK-hosted TypeScript daemon | `pi --mode rpc` subprocess |
|---|---|---|
| Best use case | Node/TypeScript host that wants a typed, direct mobile bridge | Non-Node host, language-neutral integration, crash/process boundary, or exact RPC wire testing |
| Pi integration layer | `AgentSessionRuntime` and `AgentSession` directly | JSONL adapter around the same runtime/session layer |
| Framing/parsing | Host receives typed events in-process | Host must implement strict LF-only JSONL and request/response correlation |
| Prompt acknowledgement | Use `preflightResult(true)` to acknowledge acceptance before `session.prompt()` completes | Built in: `prompt` response is emitted on preflight success |
| Session replacement | Host must re-subscribe and re-bind extensions after runtime replacement | `runRpcMode()` already rebinds internally after new/switch/fork/clone |
| Extension UI | Implement the RPC-style UI subset in a mobile `ExtensionUIContext` | Built-in `extension_ui_request` / `extension_ui_response` plumbing |
| Process isolation | Lower: daemon crash kills in-flight work | Higher: Pi process can be supervised independently |
| Daemon restart survival | Persisted sessions resume; in-flight turn dies with daemon | Requires keeper/sidecar or parent-independent stdin to avoid EOF shutdown |
| Type sharing | Best: share TS protocol/event types across host and app | Weaker: parse untyped JSON records at the boundary |
| Recommended role | **Default for `pi-mobile-host`** | Fallback/compatibility runner |

Bottom line: **embed the Pi SDK first for a TypeScript host daemon; keep `pi --mode rpc` as the subprocess fallback.**

## Semantic mobile UI vs PTY/tmux

| Concern | Semantic mobile UI | PTY/tmux relay |
|---|---|---|
| Native mobile UX | Best | Terminal-first |
| Implementation for chat/tools/files | Easier; semantic events already exist | Must parse/augment terminal or add side channels |
| Keyboard complexity | Low | High: Esc/Ctrl/Alt/arrows/resize/paste |
| Arbitrary TUI extension fidelity | Not supported | Best |
| Custom `ctx.ui.custom()` components | No | Yes, because real TUI runs |
| Session control APIs | Direct SDK/RPC commands | CLI flags and terminal input unless side channel added |
| Mobile notifications/files/Git | Natural side panels | Extra sidecar work |
| Process persistence | Needs daemon discipline | tmux naturally helps |
| Upstream Pi changes required | No for MVP | No for PTY; yes for clean native TUI mirroring |

Bottom line: **choose semantic mobile UI for the app; choose PTY only for exact terminal/TUI compatibility.**

## Key references

- Pi RPC docs/source: `docs/rpc.md`, `dist/modes/rpc/rpc-mode.js`, `jsonl.js`, `rpc-types.d.ts`
- Pi SDK/session docs: `docs/sdk.md`, `docs/sessions.md`, `docs/session-format.md`
- Pi extension docs: `docs/extensions.md`
- Pi web references: `@agegr/pi-web`, `woxQAQ/pi-web`, `BlackBeltTechnology/pi-agent-dashboard`, `Dwsy/pi-tui-web`
- Adjacent mobile systems: Pico, OpenAI `codex app-server`, Remodex, Happy
- Protocol adapters: `pi-acp`, Agentuity remote TUI
