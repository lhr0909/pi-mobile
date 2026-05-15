import type { OpenSessionRequest, PromptCommand, TextCommand } from "./protocol.js";

export function parseJsonObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Expected a JSON object");
  }
  return input as Record<string, unknown>;
}

export function parseOpenSessionRequest(input: unknown): OpenSessionRequest {
  const body = parseJsonObject(input);
  const cwd = requireString(body, "cwd");
  const sessionFile = optionalString(body, "sessionFile");
  const mode = optionalMode(body.mode);
  return { cwd, ...(sessionFile ? { sessionFile } : {}), ...(mode ? { mode } : {}) };
}

export function parsePromptCommand(input: unknown): PromptCommand {
  const body = parseJsonObject(input);
  const message = requireString(body, "message");
  const streamingBehavior = optionalStreamingBehavior(body.streamingBehavior);
  return { message, ...(streamingBehavior ? { streamingBehavior } : {}) };
}

export function parseTextCommand(input: unknown): TextCommand {
  const body = parseJsonObject(input);
  return { message: requireString(body, "message") };
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected non-empty string field: ${key}`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected string field: ${key}`);
  }
  return value.trim() === "" ? undefined : value;
}

function optionalMode(value: unknown): OpenSessionRequest["mode"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "new" || value === "open" || value === "continue") {
    return value;
  }
  throw new Error("Expected mode to be new, open, or continue");
}

function optionalStreamingBehavior(value: unknown): PromptCommand["streamingBehavior"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "steer" || value === "followUp") {
    return value;
  }
  throw new Error("Expected streamingBehavior to be steer or followUp");
}
