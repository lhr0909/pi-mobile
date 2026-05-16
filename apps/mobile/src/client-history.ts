import type { SessionSummary } from "@pi-mobile/shared";

export const CLIENT_HISTORY_STORAGE_KEY = "pi-mobile:client-history:v1";
export const CLIENT_HISTORY_LIMIT = 8;

export interface ClientHistoryStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface RecentHost {
  hostUrl: string;
  lastConnectedAt: string;
}

export interface RecentSession {
  hostUrl: string;
  cwd: string;
  sessionId: string;
  title: string;
  lastOpenedAt: string;
  sessionFile?: string;
}

export interface ClientHistory {
  hosts: RecentHost[];
  sessions: RecentSession[];
}

export function emptyClientHistory(): ClientHistory {
  return { hosts: [], sessions: [] };
}

export async function loadClientHistory(storage: ClientHistoryStorage): Promise<ClientHistory> {
  const stored = await storage.getItem(CLIENT_HISTORY_STORAGE_KEY);
  if (!stored) {
    return emptyClientHistory();
  }

  try {
    return parseClientHistory(JSON.parse(stored));
  } catch {
    return emptyClientHistory();
  }
}

export async function saveClientHistory(storage: ClientHistoryStorage, history: ClientHistory): Promise<void> {
  await storage.setItem(CLIENT_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

export function rememberHost(history: ClientHistory, hostUrl: string, connectedAt = nowIso()): ClientHistory {
  const normalizedHostUrl = normalizeHistoryHostUrl(hostUrl);
  return {
    ...history,
    hosts: [
      { hostUrl: normalizedHostUrl, lastConnectedAt: connectedAt },
      ...history.hosts.filter(host => host.hostUrl !== normalizedHostUrl),
    ].slice(0, CLIENT_HISTORY_LIMIT),
  };
}

export function rememberSession(
  history: ClientHistory,
  hostUrl: string,
  session: SessionSummary,
  openedAt = nowIso(),
): ClientHistory {
  const normalizedHostUrl = normalizeHistoryHostUrl(hostUrl);
  const nextSession: RecentSession = {
    hostUrl: normalizedHostUrl,
    cwd: session.cwd,
    sessionId: session.id,
    title: session.title,
    lastOpenedAt: openedAt,
    ...(session.sessionFile ? { sessionFile: session.sessionFile } : {}),
  };
  const withHost = rememberHost(history, normalizedHostUrl, openedAt);

  return {
    hosts: withHost.hosts,
    sessions: [
      nextSession,
      ...history.sessions.filter(session => sessionKey(session) !== sessionKey(nextSession)),
    ].slice(0, CLIENT_HISTORY_LIMIT),
  };
}

export function normalizeHistoryHostUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Host URL is required");
  }
  return trimmed.replace(/\/+$/, "");
}

function parseClientHistory(input: unknown): ClientHistory {
  if (!isRecord(input)) {
    return emptyClientHistory();
  }

  return {
    hosts: parseArray(input.hosts, parseRecentHost),
    sessions: parseArray(input.sessions, parseRecentSession),
  };
}

function parseArray<T>(input: unknown, parseItem: (input: unknown) => T | undefined): T[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.flatMap(item => {
    const parsed = parseItem(item);
    return parsed ? [parsed] : [];
  }).slice(0, CLIENT_HISTORY_LIMIT);
}

function parseRecentHost(input: unknown): RecentHost | undefined {
  if (!isRecord(input) || typeof input.hostUrl !== "string" || typeof input.lastConnectedAt !== "string") {
    return undefined;
  }
  return {
    hostUrl: normalizeHistoryHostUrl(input.hostUrl),
    lastConnectedAt: input.lastConnectedAt,
  };
}

function parseRecentSession(input: unknown): RecentSession | undefined {
  if (
    !isRecord(input) ||
    typeof input.hostUrl !== "string" ||
    typeof input.cwd !== "string" ||
    typeof input.sessionId !== "string" ||
    typeof input.title !== "string" ||
    typeof input.lastOpenedAt !== "string"
  ) {
    return undefined;
  }

  return {
    hostUrl: normalizeHistoryHostUrl(input.hostUrl),
    cwd: input.cwd,
    sessionId: input.sessionId,
    title: input.title,
    lastOpenedAt: input.lastOpenedAt,
    ...(typeof input.sessionFile === "string" && input.sessionFile.trim() ? { sessionFile: input.sessionFile } : {}),
  };
}

function sessionKey(session: Pick<RecentSession, "hostUrl" | "cwd" | "sessionId">): string {
  return `${session.hostUrl}\u0000${session.cwd}\u0000${session.sessionId}`;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function nowIso(): string {
  return new Date().toISOString();
}
