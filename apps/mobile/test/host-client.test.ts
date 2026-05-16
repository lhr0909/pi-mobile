import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HostClient,
  normalizeBaseUrl,
  toWebSocketUrl,
} from "../src/host-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("host client URL helpers", () => {
  it("normalizes base URLs", () => {
    expect(normalizeBaseUrl(" http://localhost:4739/ ")).toBe(
      "http://localhost:4739",
    );
  });

  it("builds websocket URLs with optional token", () => {
    expect(toWebSocketUrl("http://example.test:4739", "secret token")).toBe(
      "ws://example.test:4739/ws?token=secret%20token",
    );
    expect(toWebSocketUrl("https://example.test")).toBe(
      "wss://example.test/ws",
    );
  });
});

describe("HostClient", () => {
  it("sends bearer auth and parses host status", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            name: "Mac",
            version: "0.1.0",
            platform: "darwin",
            cwd: "/tmp",
            pid: 1,
            sdkMode: "sdk",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const client = new HostClient({
      baseUrl: "http://host.test",
      token: "secret",
    });

    await expect(client.status()).resolves.toMatchObject({ name: "Mac" });
    expect(fetchMock).toHaveBeenCalledWith("http://host.test/api/host/status", {
      headers: { authorization: "Bearer secret" },
    });
  });

  it("opens sessions and sends prompt commands", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ session: { id: "s1" }, timeline: [], nextSeq: 1 }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new HostClient({ baseUrl: "http://host.test" });

    await client.openSession({ cwd: "/tmp/project", mode: "new" });
    await client.prompt("s1", { message: "hello" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://host.test/api/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cwd: "/tmp/project", mode: "new" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://host.test/api/sessions/s1/commands/prompt",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
    );
  });

  it("surfaces API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      new HostClient({ baseUrl: "http://host.test" }).status(),
    ).rejects.toThrow("Unauthorized");
  });

  it("connects websocket event streams", () => {
    const sockets: FakeSocket[] = [];
    const client = new HostClient({
      baseUrl: "http://host.test",
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    const events: unknown[] = [];

    client.connectEvents((event) => events.push(event));
    sockets[0]?.emit({ type: "host_status", status: { name: "Mac" } });

    expect(sockets[0]?.url).toBe("ws://host.test/ws");
    expect(events).toEqual([expect.objectContaining({ type: "host_status" })]);
  });
});

class FakeSocket {
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {}

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}
