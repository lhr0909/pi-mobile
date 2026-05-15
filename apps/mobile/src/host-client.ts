import type { HostEvent, HostStatus, OpenSessionRequest, PromptCommand, SessionSnapshot, SessionSummary, TextCommand } from "@pi-mobile/shared";

export interface HostClientOptions {
  baseUrl: string;
  token?: string;
  webSocketFactory?: (url: string) => WebSocket;
}

export class HostClient {
  private readonly baseUrl: string;
  private readonly webSocketFactory: (url: string) => WebSocket;

  constructor(private readonly options: HostClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.webSocketFactory = options.webSocketFactory ?? (url => new WebSocket(url));
  }

  async status(): Promise<HostStatus> {
    return this.getJson<HostStatus>("/api/host/status");
  }

  async listSessions(cwd?: string): Promise<SessionSummary[]> {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    const response = await this.getJson<{ sessions: SessionSummary[] }>(`/api/sessions${query}`);
    return response.sessions;
  }

  async openSession(request: OpenSessionRequest): Promise<SessionSnapshot> {
    return this.postJson<SessionSnapshot>("/api/sessions", request);
  }

  async prompt(sessionId: string, command: PromptCommand): Promise<void> {
    await this.postJson(`/api/sessions/${encodeURIComponent(sessionId)}/commands/prompt`, command);
  }

  async steer(sessionId: string, command: TextCommand): Promise<void> {
    await this.postJson(`/api/sessions/${encodeURIComponent(sessionId)}/commands/steer`, command);
  }

  async followUp(sessionId: string, command: TextCommand): Promise<void> {
    await this.postJson(`/api/sessions/${encodeURIComponent(sessionId)}/commands/follow-up`, command);
  }

  async abort(sessionId: string): Promise<void> {
    await this.postJson(`/api/sessions/${encodeURIComponent(sessionId)}/commands/abort`, {});
  }

  connectEvents(onEvent: (event: HostEvent) => void): WebSocket {
    const socket = this.webSocketFactory(toWebSocketUrl(this.baseUrl, this.options.token));
    socket.onmessage = message => {
      onEvent(JSON.parse(String(message.data)) as HostEvent);
    };
    return socket;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    return parseResponse<T>(response);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseResponse<T>(response);
  }

  private headers(): Record<string, string> {
    return this.options.token ? { authorization: `Bearer ${this.options.token}` } : {};
  }
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Host URL is required");
  }
  return trimmed.replace(/\/+$/, "");
}

export function toWebSocketUrl(baseUrl: string, token?: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = token ? `?token=${encodeURIComponent(token)}` : "";
  return url.toString();
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
  }
  return body as T;
}
