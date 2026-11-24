import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSprite = vi.fn();
vi.mock("./sprite", async (original) => ({ ...(await original<typeof import("./sprite")>()), loadSprite }));

const { Player, swappedIn } = await import("./player");
const { buildSchedule } = await import("../engine/schedule");
const { STYLES } = await import("../styles");
const { latinForm } = await import("../fixtures");

describe("Player.preload", () => {
  beforeEach(() => loadSprite.mockReset());

  it("fetches the four sample files once, however often it's called", async () => {
    loadSprite.mockResolvedValue({});
    const p = new Player();
    await Promise.all([p.preload(), p.preload()]);
    await p.preload();
    expect(loadSprite).toHaveBeenCalledTimes(4);
    const files = loadSprite.mock.calls.map(([url]) => url as string);
    for (const name of ["piano", "bass", "guitar", "drums"]) expect(files.some((f) => f.includes(name))).toBe(true);
  });

  it("tries again after a failed fetch", async () => {
    loadSprite.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const p = new Player();
    await expect(p.preload()).rejects.toThrow("offline");
    await p.preload();
    expect(loadSprite).toHaveBeenCalledTimes(8);
  });
});

describe("Player master level", () => {
  it("can be set before the audio starts", () => {
    const p = new Player();
    expect(() => {
      p.setMasterLevel(0.4);
      p.setMasterMute(true);
      p.setMasterMute(false);
    }).not.toThrow();
  });
});

describe("swapping a schedule in place", () => {
  const schedule = buildSchedule(latinForm, STYLES.latin, { choruses: 2, countIn: false, transpose: 0 });

  it("strikes again on the swap's beat the notes that should still be sounding there", () => {
    for (const at of [9, 18.5, 33]) {
      const swapped = swappedIn(schedule, at);
      const ringing = schedule.events.filter((e) => e.track !== "drums" && e.time < at - 0.01 && e.time + e.duration > at + 0.4);
      const added = swapped.events.filter((e) => Math.abs(e.time - at) < 1e-9 && !schedule.events.includes(e));
      expect(added.length).toBe(ringing.length);
      for (const e of added) expect(e.track).not.toBe("drums");
      // Each carries the rest of its note, ending where the original would.
      added.forEach((e, k) => expect(e.time + e.duration).toBeCloseTo(ringing[k].time + ringing[k].duration, 9));
    }
  });

  it("adds nothing inside a loop's repeating copies", () => {
    const looped = buildSchedule(latinForm, STYLES.latin, { choruses: 2, countIn: false, transpose: 0, loopSection: 0 });
    expect(looped.loop).not.toBeNull();
    const at = looped.loop!.start + 5;
    expect(swappedIn(looped, at).events.length).toBe(looped.events.length);
  });
});
