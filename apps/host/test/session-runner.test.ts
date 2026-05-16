import { describe, expect, it } from "vitest";
import { SdkSessionRunner } from "../src/session-runner.js";
import { FakeRuntimeFactory } from "./fakes.js";

describe("SdkSessionRunner", () => {
  it("acknowledges prompts on SDK preflight and records streamed assistant text", async () => {
    const factory = new FakeRuntimeFactory();
    const emitted: unknown[] = [];
    const runner = await SdkSessionRunner.open(factory, { cwd: "/tmp/project" }, event => emitted.push(event));

    await runner.prompt("hello");
    expect(factory.created[0]?.prompts[0]?.message).toBe("hello");

    factory.created[0]?.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hi" },
    });

    expect(runner.snapshot().timeline).toEqual([
      expect.objectContaining({ kind: "user", text: "hello" }),
      expect.objectContaining({ id: "assistant-1", kind: "assistant", text: "Hi" }),
    ]);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "timeline_item", item: expect.objectContaining({ kind: "user", text: "hello" }) }),
        expect.objectContaining({ type: "raw_event", sessionId: runner.id }),
        expect.objectContaining({ type: "timeline_delta", delta: "Hi" }),
      ]),
    );
  });

  it("restores timeline from existing SDK messages when opening a stored session", async () => {
    const timestamp = Date.parse("2026-05-15T00:00:00.000Z");
    const factory = new FakeRuntimeFactory({
      messages: [
        { role: "user", content: "What changed?", timestamp },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Checking the diff" },
            { type: "text", text: "I updated the client." },
            { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "git status --short" } },
          ],
          stopReason: "toolUse",
          timestamp: timestamp + 1_000,
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: " M apps/host/src/session-runner.ts" }],
          details: {},
          isError: false,
          timestamp: timestamp + 2_000,
        },
      ],
    });

    const runner = await SdkSessionRunner.open(
      factory,
      { cwd: "/tmp/project", sessionFile: "/tmp/session.jsonl", mode: "open" },
      () => {},
    );

    expect(runner.snapshot().timeline).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "What changed?",
        createdAt: "2026-05-15T00:00:00.000Z",
      }),
      expect.objectContaining({
        kind: "thinking",
        text: "Checking the diff",
        createdAt: "2026-05-15T00:00:01.000Z",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "I updated the client.",
        createdAt: "2026-05-15T00:00:01.000Z",
      }),
      expect.objectContaining({
        kind: "tool",
        title: "bash",
        status: "done",
        args: { command: "git status --short" },
        detail: " M apps/host/src/session-runner.ts",
        createdAt: "2026-05-15T00:00:01.000Z",
      }),
    ]);
  });

  it("keeps one expanded tool item in snapshots after start and end events", async () => {
    const factory = new FakeRuntimeFactory();
    const runner = await SdkSessionRunner.open(factory, { cwd: "/tmp/project" }, () => {});

    factory.created[0]?.emit({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "git status --short" },
    });
    factory.created[0]?.emit({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "git status --short" },
      result: { content: [{ type: "text", text: " M README.md" }], details: {} },
      isError: false,
    });

    expect(runner.snapshot().timeline).toEqual([
      expect.objectContaining({
        id: "tool-1",
        kind: "tool",
        title: "bash",
        status: "done",
        args: { command: "git status --short" },
        detail: " M README.md",
      }),
    ]);
  });

  it("routes extension UI dialog responses back to the waiting SDK context", async () => {
    const factory = new FakeRuntimeFactory();
    const emitted: any[] = [];
    const runner = await SdkSessionRunner.open(factory, { cwd: "/tmp/project" }, event => emitted.push(event));
    const bindings = factory.created[0]?.bindings as any;

    const answerPromise = bindings.uiContext.input("Question", "Type here");
    const requestEvent = emitted.find(event => event.type === "extension_ui_request");

    runner.respondToExtensionUi(requestEvent.request.id, { id: requestEvent.request.id, value: "answer" });

    await expect(answerPromise).resolves.toBe("answer");
    expect(emitted).toEqual(expect.arrayContaining([expect.objectContaining({ type: "extension_ui_cleared" })]));
  });
});
