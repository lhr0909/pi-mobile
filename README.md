# Pi Mobile

Pi Mobile is a pnpm-workspace MVP for controlling `pi` coding-agent sessions from an iPhone-first native app. The repository now contains both sides of the prototype:

- `apps/host` — a Node/TypeScript mobile host that embeds Pi through the SDK (`AgentSessionRuntime` + `AgentSession`).
- `apps/mobile` — an Expo / React Native app that connects to a configured host, opens a session, streams timeline updates, and sends prompt/steer/follow-up/abort commands.
- `packages/shared` — shared protocol types, validation helpers, timeline projection, and mobile client reducer logic used by both apps.

The implementation follows the research decision: **SDK-hosted TypeScript daemon first, `pi --mode rpc` only as a future fallback**.

## Current MVP capabilities

### Host daemon

- Embeds `@earendil-works/pi-coding-agent` with `AgentSessionRuntime`.
- Creates, opens, continues, and lists Pi sessions through `SessionManager`.
- Binds a mobile-compatible extension UI context for `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, and `set_editor_text`.
- Projects raw Pi SDK events into mobile timeline updates.
- Exposes HTTP APIs for host status, session list/open/snapshot/events, prompt, steer, follow-up, abort, and extension UI responses.
- Broadcasts live host/session events over WebSocket at `/ws`.
- Supports optional bearer-token auth through `PI_MOBILE_HOST_TOKEN`.

### Mobile app

- Expo / React Native + TypeScript.
- iPhone-first single-screen MVP.
- Connects to a configured host URL and optional token.
- Opens a new Pi session for a workspace cwd.
- Shows live status, tool, and assistant transcript timeline items.
- Sends prompt, steer, follow-up, and abort commands.

## Repository layout

```text
.
├── apps/
│   ├── host/                 # Node/TS SDK host daemon
│   └── mobile/               # Expo React Native app
├── packages/
│   └── shared/               # Shared protocol and reducers
├── package.json              # Root scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── vitest.config.ts
```

## Setup

```bash
pnpm install
```

Pi itself must be configured on the host machine before running real sessions:

```bash
npm install -g @earendil-works/pi-coding-agent
pi
```

## Run the SDK host

```bash
pnpm dev:host
```

Defaults:

- Bind: `127.0.0.1`
- Port: `4739`
- URL: `http://127.0.0.1:4739`

Environment:

```bash
PI_MOBILE_HOST_BIND=0.0.0.0 \
PI_MOBILE_HOST_PORT=4739 \
PI_MOBILE_HOST_TOKEN=dev-secret \
pnpm dev:host
```

If `PI_MOBILE_HOST_TOKEN` is set, HTTP clients must send `Authorization: Bearer <token>` and WebSocket clients may connect with `/ws?token=<token>`.

## Run the mobile app

```bash
pnpm dev:app
```

The app defaults to `http://127.0.0.1:4739`, which works for an iOS simulator talking to a host daemon running on the same Mac. For a physical phone, use a LAN/Tailscale-reachable host URL and set `PI_MOBILE_HOST_BIND=0.0.0.0` on the host.

## Host API sketch

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | unauthenticated health check |
| `GET` | `/api/host/status` | host metadata |
| `GET` | `/api/sessions?cwd=/path` | list stored sessions |
| `POST` | `/api/sessions` | open/create a session with `{ cwd, mode?, sessionFile? }` |
| `GET` | `/api/sessions/:id/snapshot` | current session snapshot |
| `GET` | `/api/sessions/:id/events?since=N` | replay host events after `N` |
| `POST` | `/api/sessions/:id/commands/prompt` | send `{ message, streamingBehavior? }` |
| `POST` | `/api/sessions/:id/commands/steer` | send `{ message }` |
| `POST` | `/api/sessions/:id/commands/follow-up` | send `{ message }` |
| `POST` | `/api/sessions/:id/commands/abort` | abort current turn |
| `POST` | `/api/sessions/:id/extension-ui/:requestId` | answer extension UI |
| WS | `/ws` | live `HostEvent` stream |

## Test and validation commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:coverage
```

The tests cover:

- Shared timeline projection, mobile reducer, and protocol validation.
- SDK host runner behavior with fake SDK sessions.
- Host HTTP/WebSocket API behavior and auth.
- Mobile host-client URL handling and app view-model transitions.

## iOS simulator e2e

The intended e2e loop is:

```bash
agent-device ensure-simulator --platform ios
pnpm dev:host
pnpm --filter @pi-mobile/app start:metro
agent-device open "Expo Go" <expo-url> --platform ios
agent-device snapshot -i --platform ios
```

This depends on local simulator/Expo availability. If Expo Go reports an SDK-version mismatch, uninstall the simulator's old Expo Go and let Expo CLI install the SDK-matched build:

```bash
xcrun simctl uninstall <simulator-udid> host.exp.Exponent
CI=1 pnpm --filter @pi-mobile/app exec expo start --ios --go --localhost --port 8081
```

If the simulator automation runner cannot interact with the app, capture a screenshot with `agent-device screenshot` and use an Expo dev build (`expo run:ios`) for deeper follow-up testing.

## MVP limitations

- No hosted relay yet; use direct LAN, localhost, Tailscale, or an SSH tunnel.
- No persistent mobile host registry or QR pairing yet.
- No push notifications yet.
- Mobile extension UI requests are emitted by the host, but the current app does not yet render response dialogs.
- SDK host process owns active turns; a daemon crash ends in-flight work, while persisted Pi sessions can be reopened.
- `pi --mode rpc` subprocess fallback is not implemented in this MVP.
