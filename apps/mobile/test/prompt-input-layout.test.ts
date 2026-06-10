import { describe, expect, it } from "vitest";
import {
  PROMPT_INPUT_LINE_HEIGHT,
  PROMPT_INPUT_MAX_HEIGHT,
  PROMPT_INPUT_MAX_VISIBLE_LINES,
  PROMPT_INPUT_VERTICAL_PADDING,
} from "../src/prompt-input-layout.js";

const EXPECTED_MAX_VISIBLE_LINES = 5;

describe("prompt input layout", () => {
  it("caps the prompt input at five visible text lines", () => {
    expect(PROMPT_INPUT_MAX_VISIBLE_LINES).toBe(EXPECTED_MAX_VISIBLE_LINES);
    expect(PROMPT_INPUT_MAX_HEIGHT).toBe(
      PROMPT_INPUT_LINE_HEIGHT * EXPECTED_MAX_VISIBLE_LINES
        + PROMPT_INPUT_VERTICAL_PADDING * 2,
    );
  });
});
