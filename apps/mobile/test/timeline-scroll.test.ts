import { describe, expect, it } from "vitest";
import {
  distanceFromBottom,
  isNearBottom,
  nextPinnedToBottom,
} from "../src/timeline-scroll.js";

describe("timeline scroll stickiness", () => {
  it("calculates distance from the bottom without negative values", () => {
    expect(
      distanceFromBottom({ contentHeight: 1000, layoutHeight: 400, offsetY: 550 }),
    ).toBe(50);
    expect(
      distanceFromBottom({ contentHeight: 300, layoutHeight: 400, offsetY: 0 }),
    ).toBe(0);
  });

  it("treats scroll positions within the bottom threshold as pinned", () => {
    expect(
      isNearBottom({ contentHeight: 1000, layoutHeight: 400, offsetY: 553 }),
    ).toBe(true);
    expect(
      isNearBottom({ contentHeight: 1000, layoutHeight: 400, offsetY: 500 }),
    ).toBe(false);
  });

  it("keeps stickiness during content growth until the automatic scroll catches up", () => {
    expect(
      nextPinnedToBottom(
        true,
        { contentHeight: 1200, layoutHeight: 400, offsetY: 600 },
        false,
      ),
    ).toBe(true);
  });

  it("releases stickiness only when the user scrolls away from the bottom", () => {
    expect(
      nextPinnedToBottom(
        true,
        { contentHeight: 1000, layoutHeight: 400, offsetY: 300 },
        true,
      ),
    ).toBe(false);
  });

  it("restores stickiness when the user returns to the bottom", () => {
    expect(
      nextPinnedToBottom(
        false,
        { contentHeight: 1000, layoutHeight: 400, offsetY: 570 },
        true,
      ),
    ).toBe(true);
  });
});
