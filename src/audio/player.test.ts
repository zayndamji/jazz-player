import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSprite = vi.fn();
vi.mock("./sprite", async (original) => ({ ...(await original<typeof import("./sprite")>()), loadSprite }));

const { Player } = await import("./player");

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
