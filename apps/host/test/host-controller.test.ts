import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VERSION as PI_CODING_AGENT_VERSION } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { HostController } from "../src/host-controller.js";
import { FakeRuntimeFactory } from "./fakes.js";

describe("HostController", () => {
	it("reports host and Pi coding agent status metadata", () => {
		const controller = new HostController(new FakeRuntimeFactory());

		expect(controller.getStatus()).toMatchObject({
			version: "0.1.0",
			piCodingAgentVersion: PI_CODING_AGENT_VERSION,
			sdkMode: "sdk",
		});
	});

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

	it("lists child directories for the path explorer", async () => {
		const tempDirectory = await fs.mkdtemp(
			path.join(os.tmpdir(), "pi-mobile-directories-"),
		);
		await fs.mkdir(path.join(tempDirectory, "zeta"));
		await fs.mkdir(path.join(tempDirectory, "alpha"));
		await fs.writeFile(
			path.join(tempDirectory, "README.md"),
			"not a directory",
		);

		const controller = new HostController(new FakeRuntimeFactory());

		await expect(controller.listDirectories(tempDirectory)).resolves.toEqual({
			path: tempDirectory,
			parentPath: path.dirname(tempDirectory),
			entries: [
				{ name: "alpha", path: path.join(tempDirectory, "alpha") },
				{ name: "zeta", path: path.join(tempDirectory, "zeta") },
			],
		});
	});

	it("expands tilde session paths before listing stored sessions", async () => {
		const factory = new FakeRuntimeFactory();
		const controller = new HostController(factory);

		await controller.listSessions("~/Documents");

		expect(factory.listedCwds[0]).toBe(path.resolve(os.homedir(), "Documents"));
	});

	it("normalizes relative session paths before using the runtime", async () => {
		const factory = new FakeRuntimeFactory();
		const controller = new HostController(factory);

		await controller.listSessions("relative/project");
		const snapshot = await controller.openSession({
			cwd: "relative/project",
			sessionFile: "sessions/test.jsonl",
		});

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

		expect(
			controller.eventsSince(snapshot.session.id, 0).map((event) => event.type),
		).toContain("raw_event");
		expect(() => controller.snapshot("missing")).toThrow("Session not open");
	});
});
