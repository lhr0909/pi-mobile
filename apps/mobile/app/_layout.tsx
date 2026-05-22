import { Stack } from "expo-router";
import { PiMobileProvider } from "../App";

const screenOptions = {
  contentStyle: { backgroundColor: "#18181e" },
  headerStyle: { backgroundColor: "#1e1e24" },
  headerTintColor: "#e5e5e7",
  headerTitleStyle: { fontWeight: "800" as const },
};

export default function RootLayout() {
  return (
    <PiMobileProvider>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ title: "Pi Mobile" }} />
        <Stack.Screen name="connect" options={{ title: "Host" }} />
        <Stack.Screen name="workspace" options={{ title: "Workspace" }} />
        <Stack.Screen name="explorer" options={{ title: "Path explorer" }} />
        <Stack.Screen name="sessions" options={{ title: "Stored sessions" }} />
        <Stack.Screen name="session" options={{ title: "Session" }} />
      </Stack>
    </PiMobileProvider>
  );
}
