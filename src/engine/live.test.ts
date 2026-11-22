import { describe, expect, it } from "vitest";
import { swingForm } from "../fixtures";
import { swing } from "../styles/swing";
import { buildSchedule, type PlaybackOptions } from "./schedule";

const opts: PlaybackOptions = { choruses: "loop", countIn: true, transpose: 0 };
const looping = buildSchedule(swingForm, swing, opts);

describe("live", () => {
  it("ends after the chosen chorus with the ending, keeping every bar before it in place", () => {
    const ended = buildSchedule(swingForm, swing, { ...opts, liveEnd: 2 });
    expect(ended.loop).toBeNull();
    const lastOfChorus = looping.bars.map((b) => b.chorus).lastIndexOf(2);
    for (let i = 0; i <= lastOfChorus; i++) {
      expect(ended.bars[i].ref).toEqual(looping.bars[i].ref);
      expect(ended.bars[i].startBeat).toBe(looping.bars[i].startBeat);
    }
    const rest = ended.bars.slice(lastOfChorus + 1);
    expect(rest.length).toBe(swingForm.ending!.reduce((n, s) => n + s.bars.length * (s.repeat ?? 1), 0));
    expect(rest.every((b) => b.ref?.part === "ending")).toBe(true);
    expect(ended.bars.at(-1)!.final).toBe(true);
  });

  it("ends after the head when pressed in the first chorus", () => {
    const ended = buildSchedule(swingForm, swing, { ...opts, liveEnd: 1 });
    expect(ended.bars.some((b) => b.chorus === 2)).toBe(false);
    expect(ended.bars.at(-1)!.ref?.part).toBe("ending");
  });

  it("stops at the chorus's end on the held tonic when the ending is off", () => {
    const ended = buildSchedule(swingForm, swing, { ...opts, ending: false, liveEnd: 2 });
    const last = ended.bars.at(-1)!;
    expect(last.chorus).toBe(2);
    expect(last.tonic).toBe(true);
    expect(last.final).toBe(true);
    expect(last.ref).toEqual(ended.bars.at(-2)!.ref);
    expect(ended.loop).toBeNull();
  });
});
