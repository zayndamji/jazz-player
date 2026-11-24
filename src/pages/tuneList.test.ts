import { beforeEach, describe, expect, it } from "vitest";
import type { Chart } from "../chart/types";
import { balladForm, bossaForm, latinForm, swingForm } from "../fixtures";
import { countLabel, listTunes, readOpened, readView, recordOpened, saveView } from "./tuneList";

const local = new Map<string, string>();
const session = new Map<string, string>();
const fake = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }) as Storage;
beforeEach(() => {
  local.clear();
  session.clear();
  Object.assign(globalThis, { localStorage: fake(local), sessionStorage: fake(session) });
});

const charts: Chart[] = [swingForm, bossaForm, balladForm];
const view = { query: "", style: "", sort: "az" as const };

describe("library list", () => {
  it("sorts A to Z, filters by search and style", () => {
    const titles = listTunes(charts, view, {}).map((c) => c.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    expect(listTunes(charts, { ...view, query: "BOSSA" }, {}).map((c) => c.id)).toEqual([bossaForm.id]);
    expect(listTunes(charts, { ...view, style: "ballad" }, {}).map((c) => c.id)).toEqual([balladForm.id]);
  });

  it("lists a tune under every style its sections play", () => {
    const all = [...charts, latinForm];
    expect(listTunes(all, { ...view, style: "latin" }, {}).map((c) => c.id)).toEqual([latinForm.id]);
    expect(listTunes(all, { ...view, style: "swing" }, {}).map((c) => c.id)).toEqual([latinForm.id, swingForm.id]);
  });

  it("puts the most recently opened first, the rest A to Z", () => {
    const got = listTunes(charts, { ...view, sort: "recent" }, { [balladForm.id]: 10, [swingForm.id]: 20 }).map((c) => c.id);
    expect(got).toEqual([swingForm.id, balladForm.id, bossaForm.id]);
    const none = listTunes(charts, { ...view, sort: "recent" }, {}).map((c) => c.id);
    expect(none).toEqual(listTunes(charts, view, {}).map((c) => c.id));
  });

  it("counts tunes, saying how many are shown when filtered", () => {
    expect(countLabel(11, 11)).toBe("11 tunes");
    expect(countLabel(4, 11)).toBe("4 of 11 tunes");
    expect(countLabel(1, 1)).toBe("1 tune");
  });
});

describe("remembering the list and when tunes opened", () => {
  it("keeps search, style and sort for the visit", () => {
    expect(readView()).toEqual(view);
    saveView({ query: "blue", style: "swing", sort: "recent" });
    expect(readView()).toEqual({ query: "blue", style: "swing", sort: "recent" });
    session.set("jazz-stand.library", '{"query":5,"sort":"x"}');
    expect(readView()).toEqual(view);
  });

  it("records the time a tune opened", () => {
    recordOpened("a", 100);
    recordOpened("b", 200);
    recordOpened("a", 300);
    expect(readOpened()).toEqual({ a: 300, b: 200 });
    local.set("jazz-stand.opened", "nonsense");
    expect(readOpened()).toEqual({});
  });
});
