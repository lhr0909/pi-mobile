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
