import type { OpenSessionRequest, SessionSummary } from "@pi-mobile/shared";
import type { AgentEventListener, MobileAgentRuntime, MobileAgentSession, RuntimeFactory } from "../src/types.js";

export class FakeSession implements MobileAgentSession {
  sessionFile: string | undefined;
  sessionName: string | undefined = "Fake session";
  model: unknown;
  thinkingLevel = "medium";
  isStreaming = false;
  isCompacting = false;
  pendingMessageCount = 0;
  messages: readonly unknown[] = [];
  readonly listeners = new Set<AgentEventListener>();
  bindings: unknown;
  prompts: Array<{ message: string; options: any }> = [];
  steers: string[] = [];
  followUps: string[] = [];
  abortCount = 0;

  constructor(public readonly sessionId: string, public readonly cwd: string) {}

  async bindExtensions(bindings: unknown): Promise<void> {
    this.bindings = bindings;
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(message: string, options?: any): Promise<void> {
    this.prompts.push({ message, options });
    options?.preflightResult?.(true);
  }

  async steer(message: string): Promise<void> {
    this.steers.push(message);
  }

  async followUp(message: string): Promise<void> {
    this.followUps.push(message);
  }

  async abort(): Promise<void> {
    this.abortCount += 1;
  }

  emit(event: unknown): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export class FakeRuntime implements MobileAgentRuntime {
  constructor(public readonly session: FakeSession, public readonly cwd: string) {}

  async dispose(): Promise<void> {}
}

export class FakeRuntimeFactory implements RuntimeFactory {
  readonly created: FakeSession[] = [];
  readonly listedCwds: Array<string | undefined> = [];
  readonly runtimeRequests: OpenSessionRequest[] = [];

  async createRuntime(request: OpenSessionRequest): Promise<MobileAgentRuntime> {
    this.runtimeRequests.push(request);
    const session = new FakeSession(`session-${this.created.length + 1}`, request.cwd);
    session.sessionFile = request.sessionFile;
    this.created.push(session);
    return new FakeRuntime(session, request.cwd);
  }

  async listSessions(cwd?: string): Promise<SessionSummary[]> {
    this.listedCwds.push(cwd);
    return [
      {
        id: "stored-1",
        cwd: cwd ?? "/tmp/project",
        title: "Stored session",
        sessionFile: "/tmp/session.jsonl",
        runState: "idle",
        messageCount: 2,
        updatedAt: "2026-05-15T00:00:00.000Z",
      },
    ];
  }
}
