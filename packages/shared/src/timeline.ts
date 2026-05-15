import type { HostEvent, JsonObject, JsonValue, SessionState, TimelineItem } from "./protocol.js";

export interface TimelineProjectionState {
  activeAssistantItemIds: Record<string, string>;
  activeThinkingItemIds: Record<string, string>;
  nextSyntheticId: number;
}

export interface ProjectionInput {
  sessionId: string;
  seq: number;
  event: JsonValue;
  now?: Date;
}

export function createTimelineProjectionState(): TimelineProjectionState {
  return { activeAssistantItemIds: {}, activeThinkingItemIds: {}, nextSyntheticId: 1 };
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
    case "agent_end":
      resetActiveMessageItems(state);
      return [];
    case "message_start":
      if (messageRole(input.event) === "assistant") {
        resetActiveMessageItems(state);
      }
      return [];
    case "message_update":
      return projectMessageUpdate(state, input, input.event, createdAt);
    case "tool_execution_start":
      return [timelineItem(input, toolItem(state, input.event, "running", createdAt))];
    case "tool_execution_update":
      return [timelineItem(input, toolItem(state, input.event, "running", createdAt))];
    case "tool_execution_end":
      return [timelineItem(input, toolItem(state, input.event, toolStatus(input.event), createdAt))];
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
  const contentIndex = asNumber(assistantMessageEvent?.contentIndex);
  if (!eventType || !delta) {
    return [];
  }

  if (eventType === "thinking_delta") {
    return projectStreamingText(state, input, {
      activeItemIds: state.activeThinkingItemIds,
      contentIndex,
      createdAt,
      delta,
      kind: "thinking",
      prefix: "thinking",
    });
  }

  if (eventType === "text_delta") {
    return projectStreamingText(state, input, {
      activeItemIds: state.activeAssistantItemIds,
      contentIndex,
      createdAt,
      delta,
      kind: "assistant",
      prefix: "assistant",
    });
  }

  return [];
}

interface StreamingTextProjectionOptions {
  activeItemIds: Record<string, string>;
  contentIndex: number | undefined;
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
  const key = String(options.contentIndex ?? "default");
  const activeItemId = options.activeItemIds[key];
  if (!activeItemId) {
    const itemId = syntheticId(state, options.prefix);
    options.activeItemIds[key] = itemId;
    const item: TimelineItem = {
      id: itemId,
      kind: options.kind,
      text: "",
      createdAt: options.createdAt,
    };
    return [timelineItem(input, item), timelineDelta(input, item.id, options.delta)];
  }

  return [timelineDelta(input, activeItemId, options.delta)];
}

function resetActiveMessageItems(state: TimelineProjectionState): void {
  state.activeAssistantItemIds = {};
  state.activeThinkingItemIds = {};
}

function timelineItem(input: ProjectionInput, item: TimelineItem): HostEvent {
  return { type: "timeline_item", sessionId: input.sessionId, item, seq: input.seq };
}

function timelineDelta(input: ProjectionInput, itemId: string, delta: string): HostEvent {
  return { type: "timeline_delta", sessionId: input.sessionId, itemId, delta, seq: input.seq };
}

function toolItem(
  state: TimelineProjectionState,
  event: JsonObject,
  status: "running" | "done" | "error",
  createdAt: string,
): TimelineItem {
  const title = asString(event.toolName) ?? asString(event.name) ?? "tool";
  const detail = toolDetail(event);
  return {
    id: asString(event.toolCallId) ?? syntheticId(state, "tool"),
    kind: "tool",
    title,
    status,
    createdAt,
    ...(event.args === undefined ? {} : { args: event.args }),
    ...(detail ? { detail } : {}),
  };
}

function messageRole(event: JsonObject): string | undefined {
  return isObject(event.message) ? asString(event.message.role) : undefined;
}

function toolStatus(event: JsonObject): "done" | "error" {
  return event.isError === true ? "error" : "done";
}

function toolDetail(event: JsonObject): string | undefined {
  const result = isObject(event.result)
    ? event.result
    : isObject(event.partialResult)
      ? event.partialResult
      : undefined;
  const content = textFromToolContent(result?.content);
  if (content) {
    return content;
  }

  const details = detailText(result?.details);
  return details || asString(event.error);
}

function textFromToolContent(content: JsonValue | undefined): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const lines = content.flatMap(entry => {
    if (!isObject(entry)) {
      return [];
    }
    if (entry.type === "text") {
      const text = asString(entry.text);
      return text ? [text] : [];
    }
    if (entry.type === "image") {
      const mimeType = asString(entry.mimeType) ?? "image";
      return [`[image: ${mimeType}]`];
    }
    return [];
  });

  const text = lines.join("\n");
  return text.trim() ? text : undefined;
}

function detailText(details: JsonValue | undefined): string | undefined {
  if (details === undefined || details === null) {
    return undefined;
  }
  if (isObject(details) && Object.keys(details).length === 0) {
    return undefined;
  }
  if (isObject(details) && typeof details.diff === "string") {
    return details.diff;
  }
  if (typeof details === "string") {
    return details;
  }
  return JSON.stringify(details, null, 2);
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

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
