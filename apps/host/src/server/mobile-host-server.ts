import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import {
  parseOpenSessionRequest,
  parsePromptCommand,
  parseTextCommand,
  type ApiErrorBody,
  type ExtensionUiResponse,
} from "@pi-mobile/shared";
import type { HostController } from "../host-controller.js";

export interface MobileHostServerOptions {
  token?: string;
}

export class MobileHostServer {
  private readonly server: Server;
  private readonly webSocketServer = new WebSocketServer({ noServer: true });
  private unsubscribeController: (() => void) | undefined;

  constructor(
    private readonly controller: HostController,
    private readonly options: MobileHostServerOptions = {},
  ) {
    this.server = createServer((request, response) => {
      void this.handleHttp(request, response);
    });
    this.server.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });
    this.webSocketServer.on("connection", socket => {
      socket.send(JSON.stringify({ type: "host_status", status: this.controller.getStatus() }));
    });
    this.unsubscribeController = this.controller.onEvent(event => {
      const payload = JSON.stringify(event);
      for (const client of this.webSocketServer.clients) {
        if (client.readyState === client.OPEN) {
          client.send(payload);
        }
      }
    });
  }

  listen(port: number, hostname: string): Promise<void> {
    return new Promise(resolve => {
      this.server.listen(port, hostname, () => resolve());
    });
  }

  address(): { port: number } {
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server is not listening on a TCP port");
    }
    return { port: address.port };
  }

  async close(): Promise<void> {
    this.unsubscribeController?.();
    this.webSocketServer.close();
    await new Promise<void>((resolve, reject) => {
      this.server.close(error => (error ? reject(error) : resolve()));
    });
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/api/health") {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (!this.isAuthorized(request)) {
        writeJson<ApiErrorBody>(response, 401, { error: "Unauthorized" });
        return;
      }

      await this.route(request, response, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson<ApiErrorBody>(response, 400, { error: message });
    }
  }

  private async route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method === "GET" && url.pathname === "/api/host/status") {
      writeJson(response, 200, this.controller.getStatus());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sessions") {
      writeJson(response, 200, { sessions: await this.controller.listSessions(url.searchParams.get("cwd") ?? undefined) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sessions") {
      const snapshot = await this.controller.openSession(parseOpenSessionRequest(await readJsonBody(request)));
      writeJson(response, 201, snapshot);
      return;
    }

    const snapshotMatch = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/snapshot$/);
    if (request.method === "GET" && snapshotMatch) {
      const sessionId = matchPart(snapshotMatch, 0);
      writeJson(response, 200, this.controller.snapshot(sessionId));
      return;
    }

    const eventsMatch = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/events$/);
    if (request.method === "GET" && eventsMatch) {
      const sessionId = matchPart(eventsMatch, 0);
      const since = Number(url.searchParams.get("since") ?? "0");
      writeJson(response, 200, { events: this.controller.eventsSince(sessionId, Number.isFinite(since) ? since : 0) });
      return;
    }

    const commandMatch = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/commands\/([^/]+)$/);
    if (request.method === "POST" && commandMatch) {
      const sessionId = matchPart(commandMatch, 0);
      const command = matchPart(commandMatch, 1);
      await this.handleCommand(sessionId, command, request);
      writeJson(response, 202, { accepted: true });
      return;
    }

    const extensionMatch = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/extension-ui\/([^/]+)$/);
    if (request.method === "POST" && extensionMatch) {
      const sessionId = matchPart(extensionMatch, 0);
      const requestId = matchPart(extensionMatch, 1);
      this.controller.respondToExtensionUi(
        sessionId,
        requestId,
        (await readJsonBody(request)) as ExtensionUiResponse,
      );
      writeJson(response, 202, { accepted: true });
      return;
    }

    writeJson<ApiErrorBody>(response, 404, { error: "Not found" });
  }

  private async handleCommand(sessionId: string, command: string, request: IncomingMessage): Promise<void> {
    switch (command) {
      case "prompt":
        await this.controller.prompt(sessionId, parsePromptCommand(await readJsonBody(request)));
        return;
      case "steer":
        await this.controller.steer(sessionId, parseTextCommand(await readJsonBody(request)));
        return;
      case "follow-up":
        await this.controller.followUp(sessionId, parseTextCommand(await readJsonBody(request)));
        return;
      case "abort":
        await this.controller.abort(sessionId);
        return;
      default:
        throw new Error(`Unsupported command: ${command}`);
    }
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/ws" || !this.isAuthorized(request, url.searchParams.get("token") ?? undefined)) {
      socket.destroy();
      return;
    }

    this.webSocketServer.handleUpgrade(request, socket, head, ws => {
      this.webSocketServer.emit("connection", ws, request);
    });
  }

  private isAuthorized(request: IncomingMessage, tokenFromQuery?: string): boolean {
    if (!this.options.token) {
      return true;
    }

    const authorization = request.headers.authorization;
    return authorization === `Bearer ${this.options.token}` || tokenFromQuery === this.options.token;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function writeJson<T>(response: ServerResponse, status: number, body: T): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function matchPath(pathname: string, pattern: RegExp): string[] | null {
  const match = pathname.match(pattern);
  if (!match) {
    return null;
  }
  return match.slice(1).map(decodeURIComponent);
}

function matchPart(match: string[], index: number): string {
  const value = match[index];
  if (!value) {
    throw new Error("Malformed route match");
  }
  return value;
}
