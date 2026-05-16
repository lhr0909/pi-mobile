import type { JsonObject, JsonValue, TimelineItem, ToolItem } from "@pi-mobile/shared";

export function restoreTimelineFromMessages(messages: readonly unknown[]): TimelineItem[] {
  const builder = new MessageTimelineBuilder();
  messages.forEach((message, index) => builder.addMessage(message, index));
  return builder.timeline;
}

class MessageTimelineBuilder {
  private readonly items: TimelineItem[] = [];
  private readonly toolItemIdsByCallId = new Map<string, string>();

  get timeline(): TimelineItem[] {
    return [...this.items];
  }

  addMessage(message: unknown, index: number): void {
    if (!isObject(message)) {
      return;
    }

    const role = asString(message.role);
    const createdAt = createdAtFromTimestamp(message.timestamp);
    switch (role) {
      case "user":
        this.addUserMessage(message, index, createdAt);
        break;
      case "assistant":
        this.addAssistantMessage(message, index, createdAt);
        break;
      case "toolResult":
        this.applyToolResult(message, index, createdAt);
        break;
    }
  }

  private addUserMessage(message: JsonObject, index: number, createdAt: string): void {
    const text = textFromContent(message.content);
    if (!text) {
      return;
    }

    this.items.push({
      id: `history-user-${index}`,
      kind: "user",
      text,
      createdAt,
    });
  }

  private addAssistantMessage(message: JsonObject, messageIndex: number, createdAt: string): void {
    if (!Array.isArray(message.content)) {
      return;
    }

    for (const [contentIndex, content] of message.content.entries()) {
      if (!isObject(content)) {
        continue;
      }

      this.addAssistantContent(message, content, messageIndex, contentIndex, createdAt);
    }
  }

  private addAssistantContent(
    message: JsonObject,
    content: JsonObject,
    messageIndex: number,
    contentIndex: number,
    createdAt: string,
  ): void {
    switch (content.type) {
      case "thinking":
        this.addTextItem("thinking", `history-thinking-${messageIndex}-${contentIndex}`, content.thinking, createdAt);
        break;
      case "text":
        this.addTextItem("assistant", `history-assistant-${messageIndex}-${contentIndex}`, content.text, createdAt);
        break;
      case "toolCall":
        this.addToolCall(message, content, messageIndex, contentIndex, createdAt);
        break;
    }
  }

  private addTextItem(
    kind: "assistant" | "thinking",
    id: string,
    textValue: unknown,
    createdAt: string,
  ): void {
    const text = asString(textValue);
    if (!text) {
      return;
    }

    this.items.push({ id, kind, text, createdAt });
  }

  private addToolCall(
    message: JsonObject,
    content: JsonObject,
    messageIndex: number,
    contentIndex: number,
    createdAt: string,
  ): void {
    const id = `history-tool-${messageIndex}-${contentIndex}`;
    const toolCallId = asString(content.id);
    if (toolCallId) {
      this.toolItemIdsByCallId.set(toolCallId, id);
    }

    this.items.push(
      createToolItem({
        id,
        title: asString(content.name) ?? "tool",
        status: assistantToolStatus(message),
        createdAt,
        args: jsonValue(content.arguments),
        detail: assistantToolDetail(message),
      }),
    );
  }

  private applyToolResult(message: JsonObject, messageIndex: number, createdAt: string): void {
    const toolCallId = asString(message.toolCallId);
    const existingItemId = toolCallId ? this.toolItemIdsByCallId.get(toolCallId) : undefined;
    const status = message.isError === true ? "error" : "done";
    const detail = toolResultDetail(message);

    if (existingItemId) {
      this.updateToolItem(existingItemId, status, detail);
      return;
    }

    this.items.push(
      createToolItem({
        id: `history-tool-result-${messageIndex}`,
        title: asString(message.toolName) ?? "tool",
        status,
        createdAt,
        detail,
      }),
    );
  }

  private updateToolItem(id: string, status: ToolItem["status"], detail: string | undefined): void {
    const index = this.items.findIndex(item => item.id === id);
    const item = this.items[index];
    if (!item || item.kind !== "tool") {
      return;
    }

    this.items[index] = {
      ...item,
      status,
      ...(detail ? { detail } : {}),
    };
  }
}

interface ToolItemInput {
  id: string;
  title: string;
  status: ToolItem["status"];
  createdAt: string;
  args?: JsonValue | undefined;
  detail?: string | undefined;
}

function createToolItem(input: ToolItemInput): ToolItem {
  return {
    id: input.id,
    kind: "tool",
    title: input.title,
    status: input.status,
    createdAt: input.createdAt,
    ...(input.args === undefined ? {} : { args: input.args }),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

function assistantToolStatus(message: JsonObject): ToolItem["status"] {
  return message.stopReason === "error" || message.stopReason === "aborted" ? "error" : "running";
}

function assistantToolDetail(message: JsonObject): string | undefined {
  if (message.stopReason === "aborted") {
    return "Operation aborted";
  }
  if (message.stopReason === "error") {
    return asString(message.errorMessage) ?? "Error";
  }
  return undefined;
}

function toolResultDetail(message: JsonObject): string | undefined {
  return textFromContent(message.content) ?? detailText(jsonValue(message.details));
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() ? content : undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content.flatMap(contentPartText).join("\n");
  return text.trim() ? text : undefined;
}

function contentPartText(part: unknown): string[] {
  if (!isObject(part)) {
    return [];
  }

  if (part.type === "text") {
    const text = asString(part.text);
    return text ? [text] : [];
  }

  if (part.type === "image") {
    return [`[image: ${asString(part.mimeType) ?? "image"}]`];
  }

  return [];
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

function jsonValue(value: unknown): JsonValue | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as JsonValue);
}

function createdAtFromTimestamp(timestamp: unknown): string {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  if (typeof timestamp === "string") {
    const parsedTimestamp = Date.parse(timestamp);
    if (Number.isFinite(parsedTimestamp)) {
      return new Date(parsedTimestamp).toISOString();
    }
  }
  return new Date().toISOString();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
