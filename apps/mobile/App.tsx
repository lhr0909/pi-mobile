import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import CodeHighlighter, { type ReactStyle } from "react-native-code-highlighter";
import Markdown from "react-native-markdown-display";
import type {
  DirectoryList,
  JsonValue,
  SessionSnapshot,
  SessionSummary,
  TimelineItem,
} from "@pi-mobile/shared";
import {
  createInitialAppViewState,
  isHostWorkspacePath,
  reduceAppViewState,
  type AppViewState,
} from "./src/app-view-model";
import {
  emptyClientHistory,
  forgetHost,
  forgetSession,
  loadClientHistory,
  normalizeHistoryHostUrl,
  rememberHost,
  rememberSession,
  saveClientHistory,
  type ClientHistory,
  type RecentHost,
  type RecentSession,
} from "./src/client-history";
import { HostClient } from "./src/host-client";
import {
  nextPinnedToBottom,
  type TimelineScrollMetrics,
} from "./src/timeline-scroll";
import {
  formatJson,
  getBashCallParts,
  getReadCallParts,
  getReadLanguage,
  normalizeBashOutput,
  normalizeReadOutput,
  replaceTabs,
} from "./src/tool-rendering";

const DEFAULT_HOST_URL = "http://localhost:4739";
const HOME_DIRECTORY_PATH = "~";
const DOCUMENTS_DIRECTORY_PATH = "~/Documents";
const DEFAULT_DIRECTORY_PATH = DOCUMENTS_DIRECTORY_PATH;
const MONO_FONT =
  Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  }) ?? "monospace";
const SESSION_KEYBOARD_BEHAVIOR = Platform.OS === "ios" ? "padding" : "height";

