import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSchedule } from "../engine/schedule";
import { importSource } from "../import";
import { STYLES } from "../styles";
import { bossaSong, irealLink, swingSong } from "../import/fixtures/ireal";
import swing from "../import/fixtures/rehearsal-and-endings.musicxml?raw";
import { addImported, allCharts, findChart, IMPORTED_KEY, isImported, readImported, removeImported } from "./imported";
import { CHARTS, validateChart } from ".";

/** A minimal localStorage, since tests run without a browser. */
function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

describe("importing from text", () => {
  it("reads MusicXML and iReal links, and checks the charts", () => {
    const xml = importSource(swing, "swing.musicxml");
    expect(xml.charts).toHaveLength(1);
    expect(validateChart(xml.charts[0])).toEqual([]);
    const link = importSource(irealLink([swingSong]));
    expect(link.charts.map((c) => c.title)).toEqual(["Made Up Swing"]);
  });

  it("gives charts the band can play in every style", () => {
    for (const chart of [...importSource(swing, "a.musicxml").charts, ...importSource(irealLink([swingSong, bossaSong])).charts]) {
      for (const style of Object.values(STYLES)) expect(buildSchedule(chart, style, { choruses: 2, countIn: true, transpose: 0 }).events.length).toBeGreaterThan(0);
    }
  });

  it("says in one sentence what went wrong", () => {
    expect(() => importSource("hello")).toThrow("That is not a MusicXML file or an iReal Pro link.");
    expect(() => importSource("PK\u0003\u0004", "a.mxl")).toThrow(/mxl/);
    expect(() => importSource("<score-partwise><part/></score-partwise>")).toThrow(/chord symbols/);
    expect(() => importSource("irealb://nonsense")).toThrow(/iReal Pro/);
  });
});

describe("imported charts in storage", () => {
  beforeEach(() => {
    stubStorage();
  });

  it("stores charts under the imported- prefix and finds them", () => {
    const [chart] = importSource(irealLink([swingSong])).charts;
    const [added] = addImported([chart]);
    expect(added.id).toBe("imported-made-up-swing");
    expect(isImported(added)).toBe(true);
    expect(findChart(added.id)).toEqual(added);
    expect(allCharts().map((c) => c.id)).toEqual([...CHARTS.map((c) => c.id), added.id]);
    expect(CHARTS.some((c) => isImported(c))).toBe(false);
  });

  it("replaces a tune imported again and numbers same-titled songs in one file", () => {
    const [chart] = importSource(irealLink([swingSong])).charts;
    addImported([chart]);
    addImported([{ ...chart, tempo: 100 }]);
    expect(readImported()).toHaveLength(1);
    expect(readImported()[0].tempo).toBe(100);
    const two = addImported([chart, chart]);
    expect(two.map((c) => c.id)).toEqual(["imported-made-up-swing", "imported-made-up-swing-2"]);
  });

  it("removes a tune", () => {
    const [a, b] = addImported(importSource(irealLink([swingSong, bossaSong])).charts);
    removeImported(a.id);
    expect(readImported().map((c) => c.id)).toEqual([b.id]);
    expect(findChart(a.id)).toBeUndefined();
  });

  it("ignores damaged storage and survives it being unavailable", () => {
    stubStorage({ [IMPORTED_KEY]: "{not json" });
    expect(readImported()).toEqual([]);
    stubStorage({ [IMPORTED_KEY]: JSON.stringify([{ id: "imported-bad", title: "x" }, { id: "blues-in-f" }, 7]) });
    expect(readImported()).toEqual([]);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readImported()).toEqual([]);
    expect(() => addImported(importSource(irealLink([swingSong])).charts)).not.toThrow();
  });

  it("falls back to swing for a style the site doesn't have", () => {
    const [chart] = importSource(irealLink([swingSong])).charts;
    stubStorage({ [IMPORTED_KEY]: JSON.stringify([{ ...chart, id: "imported-x", style: "polka" }]) });
    expect(readImported()[0].style).toBe("swing");
  });
});
