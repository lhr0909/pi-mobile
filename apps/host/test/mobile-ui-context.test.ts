import { describe, expect, it } from "vitest";
import { EventLog } from "../src/event-log.js";
import { MobileExtensionUiBridge } from "../src/mobile-ui-context.js";

describe("MobileExtensionUiBridge", () => {
  it("emits fire-and-forget UI requests", () => {
    const events: any[] = [];
    const bridge = new MobileExtensionUiBridge("s1", new EventLog(), event => events.push(event));
    const context = bridge.createContext();

    context.notify("Heads up", "info");
    context.setStatus("mode", "planning");
    context.setWidget("stats", ["1 token"]);
    context.setTitle("Session title");
    context.setEditorText("prefill");

    expect(events.map(event => event.request.method)).toEqual([
      "notify",
      "setStatus",
      "setWidget",
      "setTitle",
      "set_editor_text",
    ]);
  });

  it("resolves select and confirm dialogs from mobile responses", async () => {
    const events: any[] = [];
    const bridge = new MobileExtensionUiBridge("s1", new EventLog(), event => events.push(event));
    const context = bridge.createContext();

    const selectPromise = context.select("Pick", ["a", "b"]);
    const selectRequest = events.at(-1).request;
    bridge.respond(selectRequest.id, { id: selectRequest.id, value: "b" });

    const confirmPromise = context.confirm("Confirm", "Continue?");
    const confirmRequest = events.at(-1).request;
    bridge.respond(confirmRequest.id, { id: confirmRequest.id, confirmed: true });

    await expect(selectPromise).resolves.toBe("b");
    await expect(confirmPromise).resolves.toBe(true);
  });

  it("rejects unknown dialog responses", () => {
    const bridge = new MobileExtensionUiBridge("s1", new EventLog(), () => {});

    expect(() => bridge.respond("missing", { id: "missing", cancelled: true })).toThrow("not found");
  });
});
