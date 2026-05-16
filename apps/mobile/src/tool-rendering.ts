import type { JsonObject, JsonValue } from "@pi-mobile/shared";

export const INVALID_ARG_TEXT = "[invalid arg]";

export interface BashCallParts {
  commandText: string;
  invalidCommand: boolean;
  timeoutText?: string;
}

export interface ReadCallParts {
  pathText: string;
  invalidPath: boolean;
  lineRangeText?: string;
}

export function getBashCallParts(args: JsonValue | undefined): BashCallParts {
  const fields = asJsonObject(args);
  const command = toDisplayString(fields?.command);
  const timeout = typeof fields?.timeout === "number" ? fields.timeout : undefined;

  return {
    commandText:
      command === null ? INVALID_ARG_TEXT : command ? `$ ${command}` : "$ ...",
    invalidCommand: command === null,
    ...(timeout ? { timeoutText: `(timeout ${timeout}s)` } : {}),
  };
}

export function getReadCallParts(args: JsonValue | undefined): ReadCallParts {
  const fields = asJsonObject(args);
  const rawPath = toDisplayString(fields?.file_path ?? fields?.path);
  const lineRangeText = formatReadLineRange(fields);

  return {
    pathText:
      rawPath === null ? INVALID_ARG_TEXT : rawPath ? rawPath : "...",
    invalidPath: rawPath === null,
    ...(lineRangeText ? { lineRangeText } : {}),
  };
}

export function getReadLanguage(args: JsonValue | undefined): string | undefined {
  const fields = asJsonObject(args);
  const rawPath = toDisplayString(fields?.file_path ?? fields?.path);
  return rawPath ? getLanguageFromPath(rawPath) : undefined;
}

export function formatJson(value: JsonValue): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export function normalizeBashOutput(text: string): string {
  return replaceTabs(text.trim());
}

export function normalizeReadOutput(text: string): string {
  return trimTrailingEmptyLines(replaceTabs(text).split("\n")).join("\n");
}

export function replaceTabs(text: string): string {
  return text.replace(/\t/g, "   ");
}

export function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;

  const extToLang: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "fish",
    ps1: "powershell",
    sql: "sql",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    md: "markdown",
    markdown: "markdown",
    dockerfile: "dockerfile",
    makefile: "makefile",
    cmake: "cmake",
    lua: "lua",
    perl: "perl",
    r: "r",
    scala: "scala",
    clj: "clojure",
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    hs: "haskell",
    ml: "ocaml",
    vim: "vim",
    graphql: "graphql",
    proto: "protobuf",
    tf: "hcl",
    hcl: "hcl",
  };

  return extToLang[ext];
}

function formatReadLineRange(fields: JsonObject | undefined): string | undefined {
  if (!fields || (fields.offset === undefined && fields.limit === undefined)) {
    return undefined;
  }

  const startLine = typeof fields.offset === "number" ? fields.offset : 1;
  if (typeof fields.limit !== "number") {
    return `:${startLine}`;
  }

  return `:${startLine}-${startLine + fields.limit - 1}`;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}

function asJsonObject(value: JsonValue | undefined): JsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function toDisplayString(value: JsonValue | undefined): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return null;
}
