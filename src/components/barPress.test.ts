import { describe, expect, it } from "vitest";
import { neighbourRow, tabStop } from "./barPress";

describe("tabStop", () => {
  const keys = ["a", "b", "c"];
  it("prefers the current bar, then the cued one, then the first", () => {
    expect(tabStop(keys, "b", "c")).toBe(1);
    expect(tabStop(keys, null, "c")).toBe(2);
    expect(tabStop(keys, null, null)).toBe(0);
    expect(tabStop(keys, "zz", null)).toBe(0);
  });
});

describe("neighbourRow", () => {
  it("keeps the column and clamps to a shorter row", () => {
    expect(neighbourRow([4, 4, 2], 0, 3, 1)).toEqual({ row: 1, col: 3 });
    expect(neighbourRow([4, 4, 2], 1, 3, 1)).toEqual({ row: 2, col: 1 });
  });
  it("stops at the ends", () => {
    expect(neighbourRow([4, 4], 0, 0, -1)).toBeNull();
    expect(neighbourRow([4, 4], 1, 0, 1)).toBeNull();
  });
});
