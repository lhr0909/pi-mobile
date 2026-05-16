import type { ExtensionUiResponse, HostEvent, OpenSessionRequest, SessionSnapshot, SessionState, SessionSummary } from "@pi-mobile/shared";

export type AgentEventListener = (event: unknown) => void;

export interface MobileAgentSession {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly sessionName: string | undefined;
  readonly model: unknown;
  readonly thinkingLevel: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly pendingMessageCount: number;
  readonly messages: readonly unknown[];
  bindExtensions(bindings: unknown): Promise<void>;
  subscribe(listener: AgentEventListener): () => void;
  prompt(message: string, options?: unknown): Promise<void>;
  steer(message: string, images?: unknown[]): Promise<void>;
  followUp(message: string, images?: unknown[]): Promise<void>;
  abort(): Promise<void>;
}

export interface MobileAgentRuntime {
  readonly session: MobileAgentSession;
  readonly cwd: string;
  setRebindSession?(rebindSession: (session: MobileAgentSession) => Promise<void>): void;
  newSession?(options?: unknown): Promise<{ cancelled: boolean }>;
  switchSession?(sessionPath: string, options?: unknown): Promise<{ cancelled: boolean }>;
  dispose(): Promise<void>;
}

export interface RuntimeFactory {
  createRuntime(request: OpenSessionRequest): Promise<MobileAgentRuntime>;
  listSessions(cwd?: string): Promise<SessionSummary[]>;
}

export interface SessionRunner {
  readonly id: string;
  readonly state: SessionState;
  snapshot(): SessionSnapshot;
  eventsSince(seq: number): HostEvent[];
  prompt(message: string, streamingBehavior?: "steer" | "followUp"): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  respondToExtensionUi(requestId: string, response: ExtensionUiResponse): void;
  dispose(): Promise<void>;
}

export type HostEventListener = (event: HostEvent) => void;
