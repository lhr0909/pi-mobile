import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import type { OpenSessionRequest, SessionSummary } from "@pi-mobile/shared";
import type { MobileAgentRuntime, RuntimeFactory } from "../types.js";

export class PiSdkRuntimeFactory implements RuntimeFactory {
  async createRuntime(request: OpenSessionRequest): Promise<MobileAgentRuntime> {
    const sessionManager = createSessionManager(request);
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          ...(sessionStartEvent ? { sessionStartEvent } : {}),
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };

    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: request.cwd,
      agentDir: getAgentDir(),
      sessionManager,
    });

    return runtime as unknown as MobileAgentRuntime;
  }

  async listSessions(cwd?: string): Promise<SessionSummary[]> {
    const sessions = cwd ? await SessionManager.list(cwd) : await SessionManager.listAll();
    return sessions.map(toSessionSummary);
  }
}

function createSessionManager(request: OpenSessionRequest): SessionManager {
  if (request.mode === "continue") {
    return SessionManager.continueRecent(request.cwd);
  }

  if (request.sessionFile) {
    return SessionManager.open(request.sessionFile, undefined, request.cwd);
  }

  return SessionManager.create(request.cwd);
}

function toSessionSummary(info: SessionInfo): SessionSummary {
  return {
    id: info.id,
    cwd: info.cwd,
    title: info.name ?? (info.firstMessage || info.id.slice(0, 8)),
    sessionFile: info.path,
    runState: "idle",
    messageCount: info.messageCount,
    updatedAt: info.modified.toISOString(),
  };
}
