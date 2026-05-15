import { describe, expect, it } from "vitest";
import { createInitialAppViewState, isAbsoluteHostPath, reduceAppViewState } from "../src/app-view-model.js";

const hostStatus = {
  name: "Mac",
  version: "0.1.0",
  platform: "darwin",
  cwd: "/tmp/project",
  pid: 1,
  sdkMode: "sdk" as const,
};

describe("app view model", () => {
  it("tracks connection state and host events", () => {
    const connecting = reduceAppViewState(createInitialAppViewState("http://localhost:4739"), {
      type: "connecting",
    });
    const connected = reduceAppViewState(connecting, { type: "connected", status: hostStatus });

    expect(connected.connectionState).toBe("connected");
    expect(connected.client.connectionMessage).toBe("Mac on darwin");
  });

  it("seeds the workspace path from the host cwd when the current path is not absolute", () => {
    const relative = reduceAppViewState(createInitialAppViewState("http://localhost:4739"), {
      type: "setCwd",
      value: ".",
    });

    expect(reduceAppViewState(relative, { type: "connected", status: hostStatus }).cwd).toBe("/tmp/project");
  });

  it("keeps an explicitly absolute workspace path when connecting", () => {
    const absolute = reduceAppViewState(createInitialAppViewState("http://localhost:4739"), {
      type: "setCwd",
      value: "/tmp/other",
    });

    expect(reduceAppViewState(absolute, { type: "connected", status: hostStatus }).cwd).toBe("/tmp/other");
  });

  it("switches to the session screen after a session opens", () => {
    const connected = reduceAppViewState(createInitialAppViewState("http://localhost:4739"), {
      type: "connected",
      status: hostStatus,
    });

    const withSession = reduceAppViewState(connected, {
      type: "hostEvent",
      event: {
        type: "session_opened",
        snapshot: {
          session: {
            id: "s1",
            cwd: "/tmp/project",
            title: "Project",
            runState: "idle",
            messageCount: 0,
            pendingMessageCount: 0,
            updatedAt: "2026-05-15T00:00:00.000Z",
          },
          timeline: [],
          nextSeq: 1,
        },
      },
    });

    expect(withSession.screen).toBe("session");
    expect(withSession.client.activeSessionId).toBe("s1");
  });

  it("clears prompt after send", () => {
    const state = reduceAppViewState(createInitialAppViewState("http://localhost:4739"), {
      type: "setPrompt",
      value: "hello",
    });

    expect(reduceAppViewState(state, { type: "clearPrompt" }).prompt).toBe("");
  });

  it("identifies host absolute paths", () => {
    expect(isAbsoluteHostPath("/tmp/project")).toBe(true);
    expect(isAbsoluteHostPath("C:\\project")).toBe(true);
    expect(isAbsoluteHostPath("relative/project")).toBe(false);
  });
});
