import { useMemo, useReducer, useRef } from "react";
import { FlatList, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import type { SessionSnapshot, TimelineItem } from "@pi-mobile/shared";
import { createInitialAppViewState, isAbsoluteHostPath, reduceAppViewState, type AppViewState } from "./src/app-view-model";
import { HostClient } from "./src/host-client";

const DEFAULT_HOST_URL = "http://127.0.0.1:4739";
const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) ?? "monospace";

export default function App() {
  const [state, dispatch] = useReducer(
    reduceAppViewState,
    createInitialAppViewState(DEFAULT_HOST_URL),
  );
  const socketRef = useRef<WebSocket | null>(null);
  const client = useMemo(
    () => new HostClient({
      baseUrl: state.hostUrl,
      ...(state.token.trim() ? { token: state.token.trim() } : {}),
    }),
    [state.hostUrl, state.token],
  );

  const activeSession = state.client.activeSessionId
    ? state.client.sessions[state.client.activeSessionId]
    : undefined;

  const connect = async () => {
    dispatch({ type: "connecting" });
    try {
      const status = await client.status();
      socketRef.current?.close();
      socketRef.current = client.connectEvents(event => dispatch({ type: "hostEvent", event }));
      dispatch({ type: "connected", status });
    } catch (error) {
      dispatch({ type: "disconnected", errorMessage: error instanceof Error ? error.message : String(error) });
    }
  };

  const openSession = async () => {
    if (!state.cwd.trim()) return;
    try {
      const snapshot = await client.openSession({ cwd: state.cwd.trim(), mode: "new" });
      dispatch({ type: "hostEvent", event: { type: "session_opened", snapshot } });
    } catch (error) {
      dispatch({ type: "disconnected", errorMessage: error instanceof Error ? error.message : String(error) });
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
          state={state}
          onConnect={connect}
          onOpenSession={openSession}
          onHostUrlChange={value => dispatch({ type: "setHostUrl", value })}
          onTokenChange={value => dispatch({ type: "setToken", value })}
          onCwdChange={value => dispatch({ type: "setCwd", value })}
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
          onPromptChange={value => dispatch({ type: "setPrompt", value })}
        />
      )}
    </SafeAreaView>
  );
}

interface ConnectionScreenProps {
  state: AppViewState;
  onConnect: () => void;
  onOpenSession: () => void;
  onHostUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onCwdChange: (value: string) => void;
}