export default function App() {
  const [state, dispatch] = useReducer(
    reduceAppViewState,
    createInitialAppViewState(DEFAULT_HOST_URL),
  );
  const [history, setHistory] = useState<ClientHistory>(() => emptyClientHistory());
  const [directoryList, setDirectoryList] = useState<DirectoryList | undefined>();
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | undefined>();
  const [pathSessions, setPathSessions] = useState<SessionSummary[]>([]);
  const [pathSessionsPath, setPathSessionsPath] = useState<string | undefined>();
  const [pathSessionsLoading, setPathSessionsLoading] = useState(false);
  const [pathSessionsError, setPathSessionsError] = useState<string | undefined>();
  const historyRef = useRef(history);
  const socketRef = useRef<WebSocket | null>(null);
  const client = useMemo(
    () => createHostClient(state.hostUrl, state.token),
    [state.hostUrl, state.token],
  );

  const activeSession = state.client.activeSessionId
    ? state.client.sessions[state.client.activeSessionId]
    : undefined;

  useEffect(() => {
    let mounted = true;
    void loadClientHistory(AsyncStorage)
      .then((loadedHistory) => {
        if (!mounted) return;
        historyRef.current = loadedHistory;
        setHistory(loadedHistory);
      })
      .catch((error) => {
        if (mounted) {
          dispatch({ type: "setError", message: toErrorMessage(error) });
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const persistHistory = (nextHistory: ClientHistory) => {
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    void saveClientHistory(AsyncStorage, nextHistory).catch((error) => {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    });
  };

  const browseSessionsForPath = async (sessionClient: HostClient, cwd: string) => {
    const path = cwd.trim();
    if (!path) {
      return [];
    }

    setPathSessionsLoading(true);
    setPathSessionsError(undefined);
    setPathSessionsPath(path);
    try {
      const sessions = await sessionClient.listSessions(path);
      setPathSessions(sessions);
      return sessions;
    } catch (error) {
      setPathSessions([]);
      setPathSessionsError(toErrorMessage(error));
      return [];
    } finally {
      setPathSessionsLoading(false);
    }
  };

  const browseDirectories = async (directoryClient: HostClient, directoryPath = DEFAULT_DIRECTORY_PATH) => {
    setDirectoryLoading(true);
    setDirectoryError(undefined);
    try {
      const nextDirectoryList = await directoryClient.listDirectories(directoryPath);
      setDirectoryList(nextDirectoryList);
      void browseSessionsForPath(directoryClient, nextDirectoryList.path);
      return nextDirectoryList;
    } catch (error) {
      setDirectoryError(toErrorMessage(error));
      return undefined;
    } finally {
      setDirectoryLoading(false);
    }
  };

  const connectToHost = async (hostUrl: string): Promise<HostClient> => {
    const normalizedHostUrl = normalizeHistoryHostUrl(hostUrl);
    const shouldSeedDefaultPath = !isHostWorkspacePath(state.cwd);
    const nextClient = createHostClient(normalizedHostUrl, state.token);
    dispatch({ type: "setHostUrl", value: normalizedHostUrl });
    dispatch({ type: "connecting" });
    const status = await nextClient.status();
    socketRef.current?.close();
    socketRef.current = nextClient.connectEvents((event) =>
      dispatch({ type: "hostEvent", event }),
    );
    dispatch({ type: "connected", status });
    persistHistory(rememberHost(historyRef.current, normalizedHostUrl));
    const defaultDirectory = await browseDirectories(nextClient);
    if (shouldSeedDefaultPath && defaultDirectory) {
      dispatch({ type: "setCwd", value: defaultDirectory.path });
    }
    return nextClient;
  };

  const connect = async () => {
    try {
      await connectToHost(state.hostUrl);
    } catch (error) {
      dispatch({ type: "disconnected", errorMessage: toErrorMessage(error) });
    }
  };

  const rememberOpenedSession = (hostUrl: string, snapshot: SessionSnapshot) => {
    persistHistory(rememberSession(historyRef.current, hostUrl, snapshot.session));
  };

  const removeRecentHost = (host: RecentHost) => {
    persistHistory(forgetHost(historyRef.current, host.hostUrl));
  };

  const removeRecentSession = (session: RecentSession) => {
    persistHistory(forgetSession(historyRef.current, session));
  };

  const openNewSession = async (sessionClient: HostClient, hostUrl: string, cwd: string) => {
    const snapshot = await sessionClient.openSession({ cwd, mode: "new" });
    dispatch({ type: "hostEvent", event: { type: "session_opened", snapshot } });
    rememberOpenedSession(hostUrl, snapshot);
  };

  const openSession = async () => {
    if (!state.cwd.trim()) return;
    try {
      await openNewSession(client, normalizeHistoryHostUrl(state.hostUrl), state.cwd.trim());
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    }
  };

  const openNewSessionFromHistory = async (session: RecentSession) => {
    try {
      const sessionClient = await connectToHost(session.hostUrl);
      dispatch({ type: "setCwd", value: session.cwd });
      await openNewSession(sessionClient, session.hostUrl, session.cwd);
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    }
  };

  const openPreviousSession = async (session: RecentSession) => {
    try {
      const sessionClient = await connectToHost(session.hostUrl);
      dispatch({ type: "setCwd", value: session.cwd });
      const sessionFile = session.sessionFile ?? await findSessionFile(sessionClient, session);
      if (!sessionFile) {
        throw new Error("Previous session was not found on this host");
      }
      const snapshot = await sessionClient.openSession({
        cwd: session.cwd,
        sessionFile,
        mode: "open",
      });
      dispatch({ type: "hostEvent", event: { type: "session_opened", snapshot } });
      rememberOpenedSession(session.hostUrl, snapshot);
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    }
  };

  const openListedSession = async (session: SessionSummary) => {
    try {
      if (!session.sessionFile) {
        throw new Error("Stored session file is missing");
      }
      const snapshot = await client.openSession({
        cwd: session.cwd,
        sessionFile: session.sessionFile,
        mode: "open",
      });
      dispatch({ type: "hostEvent", event: { type: "session_opened", snapshot } });
      rememberOpenedSession(normalizeHistoryHostUrl(state.hostUrl), snapshot);
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    }
  };

  const browseSessionsForSelectedPath = async () => {
    await browseSessionsForPath(client, state.cwd);
  };

  const selectExplorerPath = () => {
    if (directoryList) {
      dispatch({ type: "setCwd", value: directoryList.path });
    }
  };

  const sendPrompt = async () => {
    if (!activeSession || !state.prompt.trim()) return;
    await client.prompt(activeSession.session.id, { message: state.prompt });
    dispatch({ type: "clearPrompt" });
  };

  const steer = async () => {
    if (!activeSession || !state.prompt.trim()) return;
    await client.steer(activeSession.session.id, { message: state.prompt });
    dispatch({ type: "clearPrompt" });
  };

  const followUp = async () => {
    if (!activeSession || !state.prompt.trim()) return;
    await client.followUp(activeSession.session.id, { message: state.prompt });
    dispatch({ type: "clearPrompt" });
  };

  const abort = async () => {
    if (!activeSession) return;
    await client.abort(activeSession.session.id);
  };

  const showConnection = state.screen === "connection" || !activeSession;

  return (
    <SafeAreaView style={styles.screen}>
      {showConnection ? (
        <ConnectionScreen
          directoryError={directoryError}
          directoryList={directoryList}
          directoryLoading={directoryLoading}
          history={history}
          pathSessions={pathSessions}
          pathSessionsError={pathSessionsError}
          pathSessionsLoading={pathSessionsLoading}
          pathSessionsPath={pathSessionsPath}
          state={state}
          onBrowseDirectory={(path) => void browseDirectories(client, path)}
          onBrowseSessions={() => void browseSessionsForSelectedPath()}
          onConnect={connect}
          onConnectRecentHost={(host) => void connectToHost(host.hostUrl).catch((error) => {
            dispatch({ type: "disconnected", errorMessage: toErrorMessage(error) });
          })}
          onCwdChange={(value) => dispatch({ type: "setCwd", value })}
          onRemoveRecentHost={removeRecentHost}
          onRemoveRecentSession={removeRecentSession}
          onHostUrlChange={(value) => dispatch({ type: "setHostUrl", value })}
          onOpenListedSession={(session) => void openListedSession(session)}
          onOpenNewSessionFromHistory={(session) => void openNewSessionFromHistory(session)}
          onOpenPreviousSession={(session) => void openPreviousSession(session)}
          onOpenSession={openSession}
          onSelectExplorerPath={selectExplorerPath}
          onTokenChange={(value) => dispatch({ type: "setToken", value })}
        />
      ) : (
        <SessionScreen
          snapshot={activeSession}
          state={state}
          onShowConnection={() => dispatch({ type: "showConnection" })}
          onToggleHeader={() => dispatch({ type: "toggleSessionHeader" })}
          onSendPrompt={sendPrompt}
          onSteer={steer}
          onFollowUp={followUp}
          onAbort={abort}
          onPromptChange={(value) => dispatch({ type: "setPrompt", value })}
        />
      )}
    </SafeAreaView>
  );
}

function createHostClient(hostUrl: string, token: string): HostClient {
  return new HostClient({
    baseUrl: hostUrl.trim() ? hostUrl : DEFAULT_HOST_URL,
    ...(token.trim() ? { token: token.trim() } : {}),
  });
}

async function findSessionFile(client: HostClient, session: RecentSession): Promise<string | undefined> {
  const sessions = await client.listSessions(session.cwd);
  return sessions.find(candidate => candidate.id === session.sessionId)?.sessionFile;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ConnectionScreenProps {
  state: AppViewState;
  history: ClientHistory;
  directoryList: DirectoryList | undefined;
  directoryLoading: boolean;
  directoryError: string | undefined;
  pathSessions: SessionSummary[];
  pathSessionsPath: string | undefined;
  pathSessionsLoading: boolean;
  pathSessionsError: string | undefined;
  onConnect: () => void;
  onConnectRecentHost: (host: RecentHost) => void;
  onRemoveRecentHost: (host: RecentHost) => void;
  onRemoveRecentSession: (session: RecentSession) => void;
  onOpenSession: () => void;
  onOpenListedSession: (session: SessionSummary) => void;
  onOpenPreviousSession: (session: RecentSession) => void;
  onOpenNewSessionFromHistory: (session: RecentSession) => void;
  onHostUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onCwdChange: (value: string) => void;
  onBrowseDirectory: (path: string) => void;
  onBrowseSessions: () => void;
  onSelectExplorerPath: () => void;
}

function ConnectionScreen({
  state,
  history,
  directoryList,
  directoryLoading,
  directoryError,
  pathSessions,
  pathSessionsPath,
  pathSessionsLoading,
  pathSessionsError,
  onConnect,
  onConnectRecentHost,
  onRemoveRecentHost,
  onRemoveRecentSession,
  onOpenSession,
  onOpenListedSession,
  onOpenPreviousSession,
  onOpenNewSessionFromHistory,
  onHostUrlChange,
  onTokenChange,
  onCwdChange,
  onBrowseDirectory,
  onBrowseSessions,
  onSelectExplorerPath,
}: ConnectionScreenProps) {
  const hasHistory = history.hosts.length > 0 || history.sessions.length > 0;
  const [setupExpanded, setSetupExpanded] = useState(!hasHistory);
  useEffect(() => {
    if (!hasHistory) {
      setSetupExpanded(true);
    }
  }, [hasHistory]);

  const pathIsOpenable =
    state.cwd.trim().length === 0 || isHostWorkspacePath(state.cwd);
  const canOpenSession =
    state.connectionState === "connected" &&
    state.cwd.trim().length > 0 &&
    pathIsOpenable;

  return (
    <ScrollView
      contentContainerStyle={styles.connectionScreen}
      keyboardShouldPersistTaps="handled"
      style={styles.connectionScroll}
    >
      <View style={styles.brandHeader}>
        <Text style={styles.appTitle}>Pi Mobile</Text>
        <Text style={styles.helpText}>Resume desktop and mobile Pi sessions from a phone-first home.</Text>
      </View>

      <RecentSessionsPanel
        sessions={history.sessions}
        onRemove={onRemoveRecentSession}
        onOpenNew={onOpenNewSessionFromHistory}
        onOpenPrevious={onOpenPreviousSession}
      />
      <RecentHostsPanel
        hosts={history.hosts}
        onConnect={onConnectRecentHost}
        onRemove={onRemoveRecentHost}
      />

      {hasHistory ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Browse or add</Text>
          <Text style={styles.dimLine}>
            Connect to a host, pick a folder, or browse stored desktop sessions by path.
          </Text>
          <PiButton
            accessibilityLabel="Toggle host setup"
            label={setupExpanded ? "Hide host setup" : "Browse host/path"}
            onPress={() => setSetupExpanded((expanded) => !expanded)}
            variant="secondary"
          />
        </View>
      ) : null}

      {setupExpanded ? (
        <>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Connect to host</Text>
            <Text style={styles.label}>Host URL</Text>
            <TextInput
              accessibilityLabel="Host URL"
              autoCapitalize="none"
              value={state.hostUrl}
              onChangeText={onHostUrlChange}
              style={styles.input}
            />
            <Text style={styles.label}>Bearer token (optional)</Text>
            <TextInput
              accessibilityLabel="Host Token"
              autoCapitalize="none"
              secureTextEntry
              value={state.token}
              onChangeText={onTokenChange}
              style={styles.input}
            />
            <PiButton
              accessibilityLabel="Connect"
              disabled={state.connectionState === "connecting"}
              label={
                state.connectionState === "connecting"
                  ? "Connecting…"
                  : "Connect host"
              }
              onPress={onConnect}
              variant="primary"
            />
            <Text style={styles.statusLine}>Status: {state.connectionState}</Text>
            {state.client.connectionMessage ? (
              <Text style={styles.dimLine}>{state.client.connectionMessage}</Text>
            ) : null}
            {state.errorMessage ? (
              <Text style={styles.errorLine}>{state.errorMessage}</Text>
            ) : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Workspace</Text>
            <Text style={styles.label}>Selected host path</Text>
            <TextInput
              accessibilityLabel="Session Path"
              autoCapitalize="none"
              placeholder="Connect, browse, or paste /absolute/path"
              placeholderTextColor={palette.dim}
              value={state.cwd}
              onChangeText={onCwdChange}
              style={styles.input}
            />
            <Text style={pathIsOpenable ? styles.dimLine : styles.warningLine}>
              {pathIsOpenable
                ? "Documents is the default. You can also paste an absolute or ~/ path."
                : "Use an absolute or ~/ host path before opening a session."}
            </Text>
            <View style={styles.historyActions}>
              <PiButton
                accessibilityLabel="New Session"
                disabled={!canOpenSession}
                label="Open new session"
                onPress={onOpenSession}
                variant="secondary"
              />
              <PiButton
                accessibilityLabel="Browse sessions for selected path"
                disabled={state.connectionState !== "connected" || state.cwd.trim().length === 0 || pathSessionsLoading}
                label={pathSessionsLoading ? "Loading…" : "Browse sessions"}
                onPress={onBrowseSessions}
                variant="ghost"
              />
            </View>
          </View>

          <PathExplorerPanel
            connectionState={state.connectionState}
            directoryError={directoryError}
            directoryList={directoryList}
            loading={directoryLoading}
            onBrowseDirectory={onBrowseDirectory}
            onSelectCurrentPath={onSelectExplorerPath}
          />
          <PathSessionsPanel
            connectionState={state.connectionState}
            path={state.cwd}
            sessions={pathSessions}
            sessionsError={pathSessionsError}
            sessionsLoading={pathSessionsLoading}
            sessionsPath={pathSessionsPath}
            onBrowseSessions={onBrowseSessions}
            onOpenSession={onOpenListedSession}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

function RecentHostsPanel({
  hosts,
  onConnect,
  onRemove,
}: {
  hosts: RecentHost[];
  onConnect: (host: RecentHost) => void;
  onRemove: (host: RecentHost) => void;
}) {
  if (hosts.length === 0) {
    return null;
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Recent hosts</Text>
      {hosts.map(host => (
        <View key={host.hostUrl} style={styles.historyRow}>
          <View style={styles.historyTextBlock}>
            <Text numberOfLines={1} style={styles.historyTitle}>{host.hostUrl}</Text>
            <Text style={styles.dimLine}>last connected {formatTime(host.lastConnectedAt)}</Text>
          </View>
          <View style={styles.historyActions}>
            <PiButton
              accessibilityLabel={`Connect to ${host.hostUrl}`}
              label="Connect"
              onPress={() => onConnect(host)}
              variant="ghost"
            />
            <PiButton
              accessibilityLabel={`Remove recent host reference ${host.hostUrl} from this device`}
              label="Remove"
              onPress={() => onRemove(host)}
              variant="danger"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function RecentSessionsPanel({
  sessions,
  onRemove,
  onOpenNew,
  onOpenPrevious,
}: {
  sessions: RecentSession[];
  onRemove: (session: RecentSession) => void;
  onOpenNew: (session: RecentSession) => void;
  onOpenPrevious: (session: RecentSession) => void;
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Recent sessions</Text>
      {sessions.map(session => (
        <View key={`${session.hostUrl}:${session.cwd}:${session.sessionId}`} style={styles.sessionHistoryRow}>
          <Text numberOfLines={1} style={styles.historyTitle}>{session.title}</Text>
          <Text numberOfLines={1} style={styles.dimLine}>{session.cwd}</Text>
          <Text numberOfLines={1} style={styles.dimLine}>
            {session.hostUrl} · {shortSessionId(session.sessionId)}
          </Text>
          <View style={styles.historyActions}>
            <PiButton
              accessibilityLabel={`Open previous session ${session.sessionId}`}
              label="Open previous"
              onPress={() => onOpenPrevious(session)}
              variant="secondary"
            />
            <PiButton
              accessibilityLabel={`Open new session in ${session.cwd}`}
              label="New here"
              onPress={() => onOpenNew(session)}
              variant="ghost"
            />
            <PiButton
              accessibilityLabel={`Remove recent session reference ${session.sessionId} from this device`}
              label="Remove"
              onPress={() => onRemove(session)}
              variant="danger"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function PathExplorerPanel({
  connectionState,
  directoryList,
  directoryError,
  loading,
  onBrowseDirectory,
  onSelectCurrentPath,
}: {
  connectionState: AppViewState["connectionState"];
  directoryList: DirectoryList | undefined;
  directoryError: string | undefined;
  loading: boolean;
  onBrowseDirectory: (path: string) => void;
  onSelectCurrentPath: () => void;
}) {
  const connected = connectionState === "connected";

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Path explorer</Text>
      <Text numberOfLines={1} style={styles.pathExplorerCurrent}>
        {directoryList?.path ?? DOCUMENTS_DIRECTORY_PATH}
      </Text>
      <View style={styles.historyActions}>
        <PiButton
          accessibilityLabel="Browse home directory"
          disabled={!connected || loading}
          label="Home ~"
          onPress={() => onBrowseDirectory(HOME_DIRECTORY_PATH)}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Browse documents directory"
          disabled={!connected || loading}
          label="Documents"
          onPress={() => onBrowseDirectory(DOCUMENTS_DIRECTORY_PATH)}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Browse parent directory"
          disabled={!connected || loading || !directoryList?.parentPath}
          label="Up"
          onPress={() => directoryList?.parentPath ? onBrowseDirectory(directoryList.parentPath) : undefined}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Use current directory"
          disabled={!connected || !directoryList}
          label="Use this path"
          onPress={onSelectCurrentPath}
          variant="secondary"
        />
      </View>
      {!connected ? (
        <Text style={styles.dimLine}>Connect a host to browse directories from ~/Documents.</Text>
      ) : null}
      {loading ? <Text style={styles.statusLine}>Loading directories…</Text> : null}
      {directoryError ? <Text style={styles.errorLine}>{directoryError}</Text> : null}
      {connected && directoryList && !loading ? (
        <View style={styles.directoryList}>
          {directoryList.entries.length === 0 ? (
            <Text style={styles.dimLine}>No child directories.</Text>
          ) : (
            directoryList.entries.map(entry => (
              <Pressable
                accessibilityLabel={`Browse ${entry.name}`}
                accessibilityRole="button"
                key={entry.path}
                onPress={() => onBrowseDirectory(entry.path)}
                style={styles.directoryRow}
              >
                <Text numberOfLines={1} style={styles.directoryName}>▸ {entry.name}/</Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function PathSessionsPanel({
  connectionState,
  path,
  sessions,
  sessionsError,
  sessionsLoading,
  sessionsPath,
  onBrowseSessions,
  onOpenSession,
}: {
  connectionState: AppViewState["connectionState"];
  path: string;
  sessions: SessionSummary[];
  sessionsError: string | undefined;
  sessionsLoading: boolean;
  sessionsPath: string | undefined;
  onBrowseSessions: () => void;
  onOpenSession: (session: SessionSummary) => void;
}) {
  const connected = connectionState === "connected";
  const selectedPath = path.trim();
  const canBrowse = connected && selectedPath.length > 0;
  const displayedPath = (sessionsPath ?? selectedPath) || "Choose a path";
  const showEmpty = connected && !sessionsLoading && !sessionsError && sessionsPath && sessions.length === 0;

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Sessions for path</Text>
      <Text numberOfLines={1} style={styles.pathExplorerCurrent}>{displayedPath}</Text>
      <View style={styles.historyActions}>
        <PiButton
          accessibilityLabel="Refresh sessions for selected path"
          disabled={!canBrowse || sessionsLoading}
          label={sessionsLoading ? "Loading…" : "Refresh"}
          onPress={onBrowseSessions}
          variant="ghost"
        />
      </View>
      {!connected ? (
        <Text style={styles.dimLine}>Connect a host to browse stored sessions for a folder.</Text>
      ) : null}
      {connected && !selectedPath ? (
        <Text style={styles.dimLine}>Choose or paste a workspace path, then refresh sessions.</Text>
      ) : null}
      {sessionsError ? <Text style={styles.errorLine}>{sessionsError}</Text> : null}
      {showEmpty ? <Text style={styles.dimLine}>No stored sessions for this path.</Text> : null}
      {sessions.length > 0 ? (
        <View style={styles.directoryList}>
          {sessions.map(session => (
            <View key={session.sessionFile ?? session.id} style={styles.sessionHistoryRow}>
              <Text numberOfLines={1} style={styles.historyTitle}>{session.title}</Text>
              <Text numberOfLines={1} style={styles.dimLine}>{session.cwd}</Text>
              <Text numberOfLines={1} style={styles.dimLine}>
                {shortSessionId(session.id)} · {session.messageCount} messages · updated {formatTime(session.updatedAt)}
              </Text>
              <View style={styles.historyActions}>
                <PiButton
                  accessibilityLabel={`Continue stored session ${session.id}`}
                  disabled={!session.sessionFile}
                  label="Continue"
                  onPress={() => onOpenSession(session)}
                  variant="secondary"
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface SessionScreenProps {
  snapshot: SessionSnapshot;
  state: AppViewState;
  onShowConnection: () => void;
  onToggleHeader: () => void;
  onSendPrompt: () => void;
  onSteer: () => void;
  onFollowUp: () => void;
  onAbort: () => void;
  onPromptChange: (value: string) => void;
}

function SessionScreen({
  snapshot,
  state,
  onShowConnection,
  onToggleHeader,
  onSendPrompt,
  onSteer,
  onFollowUp,
  onAbort,
  onPromptChange,
}: SessionScreenProps) {
  const timelineRef = useRef<FlatList<TimelineItem>>(null);
  const userScrollActiveRef = useRef(false);
  const [timelinePinnedToBottom, setTimelinePinnedToBottom] = useState(true);
  const working = isWorking(snapshot.session.runState);

  const scrollTimelineToEnd = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      timelineRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const keepTimelineAtBottom = useCallback(() => {
    if (timelinePinnedToBottom && !userScrollActiveRef.current) {
      scrollTimelineToEnd(false);
    }
  }, [scrollTimelineToEnd, timelinePinnedToBottom]);

  useEffect(() => {
    keepTimelineAtBottom();
  }, [keepTimelineAtBottom, snapshot.timeline, working]);

  const updateTimelinePin = useCallback(
    (
      event: NativeSyntheticEvent<NativeScrollEvent>,
      userScrollActive: boolean,
    ) => {
      const metrics = timelineScrollMetricsFromEvent(event);
      setTimelinePinnedToBottom((current) =>
        nextPinnedToBottom(current, metrics, userScrollActive),
      );
    },
    [],
  );

  const handleTimelineScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateTimelinePin(event, userScrollActiveRef.current);
    },
    [updateTimelinePin],
  );

  const handleTimelineScrollBeginDrag = useCallback(() => {
    userScrollActiveRef.current = true;
  }, []);

  const handleTimelineScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateTimelinePin(event, true);
      userScrollActiveRef.current = false;
    },
    [updateTimelinePin],
  );

  const handleTimelineMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateTimelinePin(event, false);
      userScrollActiveRef.current = false;
    },
    [updateTimelinePin],
  );

  const pinTimelineToBottom = useCallback(() => {
    userScrollActiveRef.current = false;
    setTimelinePinnedToBottom(true);
    scrollTimelineToEnd(true);
  }, [scrollTimelineToEnd]);

  return (
    <KeyboardAvoidingView
      behavior={SESSION_KEYBOARD_BEHAVIOR}
      style={styles.sessionKeyboardView}
    >
      <View style={styles.sessionScreen}>
        <View style={styles.sessionHeader}>
          <View style={styles.headerTopRow}>
            <Text style={styles.sessionTitle}>
              Session: {shortSessionId(snapshot.session.id)}
            </Text>
            <View style={styles.headerActions}>
              <PiButton
                accessibilityLabel="Toggle Session Header"
                label={state.sessionHeaderCollapsed ? "Show" : "Hide"}
                onPress={onToggleHeader}
                variant="ghost"
              />
              <PiButton
                accessibilityLabel="Connection"
                label="Host"
                onPress={onShowConnection}
                variant="ghost"
              />
            </View>
          </View>
          {state.sessionHeaderCollapsed ? (
            <Text numberOfLines={1} style={styles.collapsedHeaderSummary}>
              {snapshot.session.cwd}
            </Text>
          ) : (
            <>
              <InfoRow label="Path" value={snapshot.session.cwd} />
              <InfoRow label="State" value={snapshot.session.runState} />
              <InfoRow
                label="Messages"
                value={String(snapshot.session.messageCount)}
              />
              {snapshot.session.thinkingLevel ? (
                <InfoRow
                  label="Thinking"
                  value={snapshot.session.thinkingLevel}
                />
              ) : null}
              {snapshot.session.model ? (
                <InfoRow
                  label="Model"
                  value={formatModel(snapshot.session.model)}
                />
              ) : null}
            </>
          )}
        </View>

        <View style={styles.timelineContainer}>
          <FlatList
            ref={timelineRef}
            data={snapshot.timeline}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <TimelineRow item={item} />}
            ListEmptyComponent={
              <Text style={styles.empty}>Send a prompt to start the timeline.</Text>
            }
            contentContainerStyle={styles.timelineContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => keepTimelineAtBottom()}
            onLayout={() => keepTimelineAtBottom()}
            onMomentumScrollEnd={handleTimelineMomentumEnd}
            onScroll={handleTimelineScroll}
            onScrollBeginDrag={handleTimelineScrollBeginDrag}
            onScrollEndDrag={handleTimelineScrollEndDrag}
            scrollEventThrottle={16}
            style={styles.timeline}
          />
          {working && !timelinePinnedToBottom ? (
            <Pressable
              accessibilityLabel="Stick timeline to bottom"
              accessibilityRole="button"
              hitSlop={12}
              onPress={pinTimelineToBottom}
              style={styles.pinTimelineButton}
            >
              <Text style={styles.pinTimelineButtonText}>↓</Text>
            </Pressable>
          ) : null}
        </View>

        {working ? <WorkingIndicator /> : null}

        <Composer
          cwd={snapshot.session.cwd}
          onAbort={onAbort}
          onFollowUp={onFollowUp}
          onPromptChange={onPromptChange}
          onSendPrompt={onSendPrompt}
          onSteer={onSteer}
          prompt={state.prompt}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function timelineScrollMetricsFromEvent(
  event: NativeSyntheticEvent<NativeScrollEvent>,
): TimelineScrollMetrics {
  return {
    contentHeight: event.nativeEvent.contentSize.height,
    layoutHeight: event.nativeEvent.layoutMeasurement.height,
    offsetY: event.nativeEvent.contentOffset.y,
  };
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}:</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const WORKING_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];
const WORKING_SPINNER_INTERVAL_MS = 80;

function WorkingIndicator() {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setFrameIndex((index) => (index + 1) % WORKING_SPINNER_FRAMES.length);
    }, WORKING_SPINNER_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <View style={styles.workingIndicator}>
      <Text style={styles.workingGlyph}>
        {WORKING_SPINNER_FRAMES[frameIndex]}
      </Text>
      <Text style={styles.workingText}>Working...</Text>
    </View>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "status") {
    return (
      <Text style={[styles.statusItem, statusToneStyle(item.tone)]}>
        {formatTime(item.createdAt)} {item.text}
      </Text>
    );
  }

  if (item.kind === "tool") {
    return <ToolTimelineItem item={item} />;
  }

  if (item.kind === "assistant") {
    return (
      <View style={styles.assistantMessage}>
        <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
        <MarkdownText text={item.text} />
      </View>
    );
  }

  if (item.kind === "thinking") {
    return (
      <View style={styles.thinkingBlock}>
        <MarkdownText text={item.text} thinking />
      </View>
    );
  }

  return (
    <View style={styles.userMessage}>
      <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
      <MarkdownText text={item.text} />
    </View>
  );
}

type ToolTimelineItemData = Extract<TimelineItem, { kind: "tool" }>;

function ToolTimelineItem({ item }: { item: ToolTimelineItemData }) {
  if (item.title === "bash") {
    return <BashToolCard item={item} />;
  }

  if (item.title === "read") {
    return <ReadToolCard item={item} />;
  }

  return <GenericToolCard item={item} />;
}

function BashToolCard({ item }: { item: ToolTimelineItemData }) {
  const call = getBashCallParts(item.args);
  const output = item.detail ? normalizeBashOutput(item.detail) : "";

  return (
    <ToolCard item={item}>
      <Text style={styles.toolCallLine}>
        <Text
          style={call.invalidCommand ? styles.toolErrorText : styles.toolName}
        >
          {call.commandText}
        </Text>
        {call.timeoutText ? (
          <Text style={styles.toolMutedSuffix}> {call.timeoutText}</Text>
        ) : null}
      </Text>
      <ToolArguments args={item.args} />
      {output ? <PlainToolOutput text={output} /> : null}
    </ToolCard>
  );
}

function ReadToolCard({ item }: { item: ToolTimelineItemData }) {
  const call = getReadCallParts(item.args);
  const output = item.detail ? normalizeReadOutput(item.detail) : "";

  return (
    <ToolCard item={item}>
      <Text style={styles.toolCallLine}>
        <Text style={styles.toolName}>read</Text>{" "}
        <Text style={call.invalidPath ? styles.toolErrorText : styles.toolPath}>
          {call.pathText}
        </Text>
        {call.lineRangeText ? (
          <Text style={styles.toolLineRange}>{call.lineRangeText}</Text>
        ) : null}
      </Text>
      <ToolArguments args={item.args} />
      {output ? (
        <ReadToolOutput language={getReadLanguage(item.args)} text={output} />
      ) : null}
    </ToolCard>
  );
}

function GenericToolCard({ item }: { item: ToolTimelineItemData }) {
  const output = item.detail ? replaceTabs(item.detail) : "";

  return (
    <ToolCard item={item}>
      <Text style={styles.toolCallLine}>{toolTitle(item.title, item.status)}</Text>
      <ToolArguments args={item.args} />
      {output ? <PlainToolOutput text={output} /> : null}
    </ToolCard>
  );
}

function ToolCard({
  children,
  item,
}: {
  children: ReactNode;
  item: ToolTimelineItemData;
}) {
  return (
    <View style={[styles.toolCard, toolCardStyle(item.status)]}>
      <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
      {children}
    </View>
  );
}

function ToolArguments({ args }: { args: JsonValue | undefined }) {
  if (args === undefined) {
    return null;
  }

  return (
    <ToolSection label="Arguments">
      <Text style={styles.toolArgsText}>{formatJson(args)}</Text>
    </ToolSection>
  );
}

function PlainToolOutput({ text }: { text: string }) {
  return (
    <ToolSection label="Output">
      <Text style={styles.toolOutputText}>{text}</Text>
    </ToolSection>
  );
}

function ReadToolOutput({
  language,
  text,
}: {
  language: string | undefined;
  text: string;
}) {
  if (!language) {
    return <PlainToolOutput text={text} />;
  }

  return (
    <ToolSection label="Output">
      <CodeHighlighter
        hljsStyle={piSyntaxStyle}
        language={language}
        scrollViewProps={{
          contentContainerStyle: styles.syntaxHighlighterContent,
          style: styles.syntaxHighlighterScroll,
        }}
        textStyle={styles.syntaxHighlighterText}
        wrapLongLines
      >
        {text}
      </CodeHighlighter>
    </ToolSection>
  );
}

function ToolSection({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.toolSection}>
      <Pressable
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} tool ${label.toLowerCase()}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        hitSlop={8}
        onPress={() => setExpanded((value) => !value)}
        style={styles.toolSectionHeader}
      >
        <Text style={styles.toolSectionChevron}>{expanded ? "▾" : "▸"}</Text>
        <Text style={styles.toolSectionLabel}>{label}</Text>
        <Text style={styles.toolSectionHint}>{expanded ? "hide" : "show"}</Text>
      </Pressable>
      {expanded ? <View style={styles.toolCodeBlock}>{children}</View> : null}
    </View>
  );
}

function MarkdownText({
  text,
  thinking = false,
}: {
  text: string;
  thinking?: boolean;
}) {
  return (
    <Markdown style={thinking ? thinkingMarkdownStyles : markdownStyles}>
      {text}
    </Markdown>
  );
}

interface ComposerProps {
  cwd: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSendPrompt: () => void;
  onSteer: () => void;
  onFollowUp: () => void;
  onAbort: () => void;
}

function Composer({
  cwd,
  prompt,
  onPromptChange,
  onSendPrompt,
  onSteer,
  onFollowUp,
  onAbort,
}: ComposerProps) {
  return (
    <View style={styles.composer}>
      <TextInput
        accessibilityLabel="Prompt"
        multiline
        placeholder="Ask pi to do something…"
        placeholderTextColor={palette.dim}
        value={prompt}
        onChangeText={onPromptChange}
        style={styles.promptInput}
      />
      <View style={styles.commandRow}>
        <PiButton
          accessibilityLabel="Send"
          label="Send"
          onPress={onSendPrompt}
          variant="primary"
        />
        <PiButton
          accessibilityLabel="Steer"
          label="Steer"
          onPress={onSteer}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Follow Up"
          label="Follow-up"
          onPress={onFollowUp}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Abort"
          label="Abort"
          onPress={onAbort}
          variant="danger"
        />
      </View>
      <Text numberOfLines={1} style={styles.composerFooter}>
        {cwd} · mobile · sdk
      </Text>
    </View>
  );
}

interface PiButtonProps {
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
  variant: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
}

function PiButton({
  accessibilityLabel,
  disabled = false,
  label,
  onPress,
  variant,
}: PiButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.piButton,
        buttonVariantStyle(variant),
        disabled ? styles.disabledButton : null,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === "primary" ? styles.primaryButtonText : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function buttonVariantStyle(variant: PiButtonProps["variant"]) {
  switch (variant) {
    case "primary":
      return styles.primaryButton;
    case "secondary":
      return styles.secondaryButton;
    case "danger":
      return styles.dangerButton;
    case "ghost":
      return styles.ghostButton;
  }
}

function toolCardStyle(status: "running" | "done" | "error") {
  switch (status) {
    case "running":
      return styles.toolPending;
    case "done":
      return styles.toolSuccess;
    case "error":
      return styles.toolError;
  }
}

function statusToneStyle(tone: "info" | "success" | "warning" | "error") {
  switch (tone) {
    case "info":
      return styles.statusInfo;
    case "success":
      return styles.statusSuccess;
    case "warning":
      return styles.statusWarning;
    case "error":
      return styles.statusError;
  }
}

function isWorking(runState: SessionSnapshot["session"]["runState"]): boolean {
  return runState === "streaming" || runState === "compacting";
}

function shortSessionId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function toolTitle(
  title: string,
  status: "running" | "done" | "error",
): string {
  if (title === "bash") {
    return status === "running" ? "Running command..." : "Command result";
  }
  return `${title} · ${status}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatModel(model: unknown): string {
  if (typeof model === "string") {
    return model;
  }

  if (model && typeof model === "object" && !Array.isArray(model)) {
    const fields = model as Record<string, unknown>;
    const id = typeof fields.id === "string" ? fields.id : undefined;
    const provider =
      typeof fields.provider === "string" ? fields.provider : undefined;
    const name = typeof fields.name === "string" ? fields.name : undefined;
    if (id && provider) return `${provider}/${id}`;
    if (id) return id;
    if (name) return name;
  }

  return JSON.stringify(model);
}

const palette = {
  accent: "#8abeb7",
  border: "#5f87ff",
  borderAccent: "#00d7ff",
  bodyBg: "#18181e",
  containerBg: "#1e1e24",
  customBg: "#2d2838",
  customLabel: "#9575cd",
  dim: "#666666",
  error: "#cc6666",
  mdCode: "#8abeb7",
  mdCodeBlock: "#b5bd68",
  mdCodeBlockBorder: "#808080",
  mdHeading: "#f0c674",
  mdHr: "#808080",
  mdLink: "#81a2be",
  mdListBullet: "#8abeb7",
  mdQuote: "#808080",
  mdQuoteBorder: "#808080",
  muted: "#808080",
  syntaxComment: "#6A9955",
  syntaxFunction: "#DCDCAA",
  syntaxKeyword: "#569CD6",
  syntaxNumber: "#B5CEA8",
  syntaxOperator: "#D4D4D4",
  syntaxPunctuation: "#D4D4D4",
  syntaxString: "#CE9178",
  syntaxType: "#4EC9B0",
  syntaxVariable: "#9CDCFE",
  text: "#e5e5e7",
  toolError: "#3c2828",
  toolPending: "#282832",
  toolSuccess: "#283228",
  userBg: "#343541",
  warning: "#ffff00",
};

const monoText = {
  color: palette.text,
  fontFamily: MONO_FONT,
};

const piSyntaxStyle: ReactStyle = {
  hljs: {
    background: palette.bodyBg,
    color: palette.mdCodeBlock,
  },
  "hljs-addition": { color: palette.accent },
  "hljs-attr": { color: palette.syntaxVariable },
  "hljs-attribute": { color: palette.syntaxVariable },
  "hljs-built_in": { color: palette.syntaxType },
  "hljs-bullet": { color: palette.mdListBullet },
  "hljs-comment": { color: palette.syntaxComment },
  "hljs-deletion": { color: palette.error },
  "hljs-doctag": { color: palette.syntaxKeyword },
  "hljs-function": { color: palette.syntaxFunction },
  "hljs-keyword": { color: palette.syntaxKeyword },
  "hljs-literal": { color: palette.syntaxKeyword },
  "hljs-meta": { color: palette.syntaxComment },
  "hljs-name": { color: palette.syntaxKeyword },
  "hljs-number": { color: palette.syntaxNumber },
  "hljs-operator": { color: palette.syntaxOperator },
  "hljs-params": { color: palette.text },
  "hljs-property": { color: palette.syntaxVariable },
  "hljs-punctuation": { color: palette.syntaxPunctuation },
  "hljs-quote": { color: palette.syntaxComment },
  "hljs-regexp": { color: palette.syntaxString },
  "hljs-section": { color: palette.syntaxFunction },
  "hljs-selector-class": { color: palette.syntaxType },
  "hljs-selector-id": { color: palette.syntaxType },
  "hljs-selector-tag": { color: palette.syntaxKeyword },
  "hljs-string": { color: palette.syntaxString },
  "hljs-symbol": { color: palette.syntaxVariable },
  "hljs-tag": { color: palette.syntaxKeyword },
  "hljs-template-variable": { color: palette.syntaxVariable },
  "hljs-title": { color: palette.syntaxFunction },
  "hljs-type": { color: palette.syntaxType },
  "hljs-variable": { color: palette.syntaxVariable },
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bodyBg },
  sessionKeyboardView: { flex: 1 },
  connectionScroll: { flex: 1 },
  connectionScreen: { gap: 18, padding: 18, paddingBottom: 28 },
  brandHeader: { gap: 6 },
  appTitle: {
    ...monoText,
    color: palette.borderAccent,
    fontSize: 30,
    fontWeight: "800",
  },
  helpText: {
    ...monoText,
    color: palette.warning,
    fontSize: 14,
    lineHeight: 21,
  },
  panel: {
    backgroundColor: palette.containerBg,
    borderRadius: 4,
    gap: 10,
    padding: 18,
  },
  panelTitle: {
    ...monoText,
    color: palette.customLabel,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  label: { ...monoText, color: palette.muted, fontSize: 12, fontWeight: "700" },
  input: {
    ...monoText,
    backgroundColor: palette.userBg,
    borderColor: palette.dim,
    borderRadius: 4,
    borderWidth: 1,
    color: palette.text,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusLine: { ...monoText, color: palette.accent, fontSize: 12 },
  dimLine: { ...monoText, color: palette.dim, fontSize: 12, lineHeight: 18 },
  warningLine: {
    ...monoText,
    color: palette.warning,
    fontSize: 12,
    lineHeight: 18,
  },
  errorLine: {
    ...monoText,
    color: palette.error,
    fontSize: 12,
    lineHeight: 18,
  },
  historyRow: {
    alignItems: "center",
    borderColor: palette.dim,
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  sessionHistoryRow: {
    borderColor: palette.dim,
    borderRadius: 4,
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  historyTextBlock: { flex: 1, gap: 2 },
  historyTitle: {
    ...monoText,
    color: palette.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
  },
  historyActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pathExplorerCurrent: {
    ...monoText,
    color: palette.accent,
    fontSize: 12,
    lineHeight: 18,
  },
  directoryList: { gap: 6 },
  directoryRow: {
    backgroundColor: palette.userBg,
    borderColor: palette.dim,
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  directoryName: {
    ...monoText,
    color: palette.text,
    fontSize: 13,
    lineHeight: 19,
  },
  sessionScreen: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  sessionHeader: {
    backgroundColor: palette.containerBg,
    borderRadius: 4,
    gap: 6,
    padding: 18,
  },
  headerTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  headerActions: { flexDirection: "row", gap: 8 },
  sessionTitle: {
    ...monoText,
    color: palette.borderAccent,
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
  },
  collapsedHeaderSummary: {
    ...monoText,
    color: palette.dim,
    fontSize: 12,
    lineHeight: 18,
  },
  infoRow: { alignItems: "baseline", flexDirection: "row", gap: 8 },
  infoLabel: {
    ...monoText,
    color: palette.dim,
    fontSize: 12,
    fontWeight: "800",
    minWidth: 74,
  },
  infoValue: {
    ...monoText,
    color: palette.text,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  timelineContainer: { flex: 1 },
  timeline: { flex: 1 },
  timelineContent: { gap: 18, paddingVertical: 18 },
  pinTimelineButton: {
    alignItems: "center",
    backgroundColor: palette.borderAccent,
    borderColor: palette.bodyBg,
    borderRadius: 18,
    borderWidth: 1,
    bottom: 14,
    height: 36,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    width: 36,
  },
  pinTimelineButtonText: {
    ...monoText,
    color: palette.bodyBg,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24,
  },
  workingIndicator: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  workingGlyph: {
    ...monoText,
    color: palette.accent,
    fontSize: 16,
    lineHeight: 24,
    minWidth: 18,
  },
  workingText: {
    ...monoText,
    color: palette.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  empty: { ...monoText, color: palette.muted, fontSize: 14, padding: 18 },
  timestamp: { ...monoText, color: palette.dim, fontSize: 11, marginBottom: 8 },
  statusItem: {
    ...monoText,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 18,
  },
  statusInfo: { color: palette.dim },
  statusSuccess: { color: palette.accent },
  statusWarning: { color: palette.warning },
  statusError: { color: palette.error },
  userMessage: {
    backgroundColor: palette.userBg,
    borderRadius: 4,
    padding: 18,
  },
  assistantMessage: { paddingHorizontal: 18 },
  thinkingBlock: { padding: 18 },
  thinkingText: {
    ...monoText,
    color: palette.muted,
    fontSize: 15,
    fontStyle: "italic",
    lineHeight: 24,
  },
  messageText: { ...monoText, fontSize: 15, fontWeight: "700", lineHeight: 24 },
  toolCard: { borderRadius: 4, padding: 18 },
  toolPending: { backgroundColor: palette.toolPending },
  toolSuccess: { backgroundColor: palette.toolSuccess },
  toolError: { backgroundColor: palette.toolError },
  toolCallLine: {
    ...monoText,
    color: palette.text,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 24,
  },
  toolName: { color: palette.text, fontWeight: "800" },
  toolPath: { color: palette.accent, fontWeight: "400" },
  toolLineRange: { color: palette.warning, fontWeight: "400" },
  toolMutedSuffix: { color: palette.muted, fontWeight: "400" },
  toolErrorText: { color: palette.error, fontWeight: "800" },
  toolSection: { gap: 6, marginTop: 10 },
  toolSectionHeader: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2,
  },
  toolSectionChevron: {
    ...monoText,
    color: palette.accent,
    fontSize: 12,
    fontWeight: "800",
    minWidth: 12,
  },
  toolSectionLabel: {
    ...monoText,
    color: palette.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  toolSectionHint: {
    ...monoText,
    color: palette.dim,
    fontSize: 11,
  },
  toolCodeBlock: {
    backgroundColor: palette.bodyBg,
    borderRadius: 4,
    padding: 10,
  },
  toolArgsText: {
    ...monoText,
    color: palette.dim,
    fontSize: 12,
    lineHeight: 18,
  },
  toolOutputText: {
    ...monoText,
    color: palette.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  syntaxHighlighterContent: {
    backgroundColor: palette.bodyBg,
    minWidth: "100%",
  },
  syntaxHighlighterScroll: {
    backgroundColor: palette.bodyBg,
    width: "100%",
  },
  syntaxHighlighterText: {
    fontFamily: MONO_FONT,
    fontSize: 13,
    lineHeight: 20,
  },
  composer: { gap: 8, paddingBottom: 10 },
  promptInput: {
    ...monoText,
    backgroundColor: palette.userBg,
    borderBottomColor: palette.customLabel,
    borderBottomWidth: 1,
    borderTopColor: palette.customLabel,
    borderTopWidth: 1,
    color: palette.text,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 86,
    paddingHorizontal: 10,
    paddingVertical: 12,
    textAlignVertical: "top",
  },
  commandRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  composerFooter: {
    ...monoText,
    color: palette.dim,
    fontSize: 12,
    lineHeight: 18,
  },
  piButton: {
    alignItems: "center",
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  primaryButton: {
    backgroundColor: palette.borderAccent,
    borderColor: palette.borderAccent,
  },
  secondaryButton: {
    backgroundColor: "transparent",
    borderColor: palette.border,
  },
  ghostButton: { backgroundColor: "transparent", borderColor: palette.border },
  dangerButton: { backgroundColor: "transparent", borderColor: palette.error },
  disabledButton: { opacity: 0.45 },
  buttonText: {
    ...monoText,
    color: palette.text,
    fontSize: 12,
    fontWeight: "800",
  },
  primaryButtonText: { color: palette.bodyBg },
});

const markdownStyles = StyleSheet.create({
  body: {
    ...monoText,
    color: palette.text,
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 24,
  },
  text: { ...monoText, color: palette.text, fontWeight: "400" },
  paragraph: { marginBottom: 0, marginTop: 0 },
  heading1: {
    ...monoText,
    color: palette.mdHeading,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 24,
    marginBottom: 0,
    marginTop: 12,
    textDecorationLine: "underline",
  },
  heading2: {
    ...monoText,
    color: palette.mdHeading,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 24,
    marginBottom: 0,
    marginTop: 12,
  },
  heading3: {
    ...monoText,
    color: palette.mdHeading,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 24,
    marginBottom: 0,
    marginTop: 12,
  },
  bullet_list: { marginBottom: 0, marginTop: 8 },
  ordered_list: { marginBottom: 0, marginTop: 8 },
  list_item: { marginBottom: 0 },
  bullet_list_icon: { color: palette.mdListBullet },
  ordered_list_icon: { color: palette.mdListBullet },
  code_inline: {
    ...monoText,
    backgroundColor: "transparent",
    borderWidth: 0,
    color: palette.mdCode,
    fontSize: 14,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  code_block: {
    ...monoText,
    backgroundColor: "transparent",
    borderColor: palette.mdCodeBlockBorder,
    borderRadius: 4,
    borderWidth: 1,
    color: palette.mdCodeBlock,
    fontSize: 13,
    lineHeight: 20,
    padding: 10,
  },
  fence: {
    ...monoText,
    backgroundColor: "transparent",
    borderColor: palette.mdCodeBlockBorder,
    borderRadius: 4,
    borderWidth: 1,
    color: palette.mdCodeBlock,
    fontSize: 13,
    lineHeight: 20,
    padding: 10,
  },
  blockquote: {
    backgroundColor: "transparent",
    borderColor: palette.mdQuoteBorder,
    borderLeftColor: palette.mdQuoteBorder,
    borderLeftWidth: 3,
    color: palette.mdQuote,
    fontStyle: "italic",
    marginBottom: 0,
    marginLeft: 0,
    marginTop: 8,
    paddingHorizontal: 0,
    paddingLeft: 10,
  },
  link: { color: palette.mdLink, textDecorationLine: "underline" },
  strong: { fontWeight: "800" },
  em: { fontStyle: "italic" },
  hr: { backgroundColor: palette.mdHr, height: 1 },
});

const thinkingMarkdownStyles = StyleSheet.create({
  ...markdownStyles,
  body: {
    ...monoText,
    color: palette.muted,
    fontSize: 15,
    fontStyle: "italic",
    lineHeight: 24,
  },
  text: { color: palette.muted, fontStyle: "italic" },
  code_inline: {
    ...monoText,
    backgroundColor: "transparent",
    borderWidth: 0,
    color: palette.muted,
    fontSize: 14,
    fontStyle: "italic",
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  fence: {
    ...monoText,
    backgroundColor: "transparent",
    borderColor: palette.mdCodeBlockBorder,
    borderRadius: 4,
    borderWidth: 1,
    color: palette.muted,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 20,
    padding: 10,
  },
  code_block: {
    ...monoText,
    backgroundColor: "transparent",
    borderColor: palette.mdCodeBlockBorder,
    borderRadius: 4,
    borderWidth: 1,
    color: palette.muted,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 20,
    padding: 10,
  },
  blockquote: {
    backgroundColor: "transparent",
    borderColor: palette.mdQuoteBorder,
    borderLeftColor: palette.mdQuoteBorder,
    borderLeftWidth: 3,
    color: palette.muted,
    fontStyle: "italic",
    marginBottom: 0,
    marginLeft: 0,
    marginTop: 8,
    paddingHorizontal: 0,
    paddingLeft: 10,
  },
});
