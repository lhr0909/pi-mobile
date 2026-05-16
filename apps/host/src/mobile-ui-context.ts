import crypto from "node:crypto";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionUiRequest, ExtensionUiResponse, HostEvent } from "@pi-mobile/shared";
import { EventLog } from "./event-log.js";
import type { HostEventListener } from "./types.js";

interface PendingDialog {
  resolve(response: ExtensionUiResponse): void;
}

export class MobileExtensionUiBridge {
  private readonly pendingDialogs = new Map<string, PendingDialog>();

  constructor(
    private readonly sessionId: string,
    private readonly eventLog: EventLog,
    private readonly emit: HostEventListener,
  ) {}

  createContext(): ExtensionUIContext {
    const context: ExtensionUIContext = {
      select: (title, options, opts) =>
        this.dialog(
          { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          response => (response.cancelled ? undefined : "value" in response ? response.value : undefined),
        ),
      confirm: (title, message, opts) =>
        this.dialog(
          { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          response => (response.cancelled ? false : "confirmed" in response ? response.confirmed === true : false),
        ),
      input: (title, placeholder, opts) =>
        this.dialog(
          {
            method: "input",
            title,
            ...(placeholder ? { placeholder } : {}),
            ...(opts?.timeout ? { timeout: opts.timeout } : {}),
          },
          response => (response.cancelled ? undefined : "value" in response ? response.value : undefined),
        ),
      editor: (title, prefill) =>
        this.dialog(
          { method: "editor", title, ...(prefill ? { prefill } : {}) },
          response => (response.cancelled ? undefined : "value" in response ? response.value : undefined),
        ),
      notify: (message, type) => {
        this.recordFireAndForget({ method: "notify", message, ...(type ? { notifyType: type } : {}) });
      },
      setStatus: (key, text) => {
        this.recordFireAndForget({ method: "setStatus", statusKey: key, ...(text ? { statusText: text } : {}) });
      },
      setWidget: (key, content, options) => {
        if (content === undefined || Array.isArray(content)) {
          this.recordFireAndForget({
            method: "setWidget",
            widgetKey: key,
            ...(content ? { widgetLines: content } : {}),
            ...(options?.placement ? { widgetPlacement: options.placement } : {}),
          });
        }
      },
      setTitle: title => {
        this.recordFireAndForget({ method: "setTitle", title });
      },
      setEditorText: text => {
        this.recordFireAndForget({ method: "set_editor_text", text });
      },
      pasteToEditor: text => {
        context.setEditorText(text);
      },
      getEditorText: () => "",
      onTerminalInput: () => () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setFooter: () => {},
      setHeader: () => {},
      custom: async <T>() => undefined as T,
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      theme: {} as ExtensionUIContext["theme"],
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported by pi-mobile host" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };

    return context;
  }

  respond(requestId: string, response: ExtensionUiResponse): void {
    const pending = this.pendingDialogs.get(requestId);
    if (!pending) {
      throw new Error(`Extension UI request not found: ${requestId}`);
    }

    this.pendingDialogs.delete(requestId);
    pending.resolve(response);
    this.emit(
      this.eventLog.record(seq => ({
        type: "extension_ui_cleared",
        sessionId: this.sessionId,
        requestId,
        seq,
      })),
    );
  }

  private dialog<T>(
    request: Omit<ExtensionUiRequest, "id" | "sessionId">,
    parse: (response: ExtensionUiResponse) => T,
  ): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      this.pendingDialogs.set(id, { resolve: response => resolve(parse(response)) });
      this.recordRequest({ id, sessionId: this.sessionId, ...request });
    });
  }

  private recordFireAndForget(request: Omit<ExtensionUiRequest, "id" | "sessionId">): void {
    this.recordRequest({ id: crypto.randomUUID(), sessionId: this.sessionId, ...request });
  }

  private recordRequest(request: ExtensionUiRequest): void {
    const event = this.eventLog.record(seq => ({ type: "extension_ui_request", request, seq }));
    this.emit(event);
  }
}
