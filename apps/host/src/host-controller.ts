import os from "node:os";
import type {
  ExtensionUiResponse,
  HostEvent,
  HostStatus,
  OpenSessionRequest,
  PromptCommand,
  SessionSnapshot,
  SessionSummary,
  TextCommand,
} from "@pi-mobile/shared";
import { SdkSessionRunner } from "./session-runner.js";
import type { HostEventListener, RuntimeFactory, SessionRunner } from "./types.js";

export class HostController {
  private readonly runners = new Map<string, SessionRunner>();
  private readonly listeners = new Set<HostEventListener>();

  constructor(private readonly runtimeFactory: RuntimeFactory) {}

  getStatus(): HostStatus {
    return {
      name: os.hostname(),
      version: "0.1.0",
      platform: process.platform,
      cwd: process.cwd(),
      pid: process.pid,
      sdkMode: "sdk",
    };
  }

  onEvent(listener: HostEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listSessions(cwd?: string): Promise<SessionSummary[]> {
    const active = new Map([...this.runners.values()].map(runner => [runner.state.sessionFile, runner.state]));
    const stored = await this.runtimeFactory.listSessions(cwd);
    return stored.map(summary => {
      const activeState = active.get(summary.sessionFile);
      return activeState ?? summary;
    });
  }

  async openSession(request: OpenSessionRequest): Promise<SessionSnapshot> {
    const runner = await SdkSessionRunner.open(this.runtimeFactory, request, event => this.emit(event));
    this.runners.set(runner.id, runner);
    const snapshot = runner.snapshot();
    this.emit({ type: "session_opened", snapshot });
    return snapshot;
  }

  snapshot(sessionId: string): SessionSnapshot {
    return this.runner(sessionId).snapshot();
  }

  eventsSince(sessionId: string, seq: number): HostEvent[] {
    return this.runner(sessionId).eventsSince(seq);
  }

  async prompt(sessionId: string, command: PromptCommand): Promise<void> {
    await this.runner(sessionId).prompt(command.message, command.streamingBehavior);
  }

  async steer(sessionId: string, command: TextCommand): Promise<void> {
    await this.runner(sessionId).steer(command.message);
  }

  async followUp(sessionId: string, command: TextCommand): Promise<void> {
    await this.runner(sessionId).followUp(command.message);
  }

  async abort(sessionId: string): Promise<void> {
    await this.runner(sessionId).abort();
  }

  respondToExtensionUi(sessionId: string, requestId: string, response: ExtensionUiResponse): void {
    this.runner(sessionId).respondToExtensionUi(requestId, response);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.runners.values()].map(runner => runner.dispose()));
    this.runners.clear();
  }

  private runner(sessionId: string): SessionRunner {
    const runner = this.runners.get(sessionId);
    if (!runner) {
      throw new Error(`Session not open: ${sessionId}`);
    }
    return runner;
  }

  private emit(event: HostEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
