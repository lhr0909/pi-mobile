import path from "node:path";
import {
  applyEventToSessionState,
  createTimelineProjectionState,
  projectPiEvent,
  type HostEvent,
  type JsonValue,
  type OpenSessionRequest,
  type SessionSnapshot,
  type SessionState,
  type TimelineItem,
} from "@pi-mobile/shared";
import { EventLog } from "./event-log.js";
import { MobileExtensionUiBridge } from "./mobile-ui-context.js";
import type { HostEventListener, MobileAgentRuntime, MobileAgentSession, RuntimeFactory, SessionRunner } from "./types.js";

export class SdkSessionRunner implements SessionRunner {
  private readonly eventLog = new EventLog();
  private readonly timelineState = createTimelineProjectionState();
  private readonly timeline: TimelineItem[] = [];
  private readonly uiBridge: MobileExtensionUiBridge;
  private unsubscribe: (() => void) | undefined;
  private session: MobileAgentSession;
  private _state: SessionState;

  private constructor(
    private readonly runtime: MobileAgentRuntime,
    private readonly emit: HostEventListener,
  ) {
    this.session = runtime.session;
    this._state = this.createState(runtime.session);
    this.uiBridge = new MobileExtensionUiBridge(this.id, this.eventLog, emit);
  }

  static async open(
    runtimeFactory: RuntimeFactory,
    request: OpenSessionRequest,
    emit: HostEventListener,
  ): Promise<SdkSessionRunner> {
    const runtime = await runtimeFactory.createRuntime(request);
    const runner = new SdkSessionRunner(runtime, emit);
    await runner.bindSession();
    return runner;
  }

  get id(): string {
    return this.session.sessionId;
  }

  get state(): SessionState {
    return this._state;
  }

  snapshot(): SessionSnapshot {
    return {
      session: this._state,
      timeline: [...this.timeline],
      nextSeq: this.eventLog.nextSequence,
    };
  }

  eventsSince(seq: number): HostEvent[] {
    return this.eventLog.eventsSince(seq);
  }

  async prompt(message: string, streamingBehavior?: "steer" | "followUp"): Promise<void> {
    let accepted = false;
    await new Promise<void>((resolve, reject) => {
      void this.session
        .prompt(message, {
          streamingBehavior,
          source: "rpc",
          preflightResult: (success: boolean) => {
            if (success) {
              accepted = true;
              resolve();
            } else {
              reject(new Error("Prompt was rejected before execution"));
            }
          },
        })
        .catch(error => {
          const message = error instanceof Error ? error.message : String(error);
          if (!accepted) {
            reject(new Error(message));
          }
          this.recordCommandError("prompt", message);
        });
    });
  }

  async steer(message: string): Promise<void> {
    await this.session.steer(message);
  }

  async followUp(message: string): Promise<void> {
    await this.session.followUp(message);
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  respondToExtensionUi(requestId: string, response: Parameters<MobileExtensionUiBridge["respond"]>[1]): void {
    this.uiBridge.respond(requestId, response);
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    await this.runtime.dispose();
  }

  private async bindSession(): Promise<void> {
    this.unsubscribe?.();
    this.session = this.runtime.session;
    this._state = this.createState(this.session);
    await this.session.bindExtensions({
      uiContext: this.uiBridge.createContext(),
      commandContextActions: {
        waitForIdle: () => this.sessionPromptIdle(),
        newSession: async (options: unknown) => this.runtime.newSession?.(options),
        switchSession: async (sessionPath: string, options: unknown) => this.runtime.switchSession?.(sessionPath, options),
      },
      shutdownHandler: () => {},
      onError: (error: unknown) => {
        this.recordCommandError("extension", error instanceof Error ? error.message : String(error));
      },
    });
    this.unsubscribe = this.session.subscribe(event => this.handleSessionEvent(event));
  }

  private async sessionPromptIdle(): Promise<void> {
    const agent = (this.session as unknown as { agent?: { waitForIdle?: () => Promise<void> } }).agent;
    await agent?.waitForIdle?.();
  }

  private handleSessionEvent(event: unknown): void {
    const jsonEvent = toJsonValue(event);
    this.emit(this.eventLog.record(seq => ({ type: "raw_event", sessionId: this.id, event: jsonEvent, seq })));

    this._state = applyEventToSessionState(this._state, jsonEvent);
    this.emit(this.eventLog.record(seq => ({ type: "session_updated", session: this._state, seq } as HostEvent)));

    const projected = projectPiEvent(this.timelineState, { sessionId: this.id, seq: 0, event: jsonEvent });
    for (const event of projected) {
      const sequenced = this.eventLog.record(seq => ({ ...event, seq }));
      this.applyTimelineEvent(sequenced);
      this.emit(sequenced);
    }
  }

  private applyTimelineEvent(event: HostEvent): void {
    if (event.type === "timeline_item") {
      this.timeline.push(event.item);
      return;
    }

    if (event.type === "timeline_delta") {
      const item = this.timeline.find(candidate => candidate.id === event.itemId);
      if (item?.kind === "assistant") {
        item.text += event.delta;
      }
    }
  }

  private recordCommandError(command: string, message: string): void {
    this.emit(
      this.eventLog.record(seq => ({
        type: "command_error",
        sessionId: this.id,
        command,
        message,
        seq,
      })),
    );
  }

  private createState(session: MobileAgentSession): SessionState {
    const title = session.sessionName ?? (path.basename(this.runtime.cwd) || session.sessionId.slice(0, 8));
    return {
      id: session.sessionId,
      cwd: this.runtime.cwd,
      title,
      runState: session.isCompacting ? "compacting" : session.isStreaming ? "streaming" : "idle",
      messageCount: session.messages.length,
      pendingMessageCount: session.pendingMessageCount,
      updatedAt: new Date().toISOString(),
      ...(session.sessionFile ? { sessionFile: session.sessionFile } : {}),
      ...(session.model === undefined ? {} : { model: session.model as JsonValue }),
      ...(session.thinkingLevel ? { thinkingLevel: session.thinkingLevel } : {}),
    };
  }
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
