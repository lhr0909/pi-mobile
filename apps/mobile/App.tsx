import { useMemo, useReducer, useRef } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import type { TimelineItem } from "@pi-mobile/shared";
import { createInitialAppViewState, reduceAppViewState } from "./src/app-view-model";
import { HostClient } from "./src/host-client";

const DEFAULT_HOST_URL = "http://127.0.0.1:4739";

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
      await client.status();
      socketRef.current?.close();
      socketRef.current = client.connectEvents(event => dispatch({ type: "hostEvent", event }));
      dispatch({ type: "connected" });
    } catch (error) {
      dispatch({ type: "disconnected", errorMessage: error instanceof Error ? error.message : String(error) });
    }
  };

  const openSession = async () => {
    try {
      const snapshot = await client.openSession({ cwd: state.cwd, mode: "new" });
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

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Pi Mobile</Text>
        <Text style={styles.subtitle}>SDK host MVP</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Host URL</Text>
        <TextInput
          accessibilityLabel="Host URL"
          autoCapitalize="none"
          value={state.hostUrl}
          onChangeText={value => dispatch({ type: "setHostUrl", value })}
          style={styles.input}
        />
        <Text style={styles.label}>Token</Text>
        <TextInput
          accessibilityLabel="Host Token"
          autoCapitalize="none"
          secureTextEntry
          value={state.token}
          onChangeText={value => dispatch({ type: "setToken", value })}
          style={styles.input}
        />
        <Pressable accessibilityLabel="Connect" onPress={connect} style={styles.primaryButton}>
          <Text style={styles.buttonText}>Connect</Text>
        </Pressable>
        <Text style={styles.status}>Status: {state.connectionState}</Text>
        {state.errorMessage ? <Text style={styles.error}>{state.errorMessage}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Workspace cwd</Text>
        <TextInput
          accessibilityLabel="Workspace Path"
          autoCapitalize="none"
          value={state.cwd}
          onChangeText={value => dispatch({ type: "setCwd", value })}
          style={styles.input}
        />
        <Pressable accessibilityLabel="New Session" onPress={openSession} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>New Session</Text>
        </Pressable>
      </View>

      <View style={styles.transcript}>
        <Text style={styles.sectionTitle}>{activeSession?.session.title ?? "No session open"}</Text>
        <FlatList
          data={activeSession?.timeline ?? []}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <TimelineRow item={item} />}
          ListEmptyComponent={<Text style={styles.empty}>Open a session, then send a prompt.</Text>}
        />
      </View>

      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Prompt"
          multiline
          placeholder="Ask pi to do something…"
          value={state.prompt}
          onChangeText={value => dispatch({ type: "setPrompt", value })}
          style={[styles.input, styles.prompt]}
        />
        <View style={styles.buttonRow}>
          <Pressable accessibilityLabel="Send" onPress={sendPrompt} style={styles.primaryButton}>
            <Text style={styles.buttonText}>Send</Text>
          </Pressable>
          <Pressable accessibilityLabel="Steer" onPress={steer} style={styles.smallButton}>
            <Text style={styles.secondaryButtonText}>Steer</Text>
          </Pressable>
          <Pressable accessibilityLabel="Follow Up" onPress={followUp} style={styles.smallButton}>
            <Text style={styles.secondaryButtonText}>Follow-up</Text>
          </Pressable>
          <Pressable accessibilityLabel="Abort" onPress={abort} style={styles.dangerButton}>
            <Text style={styles.buttonText}>Abort</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "status") {
    return <Text style={styles.statusItem}>{item.text}</Text>;
  }

  if (item.kind === "tool") {
    return <Text style={styles.toolItem}>Tool {item.status}: {item.title}</Text>;
  }

  return (
    <View style={[styles.message, item.kind === "assistant" ? styles.assistant : styles.user]}>
      <Text style={styles.messageRole}>{item.kind}</Text>
      <Text>{item.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0f172a", padding: 16, gap: 12 },
  header: { gap: 2 },
  title: { color: "white", fontSize: 32, fontWeight: "700" },
  subtitle: { color: "#94a3b8", fontSize: 16 },
  card: { backgroundColor: "#172033", borderRadius: 16, padding: 12, gap: 8 },
  label: { color: "#cbd5e1", fontWeight: "600" },
  input: { backgroundColor: "white", borderRadius: 10, padding: 10, minHeight: 42 },
  prompt: { minHeight: 72, textAlignVertical: "top" },
  primaryButton: { backgroundColor: "#38bdf8", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  secondaryButton: { backgroundColor: "#e2e8f0", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  smallButton: { backgroundColor: "#e2e8f0", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  dangerButton: { backgroundColor: "#ef4444", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  buttonText: { color: "#082f49", fontWeight: "700" },
  secondaryButtonText: { color: "#0f172a", fontWeight: "700" },
  status: { color: "#cbd5e1" },
  error: { color: "#fca5a5" },
  transcript: { flex: 1, backgroundColor: "#f8fafc", borderRadius: 16, padding: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  empty: { color: "#64748b" },
  composer: { gap: 8 },
  buttonRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  message: { borderRadius: 12, padding: 10, marginBottom: 8 },
  assistant: { backgroundColor: "#e0f2fe" },
  user: { backgroundColor: "#dcfce7" },
  messageRole: { fontWeight: "700", textTransform: "capitalize", marginBottom: 4 },
  statusItem: { color: "#475569", marginBottom: 8 },
  toolItem: { color: "#7c2d12", marginBottom: 8 },
});