function ConnectionScreen({
  state,
  onConnect,
  onOpenSession,
  onHostUrlChange,
  onTokenChange,
  onCwdChange,
}: ConnectionScreenProps) {
  const pathIsAbsolute = state.cwd.trim().length === 0 || isAbsoluteHostPath(state.cwd);
  const canOpenSession = state.connectionState === "connected" && state.cwd.trim().length > 0 && pathIsAbsolute;

  return (
    <View style={styles.connectionScreen}>
      <View style={styles.brandHeader}>
        <Text style={styles.appTitle}>Pi Mobile</Text>
        <Text style={styles.helpText}>SDK host MVP · mobile session UI</Text>
      </View>

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
        <Text style={styles.label}>Token</Text>
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
          label={state.connectionState === "connecting" ? "Connecting…" : "Connect host"}
          onPress={onConnect}
          variant="primary"
        />
        <Text style={styles.statusLine}>Status: {state.connectionState}</Text>
        {state.client.connectionMessage ? <Text style={styles.dimLine}>{state.client.connectionMessage}</Text> : null}
        {state.errorMessage ? <Text style={styles.errorLine}>{state.errorMessage}</Text> : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Session path</Text>
        <Text style={styles.label}>Absolute workspace path on the host</Text>
        <TextInput
          accessibilityLabel="Session Path"
          autoCapitalize="none"
          placeholder="Connect to seed /absolute/path"
          placeholderTextColor={palette.dim}
          value={state.cwd}
          onChangeText={onCwdChange}
          style={styles.input}
        />
        <Text style={pathIsAbsolute ? styles.dimLine : styles.warningLine}>
          {pathIsAbsolute ? "Uses the host cwd after connect unless you enter an absolute path." : "Enter an absolute host path before opening a session."}
        </Text>
        <PiButton
          accessibilityLabel="New Session"
          disabled={!canOpenSession}
          label="Open new session"
          onPress={onOpenSession}
          variant="secondary"
        />
      </View>
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
  return (
    <View style={styles.sessionScreen}>
      <View style={styles.sessionHeader}>
        <View style={styles.headerTopRow}>
          <Text style={styles.sessionTitle}>Session: {shortSessionId(snapshot.session.id)}</Text>
          <View style={styles.headerActions}>
            <PiButton
              accessibilityLabel="Toggle Session Header"
              label={state.sessionHeaderCollapsed ? "Show" : "Hide"}
              onPress={onToggleHeader}
              variant="ghost"
            />
            <PiButton accessibilityLabel="Connection" label="Host" onPress={onShowConnection} variant="ghost" />
          </View>
        </View>
        {state.sessionHeaderCollapsed ? (
          <Text numberOfLines={1} style={styles.collapsedHeaderSummary}>{snapshot.session.cwd}</Text>
        ) : (
          <>
            <Text style={styles.helpText}>T toggle thinking · O toggle tools</Text>
            <InfoRow label="Path" value={snapshot.session.cwd} />
            <InfoRow label="State" value={snapshot.session.runState} />
            <InfoRow label="Messages" value={String(snapshot.session.messageCount)} />
            {snapshot.session.thinkingLevel ? <InfoRow label="Thinking" value={snapshot.session.thinkingLevel} /> : null}
            {snapshot.session.model ? <InfoRow label="Model" value={formatModel(snapshot.session.model)} /> : null}
          </>
        )}
      </View>

      <FlatList
        data={snapshot.timeline}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <TimelineRow item={item} />}
        ListEmptyComponent={<Text style={styles.empty}>Send a prompt to start the timeline.</Text>}
        contentContainerStyle={styles.timelineContent}
        style={styles.timeline}
      />

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
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}:</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "status") {
    return <Text style={[styles.statusItem, statusToneStyle(item.tone)]}>{formatTime(item.createdAt)}  {item.text}</Text>;
  }

  if (item.kind === "tool") {
    return (
      <View style={[styles.toolCard, toolCardStyle(item.status)]}>
        <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
        <Text style={styles.toolTitle}>{item.title}</Text>
        <Text style={styles.toolOutput}>Tool {item.status}</Text>
        {item.detail ? <Text style={styles.toolOutput}>{item.detail}</Text> : null}
      </View>
    );
  }

  if (item.kind === "assistant") {
    return (
      <View style={styles.assistantMessage}>
        <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
        <Text style={styles.messageText}>{item.text}</Text>
      </View>
    );
  }

  return (
    <View style={styles.userMessage}>
      <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
      <Text style={styles.messageText}>{item.text}</Text>
    </View>
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

function Composer({ cwd, prompt, onPromptChange, onSendPrompt, onSteer, onFollowUp, onAbort }: ComposerProps) {
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
        <PiButton accessibilityLabel="Send" label="Send" onPress={onSendPrompt} variant="primary" />
        <PiButton accessibilityLabel="Steer" label="Steer" onPress={onSteer} variant="ghost" />
        <PiButton accessibilityLabel="Follow Up" label="Follow-up" onPress={onFollowUp} variant="ghost" />
        <PiButton accessibilityLabel="Abort" label="Abort" onPress={onAbort} variant="danger" />
      </View>
      <Text numberOfLines={1} style={styles.composerFooter}>{cwd} · mobile · sdk</Text>
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

function PiButton({ accessibilityLabel, disabled = false, label, onPress, variant }: PiButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={[styles.piButton, buttonVariantStyle(variant), disabled ? styles.disabledButton : null]}
    >
      <Text style={[styles.buttonText, variant === "primary" ? styles.primaryButtonText : null]}>{label}</Text>
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

function shortSessionId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatModel(model: unknown): string {
  if (typeof model === "string") {
    return model;
  }

  if (model && typeof model === "object" && !Array.isArray(model)) {
    const fields = model as Record<string, unknown>;
    const id = typeof fields.id === "string" ? fields.id : undefined;
    const provider = typeof fields.provider === "string" ? fields.provider : undefined;
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
  muted: "#808080",
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bodyBg },
  connectionScreen: { flex: 1, padding: 18, gap: 18, justifyContent: "center" },
  brandHeader: { gap: 6 },
  appTitle: { ...monoText, color: palette.borderAccent, fontSize: 30, fontWeight: "800" },
  helpText: { ...monoText, color: palette.warning, fontSize: 14, lineHeight: 21 },
  panel: { backgroundColor: palette.containerBg, borderRadius: 4, gap: 10, padding: 18 },
  panelTitle: { ...monoText, color: palette.customLabel, fontSize: 18, fontWeight: "800", marginBottom: 6 },
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
  warningLine: { ...monoText, color: palette.warning, fontSize: 12, lineHeight: 18 },
  errorLine: { ...monoText, color: palette.error, fontSize: 12, lineHeight: 18 },
  sessionScreen: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  sessionHeader: { backgroundColor: palette.containerBg, borderRadius: 4, gap: 6, padding: 18 },
  headerTopRow: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  headerActions: { flexDirection: "row", gap: 8 },
  sessionTitle: { ...monoText, color: palette.borderAccent, flex: 1, fontSize: 18, fontWeight: "800" },
  collapsedHeaderSummary: { ...monoText, color: palette.dim, fontSize: 12, lineHeight: 18 },
  infoRow: { alignItems: "baseline", flexDirection: "row", gap: 8 },
  infoLabel: { ...monoText, color: palette.dim, fontSize: 12, fontWeight: "800", minWidth: 74 },
  infoValue: { ...monoText, color: palette.text, flex: 1, fontSize: 12, lineHeight: 18 },
  timeline: { flex: 1 },
  timelineContent: { gap: 18, paddingVertical: 18 },
  empty: { ...monoText, color: palette.muted, fontSize: 14, padding: 18 },
  timestamp: { ...monoText, color: palette.dim, fontSize: 11, marginBottom: 8 },
  statusItem: { ...monoText, fontSize: 12, lineHeight: 18, paddingHorizontal: 18 },
  statusInfo: { color: palette.dim },
  statusSuccess: { color: palette.accent },
  statusWarning: { color: palette.warning },
  statusError: { color: palette.error },
  userMessage: { backgroundColor: palette.userBg, borderRadius: 4, padding: 18 },
  assistantMessage: { paddingHorizontal: 18 },
  messageText: { ...monoText, fontSize: 15, fontWeight: "700", lineHeight: 24 },
  toolCard: { borderRadius: 4, padding: 18 },
  toolPending: { backgroundColor: palette.toolPending },
  toolSuccess: { backgroundColor: palette.toolSuccess },
  toolError: { backgroundColor: palette.toolError },
  toolTitle: { ...monoText, color: palette.text, fontSize: 15, fontWeight: "800", lineHeight: 24 },
  toolOutput: { ...monoText, color: palette.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
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
  composerFooter: { ...monoText, color: palette.dim, fontSize: 12, lineHeight: 18 },
  piButton: { alignItems: "center", borderRadius: 4, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  primaryButton: { backgroundColor: palette.borderAccent, borderColor: palette.borderAccent },
  secondaryButton: { backgroundColor: "transparent", borderColor: palette.border },
  ghostButton: { backgroundColor: "transparent", borderColor: palette.border },
  dangerButton: { backgroundColor: "transparent", borderColor: palette.error },
  disabledButton: { opacity: 0.45 },
  buttonText: { ...monoText, color: palette.text, fontSize: 12, fontWeight: "800" },
  primaryButtonText: { color: palette.bodyBg },
});
