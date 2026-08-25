import { describe, expect, it } from "vitest";
import {
  adjacentRegionRid,
  regionRidForDigit,
} from "./region-hotkeys";

const chips = [
  { rid: 0 },
  { rid: 1 },
  { rid: 3 },
  { rid: 4 },
];

describe("adjacentRegionRid", () => {
  it("wraps forward and backward", () => {
    expect(adjacentRegionRid(chips, 4, 1)).toBe(0);
    expect(adjacentRegionRid(chips, 0, -1)).toBe(4);
    expect(adjacentRegionRid(chips, 1, 1)).toBe(3);
  });

  it("falls back to first chip when current is unknown", () => {
    expect(adjacentRegionRid(chips, 999, 1)).toBe(0);
  });
});

describe("regionRidForDigit", () => {
  it("maps 1-based digits onto chips", () => {
    expect(regionRidForDigit(chips, 1)).toBe(0);
    expect(regionRidForDigit(chips, 2)).toBe(1);
    expect(regionRidForDigit(chips, 9)).toBeNull();
  });
});
