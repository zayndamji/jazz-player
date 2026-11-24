import { beforeEach, describe, expect, it } from "vitest";
import { readStored, store } from "./storage";

const local = new Map<string, string>();
const fake = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) } as Storage;
beforeEach(() => {
  local.clear();
  Object.assign(globalThis, { localStorage: fake });
});

describe("stored settings", () => {
  it("reads a setting saved under the site's earlier names", () => {
    local.set("jazz-teacher.muted", "1");
    expect(readStored("bandstand.muted")).toBe("1");
    local.set("jazz-player.muted", "0");
    expect(readStored("bandstand.muted")).toBe("0");
    store("bandstand.muted", "1");
    expect(readStored("bandstand.muted")).toBe("1");
  });

  it("returns null when no name has the setting", () => {
    expect(readStored("bandstand.volume")).toBeNull();
    local.set("jazz-player.volume", "0.5");
    expect(readStored("jazz-player.volume")).toBe("0.5");
    expect(readStored("other.volume")).toBeNull();
  });
});
