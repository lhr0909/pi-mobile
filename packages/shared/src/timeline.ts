import type { HostEvent, JsonObject, JsonValue, SessionState, TimelineItem } from "./protocol.js";

export interface TimelineProjectionState {
  activeAssistantItemId?: string;
  activeThinkingItemId?: string;
  nextSyntheticId: number;
}

export interface ProjectionInput {
  sessionId: string;
  seq: number;
  event: JsonValue;
  now?: Date;
}

export function createTimelineProjectionState(): TimelineProjectionState {
  return { nextSyntheticId: 1 };
}

export function projectPiEvent(
  state: TimelineProjectionState,
  input: ProjectionInput,
): HostEvent[] {
  if (!isObject(input.event)) {
    return [];
  }

  const eventType = asString(input.event.type);
  if (!eventType) {
    return [];
  }

  const createdAt = (input.now ?? new Date()).toISOString();
  switch (eventType) {
    case "agent_start":
      resetActiveMessageItems(state);
      return [timelineItem(input, statusItem(state, "Agent started", "info", createdAt))];
    case "agent_end":
      resetActiveMessageItems(state);
      return [timelineItem(input, statusItem(state, "Agent finished", "success", createdAt))];
    case "message_update":
      return projectMessageUpdate(state, input, input.event, createdAt);
    case "tool_execution_start":
      return [timelineItem(input, toolItem(state, input.event, "running", createdAt))];
    case "tool_execution_end":
      return [timelineItem(input, toolItem(state, input.event, "done", createdAt))];
    default:
      return [];
  }
}

export function applyEventToSessionState(session: SessionState, event: JsonValue): SessionState {
  if (!isObject(event)) {
    return session;
  }

  const eventType = asString(event.type);
  switch (eventType) {
    case "agent_start":
      return { ...session, runState: "streaming", updatedAt: new Date().toISOString() };
    case "agent_end":
      return { ...session, runState: "idle", updatedAt: new Date().toISOString() };
    case "compaction_start":
      return { ...session, runState: "compacting", updatedAt: new Date().toISOString() };
    case "compaction_end":
      return { ...session, runState: "idle", updatedAt: new Date().toISOString() };
    case "queue_update":
      return { ...session, pendingMessageCount: queueCount(event), updatedAt: new Date().toISOString() };
    case "thinking_level_changed": {
      const level = asString(event.level);
      return level ? { ...session, thinkingLevel: level, updatedAt: new Date().toISOString() } : session;
    }
    case "session_info_changed": {
      const name = asString(event.name);
      return { ...session, title: name || session.title, updatedAt: new Date().toISOString() };
    }
    default:
      return session;
  }
}

function projectMessageUpdate(
  state: TimelineProjectionState,
  input: ProjectionInput,
  event: JsonObject,
  createdAt: string,
): HostEvent[] {
  const assistantMessageEvent = isObject(event.assistantMessageEvent)
    ? event.assistantMessageEvent
    : undefined;
  const eventType = asString(assistantMessageEvent?.type);
  const delta = asString(assistantMessageEvent?.delta);
  if (!eventType || !delta) {
    return [];
  }

  if (eventType === "thinking_delta") {
    return projectStreamingText(state, input, {
      activeItemId: state.activeThinkingItemId,
      assignActiveItemId: itemId => {
        state.activeThinkingItemId = itemId;
      },
      createdAt,
      delta,
      kind: "thinking",
      prefix: "thinking",
    });
  }

  if (eventType === "text_delta") {
    return projectStreamingText(state, input, {
      activeItemId: state.activeAssistantItemId,
      assignActiveItemId: itemId => {
        state.activeAssistantItemId = itemId;
      },
      createdAt,
      delta,
      kind: "assistant",
      prefix: "assistant",
    });
  }

  return [];
}

interface StreamingTextProjectionOptions {
  activeItemId: string | undefined;
  assignActiveItemId: (itemId: string) => void;
  createdAt: string;
  delta: string;
  kind: "assistant" | "thinking";
  prefix: string;
}

function projectStreamingText(
  state: TimelineProjectionState,
  input: ProjectionInput,
  options: StreamingTextProjectionOptions,
): HostEvent[] {
  if (!options.activeItemId) {
    const itemId = syntheticId(state, options.prefix);
    options.assignActiveItemId(itemId);
    const item: TimelineItem = {
      id: itemId,
      kind: options.kind,
      text: "",
      createdAt: options.createdAt,
    };
    return [timelineItem(input, item), timelineDelta(input, item.id, options.delta)];
  }

  return [timelineDelta(input, options.activeItemId, options.delta)];
}

function resetActiveMessageItems(state: TimelineProjectionState): void {
  delete state.activeAssistantItemId;
  delete state.activeThinkingItemId;
}

function timelineItem(input: ProjectionInput, item: TimelineItem): HostEvent {
  return { type: "timeline_item", sessionId: input.sessionId, item, seq: input.seq };
}

function timelineDelta(input: ProjectionInput, itemId: string, delta: string): HostEvent {
  return { type: "timeline_delta", sessionId: input.sessionId, itemId, delta, seq: input.seq };
}

function statusItem(
  state: TimelineProjectionState,
  text: string,
  tone: "info" | "success" | "warning" | "error",
  createdAt: string,
): TimelineItem {
  return { id: syntheticId(state, "status"), kind: "status", text, tone, createdAt };
}

function toolItem(
  state: TimelineProjectionState,
  event: JsonObject,
  status: "running" | "done",
  createdAt: string,
): TimelineItem {
  const title = asString(event.toolName) ?? asString(event.name) ?? "tool";
  const detail = asString(event.result) ?? asString(event.error);
  return {
    id: asString(event.toolCallId) ?? syntheticId(state, "tool"),
    kind: "tool",
    title,
    status,
    createdAt,
    ...(detail ? { detail } : {}),
  };
}

function syntheticId(state: TimelineProjectionState, prefix: string): string {
  const id = `${prefix}-${state.nextSyntheticId}`;
  state.nextSyntheticId += 1;
  return id;
}

function queueCount(event: JsonObject): number {
  const steering = Array.isArray(event.steering) ? event.steering.length : 0;
  const followUp = Array.isArray(event.followUp) ? event.followUp.length : 0;
  return steering + followUp;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
