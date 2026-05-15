import path from "node:path";
import { describe, expect, it } from "vitest";
import { HostController } from "../src/host-controller.js";
import { FakeRuntimeFactory } from "./fakes.js";

describe("HostController", () => {
  it("lists stored sessions and delegates open runner commands", async () => {
    const factory = new FakeRuntimeFactory();
    const controller = new HostController(factory);

    await expect(controller.listSessions("/tmp/project")).resolves.toEqual([
      expect.objectContaining({ id: "stored-1", cwd: "/tmp/project" }),
    ]);

    const snapshot = await controller.openSession({ cwd: "/tmp/project" });
    await controller.steer(snapshot.session.id, { message: "change course" });
    await controller.followUp(snapshot.session.id, { message: "then test" });
    await controller.abort(snapshot.session.id);

    expect(factory.created[0]?.steers).toEqual(["change course"]);
    expect(factory.created[0]?.followUps).toEqual(["then test"]);
    expect(factory.created[0]?.abortCount).toBe(1);
  });

  it("normalizes relative session paths before using the runtime", async () => {
    const factory = new FakeRuntimeFactory();
    const controller = new HostController(factory);

    await controller.listSessions("relative/project");
    const snapshot = await controller.openSession({ cwd: "relative/project", sessionFile: "sessions/test.jsonl" });

    expect(factory.listedCwds[0]).toBe(path.resolve("relative/project"));
    expect(factory.runtimeRequests[0]).toEqual({
      cwd: path.resolve("relative/project"),
      sessionFile: path.resolve("sessions/test.jsonl"),
    });
    expect(snapshot.session.cwd).toBe(path.resolve("relative/project"));
  });

  it("replays runner events by sequence", async () => {
    const factory = new FakeRuntimeFactory();
    const controller = new HostController(factory);
    const snapshot = await controller.openSession({ cwd: "/tmp/project" });

    factory.created[0]?.emit({ type: "agent_start" });

    expect(controller.eventsSince(snapshot.session.id, 0).map(event => event.type)).toContain("raw_event");
    expect(() => controller.snapshot("missing")).toThrow("Session not open");
  });
});
