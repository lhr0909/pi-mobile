import { describe, expect, it } from "vitest";
import { createTimelineProjectionState, projectPiEvent, applyEventToSessionState } from "../src/timeline.js";
import type { SessionState } from "../src/protocol.js";

const baseSession: SessionState = {
  id: "s1",
  cwd: "/tmp/project",
  title: "Project",
  runState: "idle",
  messageCount: 0,
  pendingMessageCount: 0,
  updatedAt: "2026-05-15T00:00:00.000Z",
};

describe("timeline projection", () => {
  it("turns assistant text deltas into a timeline item plus deltas", () => {
    const state = createTimelineProjectionState();

    const first = projectPiEvent(state, {
      sessionId: "s1",
      seq: 1,
      now: new Date("2026-05-15T00:00:00.000Z"),
      event: {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello" },
      },
    });
    const second = projectPiEvent(state, {
      sessionId: "s1",
      seq: 2,
      event: {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " world" },
      },
    });

    expect(first).toEqual([
      {
        type: "timeline_item",
        sessionId: "s1",
        seq: 1,
        item: {
          id: "assistant-1",
          kind: "assistant",
          text: "",
          createdAt: "2026-05-15T00:00:00.000Z",
        },
      },
      { type: "timeline_delta", sessionId: "s1", seq: 1, itemId: "assistant-1", delta: "Hello" },
    ]);
    expect(second).toEqual([
      { type: "timeline_delta", sessionId: "s1", seq: 2, itemId: "assistant-1", delta: " world" },
    ]);
  });

  it("turns thinking deltas into italic thinking timeline items", () => {
    const state = createTimelineProjectionState();

    const events = projectPiEvent(state, {
      sessionId: "s1",
      seq: 3,
      now: new Date("2026-05-15T00:00:03.000Z"),
      event: {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Considering options" },
      },
    });

    expect(events).toEqual([
      {
        type: "timeline_item",
        sessionId: "s1",
        seq: 3,
        item: {
          id: "thinking-1",
          kind: "thinking",
          text: "",
          createdAt: "2026-05-15T00:00:03.000Z",
        },
      },
      { type: "timeline_delta", sessionId: "s1", seq: 3, itemId: "thinking-1", delta: "Considering options" },
    ]);
  });

  it("starts a new thinking block when a new assistant message begins", () => {
    const state = createTimelineProjectionState();

    const firstThinking = projectPiEvent(state, {
      sessionId: "s1",
      seq: 1,
      event: {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Before tool" },
      },
    });
    const tool = projectPiEvent(state, {
      sessionId: "s1",
      seq: 2,
      event: {
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "README.md" },
      },
    });
    const messageStart = projectPiEvent(state, {
      sessionId: "s1",
      seq: 3,
      event: { type: "message_start", message: { role: "assistant", content: [] } },
    });
    const secondThinking = projectPiEvent(state, {
      sessionId: "s1",
      seq: 4,
      event: {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "After tool" },
      },
    });

    expect(firstThinking[0]).toMatchObject({ type: "timeline_item", item: { id: "thinking-1", kind: "thinking" } });
    expect(tool).toEqual([
      {
        type: "timeline_item",
        sessionId: "s1",
        seq: 2,
        item: {
          id: "tool-1",
          kind: "tool",
          title: "read",
          status: "running",
          args: { path: "README.md" },
          createdAt: expect.any(String),
        },
      },
    ]);
    expect(messageStart).toEqual([]);
    expect(secondThinking[0]).toMatchObject({ type: "timeline_item", item: { id: "thinking-2", kind: "thinking" } });
  });

  it("updates tool items with expanded result text", () => {
    const state = createTimelineProjectionState();

    const events = projectPiEvent(state, {
      sessionId: "s1",
      seq: 10,
      now: new Date("2026-05-15T00:00:10.000Z"),
      event: {
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "git status --short" },
        isError: false,
        result: { content: [{ type: "text", text: " M README.md" }], details: {} },
      },
    });

    expect(events).toEqual([
      {
        type: "timeline_item",
        sessionId: "s1",
        seq: 10,
        item: {
          id: "tool-1",
          kind: "tool",
          title: "bash",
          status: "done",
          args: { command: "git status --short" },
          detail: " M README.md",
          createdAt: "2026-05-15T00:00:10.000Z",
        },
      },
    ]);
  });

  it("does not emit timeline status prompts for agent lifecycle", () => {
    const state = createTimelineProjectionState();

    expect(projectPiEvent(state, { sessionId: "s1", seq: 5, event: { type: "agent_start" } })).toEqual([]);
    expect(projectPiEvent(state, { sessionId: "s1", seq: 6, event: { type: "agent_end" } })).toEqual([]);
  });
});

describe("session state projection", () => {
  it("updates run state and queue count from pi events", () => {
    const streaming = applyEventToSessionState(baseSession, { type: "agent_start" });
    expect(streaming.runState).toBe("streaming");

    const queued = applyEventToSessionState(streaming, {
      type: "queue_update",
      steering: ["stop"],
      followUp: ["then test", "then commit"],
    });
    expect(queued.pendingMessageCount).toBe(3);

    const idle = applyEventToSessionState(queued, { type: "agent_end" });
    expect(idle.runState).toBe("idle");
  });
});
