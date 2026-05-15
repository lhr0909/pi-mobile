import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { HostController } from "../src/host-controller.js";
import { MobileHostServer } from "../src/server/mobile-host-server.js";
import { FakeRuntimeFactory } from "./fakes.js";

async function startServer(options: { token?: string; corsOrigin?: string } = {}) {
  const factory = new FakeRuntimeFactory();
  const controller = new HostController(factory);
  const server = new MobileHostServer(controller, options);
  await server.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, controller, factory, server };
}

describe("MobileHostServer", () => {
  it("opens a session and accepts prompt commands", async () => {
    const { baseUrl, factory, server } = await startServer();
    try {
      const openResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ cwd: "/tmp/project" }),
      });
      expect(openResponse.status).toBe(201);
      const snapshot = await openResponse.json() as any;

      const promptResponse = await fetch(`${baseUrl}/api/sessions/${snapshot.session.id}/commands/prompt`, {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });

      expect(promptResponse.status).toBe(202);
      expect(factory.created[0]?.prompts[0]?.message).toBe("hello");
    } finally {
      await server.close();
    }
  });

  it("requires bearer auth when a token is configured", async () => {
    const { baseUrl, server } = await startServer({ token: "secret" });
    try {
      const denied = await fetch(`${baseUrl}/api/host/status`);
      expect(denied.status).toBe(401);

      const allowed = await fetch(`${baseUrl}/api/host/status`, {
        headers: { authorization: "Bearer secret" },
      });
      expect(allowed.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("handles CORS preflight when a CORS origin is configured", async () => {
    const { baseUrl, server } = await startServer({ corsOrigin: "http://localhost:8081" });
    try {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:8081", "access-control-request-method": "POST" },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:8081");
      expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
    } finally {
      await server.close();
    }
  });

  it("broadcasts opened sessions over websocket", async () => {
    const { baseUrl, server } = await startServer();
    const wsUrl = baseUrl.replace("http://", "ws://") + "/ws";
    const socket = new WebSocket(wsUrl);
    const messages: any[] = [];
    socket.on("message", data => messages.push(JSON.parse(String(data))));

    try {
      await new Promise<void>(resolve => socket.once("open", () => resolve()));
      await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ cwd: "/tmp/project" }),
      });
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: "host_status" })]));
      expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: "session_opened" })]));
    } finally {
      socket.close();
      await server.close();
    }
  });
});
