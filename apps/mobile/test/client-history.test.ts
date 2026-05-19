import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@pi-mobile/shared";
import {
  CLIENT_HISTORY_LIMIT,
  CLIENT_HISTORY_STORAGE_KEY,
  emptyClientHistory,
  forgetHost,
  forgetSession,
  loadClientHistory,
  normalizeHistoryHostUrl,
  rememberHost,
  rememberSession,
  saveClientHistory,
  type ClientHistoryStorage,
} from "../src/client-history.js";

class MemoryStorage implements ClientHistoryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

const baseSession: SessionSummary = {
  id: "s1",
  cwd: "/tmp/project",
  title: "Project",
  sessionFile: "/tmp/session.jsonl",
  runState: "idle",
  messageCount: 2,
  updatedAt: "2026-05-16T00:00:00.000Z",
};

describe("client history", () => {
  it("normalizes host URLs for history keys", () => {
    expect(normalizeHistoryHostUrl(" http://mac.local:4739/ ")).toBe("http://mac.local:4739");
    expect(() => normalizeHistoryHostUrl(" ")).toThrow("Host URL is required");
  });

  it("remembers recent hosts with newest first and no duplicates", () => {
    const first = rememberHost(emptyClientHistory(), "http://mac.local:4739/", "2026-05-16T00:00:00.000Z");
    const second = rememberHost(first, "http://office.local:4739", "2026-05-16T00:01:00.000Z");
    const repeated = rememberHost(second, "http://mac.local:4739", "2026-05-16T00:02:00.000Z");

    expect(repeated.hosts.map(host => host.hostUrl)).toEqual([
      "http://mac.local:4739",
      "http://office.local:4739",
    ]);
    expect(repeated.hosts[0]?.lastConnectedAt).toBe("2026-05-16T00:02:00.000Z");
  });

  it("remembers only the latest recent session for each host path", () => {
    const history = rememberSession(emptyClientHistory(), "http://mac.local:4739/", baseSession, "2026-05-16T00:00:00.000Z");
    const updated = rememberSession(
      history,
      "http://mac.local:4739",
      { ...baseSession, id: "s2", title: "Renamed", sessionFile: "/tmp/session-2.jsonl" },
      "2026-05-16T00:01:00.000Z",
    );

    expect(updated.sessions).toEqual([
      {
        hostUrl: "http://mac.local:4739",
        cwd: "/tmp/project",
        sessionId: "s2",
        title: "Renamed",
        sessionFile: "/tmp/session-2.jsonl",
        lastOpenedAt: "2026-05-16T00:01:00.000Z",
      },
    ]);
    expect(updated.hosts[0]?.hostUrl).toBe("http://mac.local:4739");
  });

  it("deduplicates loaded recent sessions by host path", async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      CLIENT_HISTORY_STORAGE_KEY,
      JSON.stringify({
        hosts: [],
        sessions: [
          {
            hostUrl: "http://mac.local:4739",
            cwd: "/tmp/project",
            sessionId: "newer",
            title: "Project",
            sessionFile: "/tmp/newer.jsonl",
            lastOpenedAt: "2026-05-16T00:02:00.000Z",
          },
          {
            hostUrl: "http://mac.local:4739/",
            cwd: "/tmp/project",
            sessionId: "older",
            title: "Project",
            sessionFile: "/tmp/older.jsonl",
            lastOpenedAt: "2026-05-16T00:01:00.000Z",
          },
        ],
      }),
    );

    await expect(loadClientHistory(storage)).resolves.toMatchObject({
      sessions: [
        {
          hostUrl: "http://mac.local:4739",
          cwd: "/tmp/project",
          sessionId: "newer",
          sessionFile: "/tmp/newer.jsonl",
        },
      ],
    });
  });

  it("forgets recent hosts and their sessions", () => {
    const macSession = rememberSession(
      emptyClientHistory(),
      "http://mac.local:4739/",
      baseSession,
      "2026-05-16T00:00:00.000Z",
    );
    const officeSession = rememberSession(
      macSession,
      "http://office.local:4739",
      { ...baseSession, id: "office", cwd: "/tmp/office" },
      "2026-05-16T00:01:00.000Z",
    );

    const updated = forgetHost(officeSession, "http://mac.local:4739/");

    expect(updated.hosts.map(host => host.hostUrl)).toEqual(["http://office.local:4739"]);
    expect(updated.sessions.map(session => session.hostUrl)).toEqual(["http://office.local:4739"]);
  });

  it("forgets individual recent sessions without removing the host", () => {
    const history = rememberSession(
      emptyClientHistory(),
      "http://mac.local:4739/",
      baseSession,
      "2026-05-16T00:00:00.000Z",
    );

    const updated = forgetSession(history, { hostUrl: "http://mac.local:4739/", cwd: "/tmp/project" });

    expect(updated.hosts.map(host => host.hostUrl)).toEqual(["http://mac.local:4739"]);
    expect(updated.sessions).toEqual([]);
  });

  it("limits stored hosts and sessions", () => {
    let history = emptyClientHistory();
    for (let index = 0; index < CLIENT_HISTORY_LIMIT + 2; index += 1) {
      history = rememberSession(
        history,
        `http://host-${index}.local:4739`,
        { ...baseSession, id: `s${index}`, cwd: `/tmp/project-${index}` },
        `2026-05-16T00:${String(index).padStart(2, "0")}:00.000Z`,
      );
    }

    expect(history.hosts).toHaveLength(CLIENT_HISTORY_LIMIT);
    expect(history.sessions).toHaveLength(CLIENT_HISTORY_LIMIT);
    expect(history.hosts[0]?.hostUrl).toBe("http://host-9.local:4739");
    expect(history.sessions[0]?.sessionId).toBe("s9");
  });

  it("loads empty history for missing or malformed storage", async () => {
    const storage = new MemoryStorage();
    await expect(loadClientHistory(storage)).resolves.toEqual(emptyClientHistory());

    storage.values.set(CLIENT_HISTORY_STORAGE_KEY, "not json");
    await expect(loadClientHistory(storage)).resolves.toEqual(emptyClientHistory());
  });

  it("round-trips history through storage", async () => {
    const storage = new MemoryStorage();
    const history = rememberSession(emptyClientHistory(), "http://mac.local:4739", baseSession, "2026-05-16T00:00:00.000Z");

    await saveClientHistory(storage, history);

    await expect(loadClientHistory(storage)).resolves.toEqual(history);
  });
});
