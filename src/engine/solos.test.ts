import { describe, expect, it } from "vitest";
import type { Chart } from "../chart/types";
import { latinForm, swingForm } from "../fixtures";
import { validateChart } from "../charts";
import { STYLES } from "../styles";
import { bandFor, buildSchedule, chartStyles } from "./schedule";
import { playOrder } from "./timeline";

describe("solo choruses", () => {
  // Latin A's and a swing bridge in the head, every solo chorus swung.
  const swungSolos: Chart = { ...latinForm, id: "swung-solos", soloStyle: "swing" };

  it("plays the solo choruses in the chart's solo style and the heads as written", () => {
    expect(validateChart(swungSolos)).toEqual([]);
    const s = buildSchedule(swungSolos, STYLES.latin, { choruses: 4, countIn: false, transpose: 0 });
    const form = s.bars.filter((b) => b.ref?.part === "form" && !b.tonic);
    for (const b of form) {
      const head = b.chorus === 1 || b.chorus === 4;
      const written = latinForm.form[b.ref!.section].style ?? latinForm.style;
      expect(b.style, `chorus ${b.chorus} section ${b.ref!.section}`).toBe(head ? written : "swing");
    }
    // The solo choruses walk: no Latin bell or tumbao in them.
    const solo = form.filter((b) => b.chorus === 2);
    expect(s.events.some((e) => e.drum === "bell" && solo.some((b) => e.time >= b.startBeat - 0.12 && e.time < b.startBeat + 3.88))).toBe(false);
  });

  it("keeps the written styles in a looped section and in another chosen style", () => {
    const looped = buildSchedule(swungSolos, STYLES.latin, { choruses: 2, countIn: false, transpose: 0, loopSection: 0 });
    expect(looped.bars.every((b) => b.style === "latin")).toBe(true);
    const other = buildSchedule(swungSolos, STYLES.bossa, { choruses: 3, countIn: false, transpose: 0 });
    expect(other.bars.every((b) => b.style === "bossa")).toBe(true);
  });

  it("counts the solo style among the chart's styles", () => {
    const bossaSolos: Chart = { ...swingForm, soloStyle: "bossa" };
    expect(chartStyles(bossaSolos).map((s) => s.id)).toEqual(["swing", "bossa"]);
    expect(bandFor(bossaSolos, STYLES.swing)).toContain("guitar");
  });

  // A head of A B and solos on C A B, the vamp first (Autumn Serenade on the record).
  const vampFirst: Chart = {
    ...swingForm,
    id: "vamp-first",
    intro: undefined,
    ending: undefined,
    form: [
      { label: "A", bars: ["Cmaj7", "%", "Dm7", "G7"] },
      { label: "B", bars: ["Em7", "A7", "Dm7", "G7"] },
      { label: "C", play: "solos", bars: ["Cmaj7", "G7", "Cmaj7", "G7"] },
    ],
    soloOrder: [2, 0, 1],
  };

  it("plays a solo chorus's sections in the solo order", () => {
    expect(validateChart(vampFirst)).toEqual([]);
    const sections = (c: number) => [...new Set(playOrder(vampFirst, 3).filter((i) => i.chorus === c && !i.tonic).map((i) => vampFirst.form[i.ref.section].label))];
    expect(sections(1)).toEqual(["A", "B"]);
    expect(sections(2)).toEqual(["C", "A", "B"]);
    expect(sections(3)).toEqual(["A", "B"]);
    // Until stopped, every chorus after the first is a solo.
    const s = buildSchedule(vampFirst, STYLES.swing, { choruses: "loop", countIn: false, transpose: 0 });
    const second = s.bars.filter((b) => b.chorus === 2 && b.ref?.part === "form");
    expect(second.slice(0, 4).every((b) => b.ref!.section === 2)).toBe(true);
  });

  it("refuses a solo order that names a missing or head-only section", () => {
    expect(validateChart({ ...vampFirst, soloOrder: [5] })).not.toEqual([]);
    expect(validateChart({ ...vampFirst, soloOrder: [] })).not.toEqual([]);
    expect(validateChart({ ...vampFirst, form: vampFirst.form.map((s, i) => (i === 0 ? { ...s, play: "head" as const } : s)), soloOrder: [2, 0] })).not.toEqual([]);
  });
});
