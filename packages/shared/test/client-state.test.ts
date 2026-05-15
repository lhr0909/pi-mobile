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
