import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import CodeHighlighter, { type ReactStyle } from "react-native-code-highlighter";
import Markdown from "react-native-markdown-display";
import { Stack, useRouter } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
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

interface PiMobileProviderProps {
  children: ReactNode;
}

interface PiMobileContextValue {
  state: AppViewState;
  history: ClientHistory;
  directoryList: DirectoryList | undefined;
  directoryLoading: boolean;
  directoryError: string | undefined;
  pathSessions: SessionSummary[];
  pathSessionsPath: string | undefined;
  pathSessionsLoading: boolean;
  pathSessionsError: string | undefined;
  activeSession: SessionSnapshot | undefined;
  browseDirectory: (path?: string) => Promise<DirectoryList | undefined>;
  browseSessionsForSelectedPath: () => Promise<SessionSummary[]>;
  connect: () => Promise<boolean>;
  connectToRecentHost: (host: RecentHost) => Promise<boolean>;
  openListedSession: (session: SessionSummary) => Promise<boolean>;
  openNewSessionFromHistory: (session: RecentSession) => Promise<boolean>;
  openPreviousSession: (session: RecentSession) => Promise<boolean>;
  openSession: () => Promise<boolean>;
  removeRecentHost: (host: RecentHost) => void;
  removeRecentSession: (session: RecentSession) => void;
  selectExplorerPath: () => void;
  sendPrompt: () => Promise<void>;
  setCwd: (value: string) => void;
  setHostUrl: (value: string) => void;
  setPrompt: (value: string) => void;
  setToken: (value: string) => void;
  showConnection: () => void;
  steer: () => Promise<void>;
  followUp: () => Promise<void>;
  abort: () => Promise<void>;
  toggleSessionHeader: () => void;
}

const PiMobileContext = createContext<PiMobileContextValue | undefined>(undefined);

interface RawTextSelection {
  title: string;
  text: string;
}

function useLoadingAction() {
  const [loadingAction, setLoadingAction] = useState<string | undefined>();
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runLoadingAction = useCallback(
    async <Result,>(key: string, action: () => Promise<Result>) => {
      setLoadingAction(key);
      try {
        return await action();
      } finally {
        if (mountedRef.current) {
          setLoadingAction((current) => current === key ? undefined : current);
        }
      }
    },
    [],
  );

  return { loadingAction, runLoadingAction };
}

function recentSessionActionKey(action: "new" | "previous", session: RecentSession): string {
  return `${action}:${session.hostUrl}:${session.cwd}:${session.sessionId}`;
}

function recentHostActionKey(host: RecentHost): string {
  return `connect:${host.hostUrl}`;
}

function pathSessionActionKey(session: SessionSummary): string {
  return `open:${session.sessionFile ?? session.id}`;
}

export default function App() {
  return (
    <PiMobileProvider>
      <HomeScreen />
    </PiMobileProvider>
  );
}

