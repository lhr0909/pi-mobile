import { describe, expect, it } from "vitest";
import {
  formatJson,
  getBashCallParts,
  getReadCallParts,
  getReadLanguage,
  normalizeBashOutput,
  normalizeReadOutput,
} from "../src/tool-rendering.js";

describe("tool rendering helpers", () => {
  it("formats bash command calls with timeout metadata", () => {
    expect(
      getBashCallParts({
        command: "git status --short --branch",
        timeout: 60,
      }),
    ).toEqual({
      commandText: "$ git status --short --branch",
      invalidCommand: false,
      timeoutText: "(timeout 60s)",
    });
  });

  it("marks invalid bash command args", () => {
    expect(getBashCallParts({ command: 42 }).commandText).toBe(
      "[invalid arg]",
    );
  });

  it("formats read calls with path aliases and line ranges", () => {
    expect(
      getReadCallParts({
        path: "apps/mobile/App.tsx",
        offset: 260,
        limit: 360,
      }),
    ).toEqual({
      pathText: "apps/mobile/App.tsx",
      invalidPath: false,
      lineRangeText: ":260-619",
    });
  });

  it("infers read syntax language from the file path", () => {
    expect(getReadLanguage({ path: "apps/mobile/App.tsx" })).toBe(
      "typescript",
    );
    expect(getReadLanguage({ file_path: "package.json" })).toBe("json");
  });

  it("keeps exact JSON tool arguments expanded", () => {
    expect(formatJson({ command: "pnpm test", timeout: 60 })).toBe(
      '{\n  "command": "pnpm test",\n  "timeout": 60\n}',
    );
  });

  it("normalizes tool output like the TUI renderers", () => {
    expect(normalizeBashOutput("\talpha\n\n")).toBe("alpha");
    expect(normalizeReadOutput("a\tb\n\n")).toBe("a   b");
  });
});
