import { describe, expect, it } from "vitest";
import { parseOpenSessionRequest, parsePromptCommand } from "../src/validation.js";

describe("protocol validation", () => {
  it("parses open-session requests", () => {
    expect(parseOpenSessionRequest({ cwd: "/tmp/project", mode: "continue" })).toEqual({
      cwd: "/tmp/project",
      mode: "continue",
    });
  });

  it("rejects malformed prompt commands", () => {
    expect(() => parsePromptCommand({ message: "" })).toThrow("message");
    expect(() => parsePromptCommand({ message: "hi", streamingBehavior: "later" })).toThrow(
      "streamingBehavior",
    );
  });
});