export function PiMobileProvider({ children }: PiMobileProviderProps) {
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
      return true;
    } catch (error) {
      dispatch({ type: "disconnected", errorMessage: toErrorMessage(error) });
      return false;
    }
  };

  const connectToRecentHost = async (host: RecentHost) => {
    try {
      await connectToHost(host.hostUrl);
      return true;
    } catch (error) {
      dispatch({ type: "disconnected", errorMessage: toErrorMessage(error) });
      return false;
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
    if (!state.cwd.trim()) return false;
    try {
      await openNewSession(client, normalizeHistoryHostUrl(state.hostUrl), state.cwd.trim());
      return true;
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
      return false;
    }
  };

  const openNewSessionFromHistory = async (session: RecentSession) => {
    try {
      const sessionClient = await connectToHost(session.hostUrl);
      dispatch({ type: "setCwd", value: session.cwd });
      await openNewSession(sessionClient, session.hostUrl, session.cwd);
      return true;
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
      return false;
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
      return true;
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
      return false;
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
      return true;
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
      return false;
    }
  };

  const browseSessionsForSelectedPath = async () => {
    return browseSessionsForPath(client, state.cwd);
  };

  const selectExplorerPath = () => {
    if (directoryList) {
      dispatch({ type: "setCwd", value: directoryList.path });
    }
  };

  const sendPrompt = async () => {
    if (!activeSession || !state.prompt.trim()) return;
    try {
      await client.prompt(activeSession.session.id, { message: state.prompt });
      dispatch({ type: "clearPrompt" });
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    }
  };

  const steer = async () => {
    if (!activeSession || !state.prompt.trim()) return;
    try {
      await client.steer(activeSession.session.id, { message: state.prompt });
      dispatch({ type: "clearPrompt" });
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    }
  };

  const followUp = async () => {
    if (!activeSession || !state.prompt.trim()) return;
    try {
      await client.followUp(activeSession.session.id, { message: state.prompt });
      dispatch({ type: "clearPrompt" });
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    }
  };

  const abort = async () => {
    if (!activeSession) return;
    try {
      await client.abort(activeSession.session.id);
    } catch (error) {
      dispatch({ type: "setError", message: toErrorMessage(error) });
    }
  };

  const contextValue: PiMobileContextValue = {
    state,
    history,
    directoryList,
    directoryLoading,
    directoryError,
    pathSessions,
    pathSessionsPath,
    pathSessionsLoading,
    pathSessionsError,
    activeSession,
    browseDirectory: (path) => browseDirectories(client, path),
    browseSessionsForSelectedPath,
    connect,
    connectToRecentHost,
    openListedSession,
    openNewSessionFromHistory,
    openPreviousSession,
    openSession,
    removeRecentHost,
    removeRecentSession,
    selectExplorerPath,
    sendPrompt,
    setCwd: (value) => dispatch({ type: "setCwd", value }),
    setHostUrl: (value) => dispatch({ type: "setHostUrl", value }),
    setPrompt: (value) => dispatch({ type: "setPrompt", value }),
    setToken: (value) => dispatch({ type: "setToken", value }),
    showConnection: () => dispatch({ type: "showConnection" }),
    steer,
    followUp,
    abort,
    toggleSessionHeader: () => dispatch({ type: "toggleSessionHeader" }),
  };

  return (
    <PiMobileContext.Provider value={contextValue}>
      <View style={styles.screen}>{children}</View>
    </PiMobileContext.Provider>
  );
}

export function usePiMobile(): PiMobileContextValue {
  const context = useContext(PiMobileContext);
  if (!context) {
    throw new Error("usePiMobile must be used inside PiMobileProvider");
  }
  return context;
}

