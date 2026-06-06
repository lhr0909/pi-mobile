export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ConnectionState = "disconnected" | "connecting" | "connected";
export type SessionRunState = "idle" | "streaming" | "compacting" | "exited";
export type ExtensionUiMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "set_editor_text";

export interface HostStatus {
  name: string;
  version: string;
  piCodingAgentVersion: string;
  platform: string;
  cwd: string;
  pid: number;
  sdkMode: "sdk";
}

export interface SessionSummary {
  id: string;
  cwd: string;
  title: string;
  sessionFile?: string;
  runState: SessionRunState;
  messageCount: number;
  updatedAt: string;
}

export interface SessionState extends SessionSummary {
  model?: JsonValue;
  thinkingLevel?: string;
  pendingMessageCount: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryList {
  path: string;
  parentPath?: string;
  entries: DirectoryEntry[];
}

export interface TranscriptItem {
  id: string;
  kind: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface ThinkingItem {
  id: string;
  kind: "thinking";
  text: string;
  createdAt: string;
}

export interface ToolItem {
  id: string;
  kind: "tool";
  title: string;
  status: "running" | "done" | "error";
  args?: JsonValue;
  detail?: string;
  createdAt: string;
}

export interface StatusItem {
  id: string;
  kind: "status";
  text: string;
  tone: "info" | "success" | "warning" | "error";
  createdAt: string;
}

export type TimelineItem = TranscriptItem | ThinkingItem | ToolItem | StatusItem;

export interface SessionSnapshot {
  session: SessionState;
  timeline: TimelineItem[];
  nextSeq: number;
}

export interface ExtensionUiRequest {
  id: string;
  sessionId: string;
  method: ExtensionUiMethod;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: string;
  text?: string;
  notifyType?: string;
}

export type ExtensionUiResponse =
  | { id: string; value?: string; cancelled?: boolean }
  | { id: string; confirmed?: boolean; cancelled?: boolean };

export type HostEvent =
  | { type: "host_status"; status: HostStatus }
  | { type: "session_opened"; snapshot: SessionSnapshot }
  | { type: "session_updated"; session: SessionState; seq?: number }
  | { type: "timeline_item"; sessionId: string; item: TimelineItem; seq: number }
  | { type: "timeline_delta"; sessionId: string; itemId: string; delta: string; seq: number }
  | { type: "raw_event"; sessionId: string; event: JsonValue; seq: number }
  | { type: "extension_ui_request"; request: ExtensionUiRequest; seq: number }
  | { type: "extension_ui_cleared"; sessionId: string; requestId: string; seq: number }
  | { type: "command_error"; sessionId?: string; command: string; message: string; seq?: number };

export interface PromptCommand {
  message: string;
  streamingBehavior?: "steer" | "followUp";
}

export interface TextCommand {
  message: string;
}

export interface OpenSessionRequest {
  cwd: string;
  sessionFile?: string;
  mode?: "new" | "open" | "continue";
}

export interface ApiErrorBody {
  error: string;
}
