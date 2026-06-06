import { describe, expect, it } from "vitest";
import { createMobileClientState, reduceHostEvent } from "../src/client-state.js";
import type { SessionSnapshot } from "../src/protocol.js";

const snapshot: SessionSnapshot = {
  nextSeq: 1,
  timeline: [],
  session: {
    id: "s1",
    cwd: "/tmp/project",
    title: "Project",
    runState: "idle",
    messageCount: 0,
    pendingMessageCount: 0,
    updatedAt: "2026-05-15T00:00:00.000Z",
  },
};

describe("mobile client reducer", () => {
  it("includes the Pi coding agent version in host connection messages", () => {
    const connected = reduceHostEvent(createMobileClientState(), {
      type: "host_status",
      status: {
        name: "Mac",
        version: "0.1.0",
        piCodingAgentVersion: "0.78.1",
        platform: "darwin",
        cwd: "/tmp/project",
        pid: 1,
        sdkMode: "sdk",
      },
    });

    expect(connected.connectionMessage).toBe("Mac on darwin · Pi coding agent v0.78.1");
  });

  it("opens a session and applies assistant deltas", () => {
    const opened = reduceHostEvent(createMobileClientState(), {
      type: "session_opened",
      snapshot,
    });

    const withItem = reduceHostEvent(opened, {
      type: "timeline_item",
      sessionId: "s1",
      seq: 1,
      item: {
        id: "assistant-1",
        kind: "assistant",
        text: "",
        createdAt: "2026-05-15T00:00:00.000Z",
      },
    });

    const withDelta = reduceHostEvent(withItem, {
      type: "timeline_delta",
      sessionId: "s1",
      seq: 2,
      itemId: "assistant-1",
      delta: "Hello",
    });

    expect(withDelta.activeSessionId).toBe("s1");
    expect(withDelta.sessions.s1?.timeline).toEqual([
      {
        id: "assistant-1",
        kind: "assistant",
        text: "Hello",
        createdAt: "2026-05-15T00:00:00.000Z",
      },
    ]);
  });

  it("applies thinking deltas to thinking timeline items", () => {
    const opened = reduceHostEvent(createMobileClientState(), {
      type: "session_opened",
      snapshot,
    });
    const withItem = reduceHostEvent(opened, {
      type: "timeline_item",
      sessionId: "s1",
      seq: 1,
      item: {
        id: "thinking-1",
        kind: "thinking",
        text: "",
        createdAt: "2026-05-15T00:00:00.000Z",
      },
    });

    const withDelta = reduceHostEvent(withItem, {
      type: "timeline_delta",
      sessionId: "s1",
      seq: 2,
      itemId: "thinking-1",
      delta: "Thinking out loud",
    });

    expect(withDelta.sessions.s1?.timeline).toEqual([
      {
        id: "thinking-1",
        kind: "thinking",
        text: "Thinking out loud",
        createdAt: "2026-05-15T00:00:00.000Z",
      },
    ]);
  });

  it("upserts tool item updates without moving their timeline position", () => {
    const opened = reduceHostEvent(createMobileClientState(), {
      type: "session_opened",
      snapshot,
    });
    const withTool = reduceHostEvent(opened, {
      type: "timeline_item",
      sessionId: "s1",
      seq: 1,
      item: {
        id: "tool-1",
        kind: "tool",
        title: "bash",
        status: "running",
        args: { command: "pnpm test" },
        createdAt: "2026-05-15T00:00:00.000Z",
      },
    });
    const withAssistant = reduceHostEvent(withTool, {
      type: "timeline_item",
      sessionId: "s1",
      seq: 2,
      item: {
        id: "assistant-1",
        kind: "assistant",
        text: "Done",
        createdAt: "2026-05-15T00:00:01.000Z",
      },
    });
    const withToolResult = reduceHostEvent(withAssistant, {
      type: "timeline_item",
      sessionId: "s1",
      seq: 3,
      item: {
        id: "tool-1",
        kind: "tool",
        title: "bash",
        status: "done",
        args: { command: "pnpm test" },
        detail: "passed",
        createdAt: "2026-05-15T00:00:02.000Z",
      },
    });

    expect(withToolResult.sessions.s1?.timeline).toEqual([
      {
        id: "tool-1",
        kind: "tool",
        title: "bash",
        status: "done",
        args: { command: "pnpm test" },
        detail: "passed",
        createdAt: "2026-05-15T00:00:02.000Z",
      },
      {
        id: "assistant-1",
        kind: "assistant",
        text: "Done",
        createdAt: "2026-05-15T00:00:01.000Z",
      },
    ]);
  });

  it("updates session state without dropping timeline", () => {
    const opened = reduceHostEvent(createMobileClientState(), { type: "session_opened", snapshot });
    const updated = reduceHostEvent(opened, {
      type: "session_updated",
      session: { ...snapshot.session, runState: "streaming" },
    });

    expect(updated.sessions.s1?.session.runState).toBe("streaming");
    expect(updated.sessions.s1?.timeline).toEqual([]);
  });
});
