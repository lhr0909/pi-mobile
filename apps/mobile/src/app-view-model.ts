import { createMobileClientState, reduceHostEvent, type HostEvent, type MobileClientState } from "@pi-mobile/shared";

export interface AppViewState {
  client: MobileClientState;
  hostUrl: string;
  token: string;
  cwd: string;
  prompt: string;
  connectionState: "disconnected" | "connecting" | "connected";
  errorMessage?: string;
}

export type AppAction =
  | { type: "setHostUrl"; value: string }
  | { type: "setToken"; value: string }
  | { type: "setCwd"; value: string }
  | { type: "setPrompt"; value: string }
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "disconnected"; errorMessage?: string }
  | { type: "hostEvent"; event: HostEvent }
  | { type: "clearPrompt" };

export function createInitialAppViewState(defaultHostUrl: string): AppViewState {
  return {
    client: createMobileClientState(),
    hostUrl: defaultHostUrl,
    token: "",
    cwd: ".",
    prompt: "",
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
    case "connecting":
      return withoutError({ ...state, connectionState: "connecting" });
    case "connected":
      return withoutError({ ...state, connectionState: "connected" });
    case "disconnected":
      return {
        ...state,
        connectionState: "disconnected",
        ...(action.errorMessage ? { errorMessage: action.errorMessage } : {}),
      };
    case "hostEvent":
      return withoutError({ ...state, client: reduceHostEvent(state.client, action.event) });
    case "clearPrompt":
      return { ...state, prompt: "" };
  }
}

function withoutError(state: AppViewState): AppViewState {
  const { errorMessage: _errorMessage, ...rest } = state;
  return rest;
}
