import {
  createMobileClientState,
  reduceHostEvent,
  type HostEvent,
  type HostStatus,
  type MobileClientState,
} from "@pi-mobile/shared";

export type AppScreen = "connection" | "session";

export interface AppViewState {
  client: MobileClientState;
  screen: AppScreen;
  hostUrl: string;
  token: string;
  cwd: string;
  prompt: string;
  sessionHeaderCollapsed: boolean;
  connectionState: "disconnected" | "connecting" | "connected";
  hostStatus?: HostStatus;
  errorMessage?: string;
}

export type AppAction =
  | { type: "setHostUrl"; value: string }
  | { type: "setToken"; value: string }
  | { type: "setCwd"; value: string }
  | { type: "setPrompt"; value: string }
  | { type: "showConnection" }
  | { type: "toggleSessionHeader" }
  | { type: "connecting" }
  | { type: "connected"; status: HostStatus }
  | { type: "disconnected"; errorMessage?: string }
  | { type: "hostEvent"; event: HostEvent }
  | { type: "clearPrompt" }
  | { type: "setError"; message: string };

export function createInitialAppViewState(defaultHostUrl: string): AppViewState {
  return {
    client: createMobileClientState(),
    screen: "connection",
    hostUrl: defaultHostUrl,
    token: "",
    cwd: "",
    prompt: "",
    sessionHeaderCollapsed: false,
    connectionState: "disconnected",
  };
}

export function reduceAppViewState(state: AppViewState, action: AppAction): AppViewState {
  switch (action.type) {
    case "setHostUrl":
      return { ...state, hostUrl: action.value };
    case "setToken":
      return { ...state, token: action.value };
    case "setCwd":
      return { ...state, cwd: action.value };
    case "setPrompt":
      return { ...state, prompt: action.value };
    case "showConnection":
      return { ...state, screen: "connection" };
    case "toggleSessionHeader":
      return { ...state, sessionHeaderCollapsed: !state.sessionHeaderCollapsed };
    case "connecting":
      return withoutError({ ...state, connectionState: "connecting" });
    case "connected":
      return withoutError({
        ...state,
        client: reduceHostEvent(state.client, { type: "host_status", status: action.status }),
        connectionState: "connected",
        hostStatus: action.status,
        cwd: nextWorkspacePath(state.cwd, action.status.cwd),
      });
    case "disconnected":
      return {
        ...state,
        connectionState: "disconnected",
        screen: "connection",
        ...(action.errorMessage ? { errorMessage: action.errorMessage } : {}),
      };
    case "hostEvent": {
      const client = reduceHostEvent(state.client, action.event);
      return withoutError({
        ...state,
        client,
        screen: action.event.type === "session_opened" ? "session" : state.screen,
      });
    }
    case "clearPrompt":
      return { ...state, prompt: "" };
    case "setError":
      return { ...state, errorMessage: action.message };
  }
}

export function isAbsoluteHostPath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\");
}

function nextWorkspacePath(currentPath: string, hostCwd: string): string {
  return isAbsoluteHostPath(currentPath) ? currentPath : hostCwd;
}

function withoutError(state: AppViewState): AppViewState {
  const { errorMessage: _errorMessage, ...rest } = state;
  return rest;
}
