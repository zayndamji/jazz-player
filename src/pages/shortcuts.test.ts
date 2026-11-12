import { describe, expect, it } from "vitest";
import { leaveAlone } from "./shortcuts";

/** A stand-in for a focused element: `closest` finds it when its tag or role is in the selector. */
const key = (code: string, tags: string[], inPanel = false) => {
  const target = {
    closest: (selector: string) => {
      const parts = selector.split(",").map((p) => p.trim());
      if (tags.some((t) => parts.includes(t))) return target;
      if (inPanel && parts.includes(".panel")) return target;
      return null;
    },
  };
  return { target, code } as unknown as KeyboardEvent;
};

describe("keys inside the More panel", () => {
  it("still go to the page from a button in the panel", () => {
    expect(leaveAlone(key("ArrowRight", ["button"], true))).toBe(false);
    expect(leaveAlone(key("ArrowLeft", [], true))).toBe(false);
  });

  it("stay with a select, input or slider in the panel", () => {
    for (const tag of ["select", "input", '[role="slider"]']) expect(leaveAlone(key("ArrowRight", [tag], true))).toBe(true);
    expect(leaveAlone(key("Space", ["select"], true))).toBe(true);
  });

  it("stay with the shortcuts dialog", () => {
    expect(leaveAlone(key("ArrowRight", ["dialog"]))).toBe(true);
  });
});
