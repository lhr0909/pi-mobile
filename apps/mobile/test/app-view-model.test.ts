import { describe, expect, it } from "vitest";
import { createInitialAppViewState, reduceAppViewState } from "../src/app-view-model.js";

describe("app view model", () => {
  it("tracks connection state and host events", () => {
    const connecting = reduceAppViewState(createInitialAppViewState("http://localhost:4739"), {
      type: "connecting",
    });
    const connected = reduceAppViewState(connecting, { type: "connected" });
    const withHost = reduceAppViewState(connected, {
      type: "hostEvent",
      event: {
        type: "host_status",
        status: {
          name: "Mac",
          version: "0.1.0",
          platform: "darwin",
          cwd: "/tmp/project",
          pid: 1,
          sdkMode: "sdk",
        },
      },
    });

    expect(withHost.connectionState).toBe("connected");
    expect(withHost.client.connectionMessage).toBe("Mac on darwin");
  });

  it("clears prompt after send", () => {
    const state = reduceAppViewState(createInitialAppViewState("http://localhost:4739"), {
      type: "setPrompt",
      value: "hello",
    });

    expect(reduceAppViewState(state, { type: "clearPrompt" }).prompt).toBe("");
  });
});