export function HomeScreen() {
  const router = useRouter();
  const {
    activeSession,
    connectToRecentHost,
    history,
    openNewSessionFromHistory,
    openPreviousSession,
    removeRecentHost,
    removeRecentSession,
    state,
  } = usePiMobile();
  const { loadingAction, runLoadingAction } = useLoadingAction();
  const hasHistory = history.hosts.length > 0 || history.sessions.length > 0;

  const openRecentSession = async (
    session: RecentSession,
    openSessionFromHistory: (session: RecentSession) => Promise<boolean>,
  ) => {
    if (await openSessionFromHistory(session)) {
      router.push("/session");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.connectionScreen}
      keyboardShouldPersistTaps="handled"
      style={styles.connectionScroll}
    >
      <View style={styles.brandHeader}>
        <Text style={styles.appTitle}>Pi Mobile</Text>
        <Text style={styles.helpText}>Phone navigation for hosts, workspaces, sessions, and active chat.</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Go to</Text>
        <Text style={styles.dimLine}>
          Setup is split into mobile pages now instead of one long web-style form.
        </Text>
        <View style={styles.historyActions}>
          {activeSession ? (
            <PiButton
              accessibilityLabel="Open active session"
              label="Active session"
              onPress={() => router.push("/session")}
              variant="primary"
            />
          ) : null}
          <PiButton
            accessibilityLabel="Connect host page"
            label={state.connectionState === "connected" ? "Host" : "Connect host"}
            onPress={() => router.push("/connect")}
            variant={state.connectionState === "connected" ? "secondary" : "primary"}
          />
          <PiButton
            accessibilityLabel="Workspace page"
            disabled={state.connectionState !== "connected"}
            label="Workspace"
            onPress={() => router.push("/workspace")}
            variant="secondary"
          />
        </View>
        <Text style={styles.statusLine}>Status: {state.connectionState}</Text>
        {state.client.connectionMessage ? (
          <Text style={styles.dimLine}>{state.client.connectionMessage}</Text>
        ) : null}
        {state.errorMessage ? <Text style={styles.errorLine}>{state.errorMessage}</Text> : null}
      </View>

      <RecentSessionsPanel
        loadingAction={loadingAction}
        sessions={history.sessions}
        onRemove={removeRecentSession}
        onOpenNew={(session) => void runLoadingAction(
          recentSessionActionKey("new", session),
          () => openRecentSession(session, openNewSessionFromHistory),
        )}
        onOpenPrevious={(session) => void runLoadingAction(
          recentSessionActionKey("previous", session),
          () => openRecentSession(session, openPreviousSession),
        )}
      />
      <RecentHostsPanel
        hosts={history.hosts}
        loadingAction={loadingAction}
        onConnect={(host) => void runLoadingAction(recentHostActionKey(host), async () => {
          if (await connectToRecentHost(host)) {
            router.push("/workspace");
          }
        })}
        onRemove={removeRecentHost}
      />

      {!hasHistory ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Start here</Text>
          <Text style={styles.dimLine}>
            Connect a host first. Then choose a workspace, browse stored sessions, or open a new session from dedicated pages.
          </Text>
          <PiButton
            accessibilityLabel="Start host connection"
            label="Connect host"
            onPress={() => router.push("/connect")}
            variant="primary"
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

export function ConnectHostScreen() {
  const router = useRouter();
  const { connect, setHostUrl, setToken, state } = usePiMobile();
  const { loadingAction, runLoadingAction } = useLoadingAction();
  const connectLoading = state.connectionState === "connecting" || loadingAction === "connect";

  return (
    <ScrollView
      contentContainerStyle={styles.connectionScreen}
      keyboardShouldPersistTaps="handled"
      style={styles.connectionScroll}
    >
      <View style={styles.brandHeader}>
        <Text style={styles.appTitle}>Host</Text>
        <Text style={styles.helpText}>Connect to the machine running the Pi mobile host daemon.</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Connect to host</Text>
        <Text style={styles.label}>Host URL</Text>
        <TextInput
          accessibilityLabel="Host URL"
          autoCapitalize="none"
          value={state.hostUrl}
          onChangeText={setHostUrl}
          style={styles.input}
        />
        <Text style={styles.label}>Bearer token (optional)</Text>
        <TextInput
          accessibilityLabel="Host Token"
          autoCapitalize="none"
          secureTextEntry
          value={state.token}
          onChangeText={setToken}
          style={styles.input}
        />
        <PiButton
          accessibilityLabel="Connect"
          disabled={connectLoading}
          label="Connect host"
          loading={connectLoading}
          onPress={() => void runLoadingAction("connect", async () => {
            if (await connect()) {
              router.replace("/workspace");
            }
          })}
          variant="primary"
        />
        <Text style={styles.statusLine}>Status: {state.connectionState}</Text>
        {state.client.connectionMessage ? (
          <Text style={styles.dimLine}>{state.client.connectionMessage}</Text>
        ) : null}
        {state.errorMessage ? <Text style={styles.errorLine}>{state.errorMessage}</Text> : null}
      </View>
    </ScrollView>
  );
}

export function WorkspaceScreen() {
  const router = useRouter();
  const {
    browseSessionsForSelectedPath,
    openSession,
    pathSessionsLoading,
    setCwd,
    state,
  } = usePiMobile();
  const { loadingAction, runLoadingAction } = useLoadingAction();
  const openSessionLoading = loadingAction === "open-session";
  const browseSessionsLoading = pathSessionsLoading || loadingAction === "browse-sessions";
  const pathIsOpenable = state.cwd.trim().length === 0 || isHostWorkspacePath(state.cwd);
  const canBrowse = state.connectionState === "connected" && state.cwd.trim().length > 0;
  const canOpenSession = canBrowse && pathIsOpenable;

  return (
    <ScrollView
      contentContainerStyle={styles.connectionScreen}
      keyboardShouldPersistTaps="handled"
      style={styles.connectionScroll}
    >
      <View style={styles.brandHeader}>
        <Text style={styles.appTitle}>Workspace</Text>
        <Text style={styles.helpText}>Choose the project path before opening or resuming a session.</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Selected host path</Text>
        <TextInput
          accessibilityLabel="Session Path"
          autoCapitalize="none"
          placeholder="Connect, browse, or paste /absolute/path"
          placeholderTextColor={palette.dim}
          value={state.cwd}
          onChangeText={setCwd}
          style={styles.input}
        />
        <Text style={pathIsOpenable ? styles.dimLine : styles.warningLine}>
          {pathIsOpenable
            ? "Documents is the default. You can also paste an absolute or ~/ path."
            : "Use an absolute or ~/ host path before opening a session."}
        </Text>
        {state.connectionState !== "connected" ? (
          <Text style={styles.warningLine}>Connect a host before browsing or opening sessions.</Text>
        ) : null}
        {state.errorMessage ? <Text style={styles.errorLine}>{state.errorMessage}</Text> : null}
        <View style={styles.historyActions}>
          <PiButton
            accessibilityLabel="Open new session"
            disabled={!canOpenSession || openSessionLoading}
            label="Open new session"
            loading={openSessionLoading}
            onPress={() => void runLoadingAction("open-session", async () => {
              if (await openSession()) {
                router.push("/session");
              }
            })}
            variant="primary"
          />
          <PiButton
            accessibilityLabel="Open path explorer"
            disabled={state.connectionState !== "connected"}
            label="Explore folders"
            onPress={() => router.push("/explorer")}
            variant="secondary"
          />
          <PiButton
            accessibilityLabel="Browse sessions for selected path"
            disabled={!canBrowse || browseSessionsLoading}
            label="Stored sessions"
            loading={browseSessionsLoading}
            onPress={() => void runLoadingAction("browse-sessions", async () => {
              await browseSessionsForSelectedPath();
              router.push("/sessions");
            })}
            variant="secondary"
          />
          <PiButton
            accessibilityLabel="Connect another host"
            label="Host"
            onPress={() => router.push("/connect")}
            variant="ghost"
          />
        </View>
      </View>
    </ScrollView>
  );
}

export function PathExplorerScreen() {
  const router = useRouter();
  const {
    browseDirectory,
    directoryError,
    directoryList,
    directoryLoading,
    selectExplorerPath,
    state,
  } = usePiMobile();

  return (
    <ScrollView
      contentContainerStyle={styles.connectionScreen}
      keyboardShouldPersistTaps="handled"
      style={styles.connectionScroll}
    >
      <PathExplorerPanel
        connectionState={state.connectionState}
        directoryError={directoryError}
        directoryList={directoryList}
        loading={directoryLoading}
        onBrowseDirectory={(path) => void browseDirectory(path)}
        onSelectCurrentPath={() => {
          selectExplorerPath();
          router.push("/workspace");
        }}
      />
    </ScrollView>
  );
}

export function PathSessionsScreen() {
  const router = useRouter();
  const {
    browseSessionsForSelectedPath,
    openListedSession,
    pathSessions,
    pathSessionsError,
    pathSessionsLoading,
    pathSessionsPath,
    state,
  } = usePiMobile();
  const { loadingAction, runLoadingAction } = useLoadingAction();

  return (
    <ScrollView
      contentContainerStyle={styles.connectionScreen}
      keyboardShouldPersistTaps="handled"
      style={styles.connectionScroll}
    >
      <PathSessionsPanel
        connectionState={state.connectionState}
        path={state.cwd}
        sessions={pathSessions}
        sessionsError={pathSessionsError}
        sessionsLoading={pathSessionsLoading}
        sessionsPath={pathSessionsPath}
        openingSessionKey={loadingAction}
        onBrowseSessions={() => void browseSessionsForSelectedPath()}
        onOpenSession={(session) => void runLoadingAction(pathSessionActionKey(session), async () => {
          if (await openListedSession(session)) {
            router.push("/session");
          }
        })}
      />
    </ScrollView>
  );
}

export function ActiveSessionScreen() {
  const router = useRouter();
  const {
    abort,
    activeSession,
    followUp,
    sendPrompt,
    setPrompt,
    state,
    steer,
  } = usePiMobile();
  const { loadingAction, runLoadingAction } = useLoadingAction();

  useEffect(() => {
    if (!activeSession) {
      router.replace("/");
    }
  }, [activeSession, router]);

  if (!activeSession) {
    return null;
  }

  const sessionHeaderTitle = activeSession.session.title.trim()
    || `Session ${shortSessionId(activeSession.session.id)}`;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: sessionHeaderTitle }} />
      <SessionScreen
        snapshot={activeSession}
        state={state}
        commandLoading={loadingAction}
        onSendPrompt={() => void runLoadingAction("send", sendPrompt)}
        onSteer={() => void runLoadingAction("steer", steer)}
        onFollowUp={() => void runLoadingAction("follow-up", followUp)}
        onAbort={() => void runLoadingAction("abort", abort)}
        onPromptChange={setPrompt}
      />
    </View>
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

function RecentHostsPanel({
  hosts,
  loadingAction,
  onConnect,
  onRemove,
}: {
  hosts: RecentHost[];
  loadingAction: string | undefined;
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
              loading={loadingAction === recentHostActionKey(host)}
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
  loadingAction,
  onRemove,
  onOpenNew,
  onOpenPrevious,
}: {
  sessions: RecentSession[];
  loadingAction: string | undefined;
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
              loading={loadingAction === recentSessionActionKey("previous", session)}
              onPress={() => onOpenPrevious(session)}
              variant="secondary"
            />
            <PiButton
              accessibilityLabel={`Open new session in ${session.cwd}`}
              label="New here"
              loading={loadingAction === recentSessionActionKey("new", session)}
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
          loading={loading}
          onPress={() => onBrowseDirectory(HOME_DIRECTORY_PATH)}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Browse documents directory"
          disabled={!connected || loading}
          label="Documents"
          loading={loading}
          onPress={() => onBrowseDirectory(DOCUMENTS_DIRECTORY_PATH)}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Browse parent directory"
          disabled={!connected || loading || !directoryList?.parentPath}
          label="Up"
          loading={loading}
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
  openingSessionKey,
  onBrowseSessions,
  onOpenSession,
}: {
  connectionState: AppViewState["connectionState"];
  path: string;
  sessions: SessionSummary[];
  sessionsError: string | undefined;
  sessionsLoading: boolean;
  sessionsPath: string | undefined;
  openingSessionKey: string | undefined;
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
          label="Refresh"
          loading={sessionsLoading}
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
                  loading={openingSessionKey === pathSessionActionKey(session)}
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
  commandLoading: string | undefined;
  onSendPrompt: () => void;
  onSteer: () => void;
  onFollowUp: () => void;
  onAbort: () => void;
  onPromptChange: (value: string) => void;
}

function SessionScreen({
  snapshot,
  state,
  commandLoading,
  onSendPrompt,
  onSteer,
  onFollowUp,
  onAbort,
  onPromptChange,
}: SessionScreenProps) {
  const timelineRef = useRef<FlatList<TimelineItem>>(null);
  const userScrollActiveRef = useRef(false);
  const [timelinePinnedToBottom, setTimelinePinnedToBottom] = useState(true);
  const [textMenuSelection, setTextMenuSelection] = useState<RawTextSelection | undefined>();
  const [rawTextSelection, setRawTextSelection] = useState<RawTextSelection | undefined>();
  const headerHeight = useHeaderHeight();
  const keyboardVerticalOffset = Platform.OS === "ios" ? headerHeight : 0;
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

  const openRawTextDrawer = useCallback(() => {
    if (textMenuSelection) {
      setRawTextSelection(textMenuSelection);
    }
    setTextMenuSelection(undefined);
  }, [textMenuSelection]);

  return (
    <KeyboardAvoidingView
      behavior={SESSION_KEYBOARD_BEHAVIOR}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={styles.sessionKeyboardView}
    >
      <View style={styles.sessionScreen}>
        <View style={styles.timelineContainer}>
          <FlatList
            ref={timelineRef}
            data={snapshot.timeline}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TimelineRow item={item} onSelectRawText={setTextMenuSelection} />
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>Send a prompt to start the timeline.</Text>
            }
            contentContainerStyle={styles.timelineContent}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
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
          commandLoading={commandLoading}
          cwd={snapshot.session.cwd}
          model={snapshot.session.model}
          thinkingLevel={snapshot.session.thinkingLevel}
          onAbort={onAbort}
          onFollowUp={onFollowUp}
          onPromptChange={onPromptChange}
          onSendPrompt={onSendPrompt}
          onSteer={onSteer}
          prompt={state.prompt}
        />
      </View>
      <MessageTextMenu
        selection={textMenuSelection}
        onClose={() => setTextMenuSelection(undefined)}
        onSelectText={openRawTextDrawer}
      />
      <RawMarkdownDrawer
        selection={rawTextSelection}
        onClose={() => setRawTextSelection(undefined)}
      />
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

function TimelineRow({
  item,
  onSelectRawText,
}: {
  item: TimelineItem;
  onSelectRawText: (selection: RawTextSelection) => void;
}) {
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
      <SelectableMessageBlock
        label={`Assistant message from ${formatTime(item.createdAt)}`}
        onSelectRawText={onSelectRawText}
        style={styles.assistantMessage}
        text={item.text}
      >
        <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
        <MarkdownText text={item.text} />
      </SelectableMessageBlock>
    );
  }

  if (item.kind === "thinking") {
    return (
      <SelectableMessageBlock
        label="Thinking block"
        onSelectRawText={onSelectRawText}
        style={styles.thinkingBlock}
        text={item.text}
      >
        <MarkdownText text={item.text} thinking />
      </SelectableMessageBlock>
    );
  }

  return (
    <SelectableMessageBlock
      label={`User message from ${formatTime(item.createdAt)}`}
      onSelectRawText={onSelectRawText}
      style={styles.userMessage}
      text={item.text}
    >
      <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
      <MarkdownText text={item.text} />
    </SelectableMessageBlock>
  );
}

function SelectableMessageBlock({
  children,
  label,
  onSelectRawText,
  style,
  text,
}: {
  children: ReactNode;
  label: string;
  onSelectRawText: (selection: RawTextSelection) => void;
  style: StyleProp<ViewStyle>;
  text: string;
}) {
  return (
    <Pressable
      accessibilityHint="Long press to select the raw markdown text for copying."
      accessibilityLabel={label}
      accessibilityRole="button"
      delayLongPress={350}
      onLongPress={() => onSelectRawText({ title: label, text })}
      onPress={() => Keyboard.dismiss()}
      style={style}
    >
      {children}
    </Pressable>
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

function MessageTextMenu({
  selection,
  onClose,
  onSelectText,
}: {
  selection: RawTextSelection | undefined;
  onClose: () => void;
  onSelectText: () => void;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={selection !== undefined}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Cancel text selection"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View style={styles.messageMenu}>
          <Text style={styles.panelTitle}>Message options</Text>
          <Text numberOfLines={1} style={styles.dimLine}>{selection?.title}</Text>
          <View style={styles.historyActions}>
            <PiButton
              accessibilityLabel="Select raw markdown text"
              label="Select text"
              onPress={onSelectText}
              variant="primary"
            />
            <PiButton
              accessibilityLabel="Cancel text selection"
              label="Cancel"
              onPress={onClose}
              variant="ghost"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RawMarkdownDrawer({
  selection,
  onClose,
}: {
  selection: RawTextSelection | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={selection !== undefined}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Close raw markdown drawer"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View style={styles.rawTextDrawer}>
          <View style={styles.drawerHandle} />
          <View style={styles.drawerHeader}>
            <View style={styles.historyTextBlock}>
              <Text style={styles.panelTitle}>Raw markdown</Text>
              <Text numberOfLines={1} style={styles.dimLine}>{selection?.title}</Text>
            </View>
            <PiButton
              accessibilityLabel="Close raw markdown drawer"
              label="Close"
              onPress={onClose}
              variant="ghost"
            />
          </View>
          <Text style={styles.dimLine}>Select and copy the raw message text below.</Text>
          <ScrollView
            contentContainerStyle={styles.rawMarkdownContent}
            style={styles.rawMarkdownScroll}
          >
            <Text selectable style={styles.rawMarkdownText}>{selection?.text ?? ""}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface ComposerProps {
  cwd: string;
  prompt: string;
  commandLoading: string | undefined;
  model: unknown;
  thinkingLevel: string | undefined;
  onPromptChange: (value: string) => void;
  onSendPrompt: () => void;
  onSteer: () => void;
  onFollowUp: () => void;
  onAbort: () => void;
}

function Composer({
  cwd,
  prompt,
  commandLoading,
  model,
  thinkingLevel,
  onPromptChange,
  onSendPrompt,
  onSteer,
  onFollowUp,
  onAbort,
}: ComposerProps) {
  const metadata = formatComposerMetadata(model, thinkingLevel);

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
          loading={commandLoading === "send"}
          onPress={onSendPrompt}
          variant="primary"
        />
        <PiButton
          accessibilityLabel="Steer"
          label="Steer"
          loading={commandLoading === "steer"}
          onPress={onSteer}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Follow Up"
          label="Follow-up"
          loading={commandLoading === "follow-up"}
          onPress={onFollowUp}
          variant="ghost"
        />
        <PiButton
          accessibilityLabel="Abort"
          label="Abort"
          loading={commandLoading === "abort"}
          onPress={onAbort}
          variant="danger"
        />
      </View>
      <View style={styles.composerFooterBlock}>
        <Text numberOfLines={1} style={styles.composerFooter}>{cwd}</Text>
        <Text numberOfLines={1} style={styles.composerFooter}>{metadata}</Text>
      </View>
    </View>
  );
}

interface PiButtonProps {
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
  variant: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
}

function PiButton({
  accessibilityLabel,
  disabled = false,
  label,
  loading = false,
  onPress,
  variant,
}: PiButtonProps) {
  const buttonDisabled = disabled || loading;
  const spinnerColor = variant === "primary" ? palette.bodyBg : palette.text;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: loading, disabled: buttonDisabled }}
      disabled={buttonDisabled}
      onPress={onPress}
      style={[
        styles.piButton,
        buttonVariantStyle(variant),
        buttonDisabled ? styles.disabledButton : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : null}
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

function formatComposerMetadata(
  model: unknown,
  thinkingLevel: string | undefined,
): string {
  const parts: string[] = [];
  if (model !== undefined && model !== null) {
    parts.push(`model: ${formatModel(model)}`);
  }
  if (thinkingLevel) {
    parts.push(`thinking: ${thinkingLevel}`);
  }
  return [...parts, "mobile", "sdk"].join(" · ");
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
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  messageMenu: {
    backgroundColor: palette.containerBg,
    borderTopColor: palette.dim,
    borderTopWidth: 1,
    gap: 12,
    padding: 18,
  },
  rawTextDrawer: {
    backgroundColor: palette.containerBg,
    borderTopColor: palette.border,
    borderTopWidth: 1,
    gap: 12,
    maxHeight: "78%",
    padding: 18,
  },
  drawerHandle: {
    alignSelf: "center",
    backgroundColor: palette.dim,
    borderRadius: 2,
    height: 4,
    width: 42,
  },
  drawerHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  rawMarkdownScroll: {
    backgroundColor: palette.bodyBg,
    borderColor: palette.dim,
    borderRadius: 4,
    borderWidth: 1,
  },
  rawMarkdownContent: { padding: 12 },
  rawMarkdownText: {
    ...monoText,
    color: palette.text,
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
  composerFooterBlock: { gap: 2 },
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
    flexDirection: "row",
    gap: 6,
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
