import { describe, expect, it } from "vitest";
import { latinForm, swingForm } from "../fixtures";
import { barName, barsLabel, sectionName, shownNumber, styleNames } from "./format";

const bar = (part: "intro" | "form" | "ending", number: number) => ({ ref: { part }, number });

describe("bar numbers as shown", () => {
  it("counts the form from 1, leaves the intro unnumbered and runs the ending on", () => {
    expect(shownNumber(bar("intro", 3), 4)).toBeNull();
    expect(shownNumber(bar("form", 5), 4)).toBe(1);
    expect(shownNumber(bar("ending", 37), 4)).toBe(33);
    expect(shownNumber(bar("form", 1), 0)).toBe(1);
  });

  it("names bars and runs of bars", () => {
    expect(barName(bar("intro", 2), 4)).toBe("Intro bar 2");
    expect(barName(bar("form", 13), 4)).toBe("Bar 9");
    expect(barsLabel(bar("form", 13), bar("form", 16), 4)).toBe("Bars 9-12");
    expect(barsLabel(bar("form", 13), bar("form", 13), 4)).toBe("Bar 9");
    expect(barsLabel(bar("intro", 1), bar("intro", 2), 4)).toBe("Intro bars 1-2");
    expect(barsLabel(bar("intro", 3), bar("form", 8), 4)).toBe("Intro to bar 4");
  });
});

describe("section names", () => {
  it("calls a coda the ending and keeps other names", () => {
    expect(sectionName("Coda")).toBe("Ending");
    expect(sectionName("Tag")).toBe("Tag");
    expect(sectionName("A")).toBe("A");
  });
});

describe("style names", () => {
  it("names every style a tune's sections play", () => {
    expect(styleNames(latinForm)).toBe("Latin and swing");
    expect(styleNames(swingForm)).toBe("Swing");
  });
});
