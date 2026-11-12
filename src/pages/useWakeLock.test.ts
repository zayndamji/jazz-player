import { describe, expect, it, vi } from "vitest";
import { holdWakeLock } from "./useWakeLock";

function setup(opts: { reject?: boolean; noApi?: boolean } = {}) {
  let visible = true;
  let listener = () => {};
  const sentinels: { release: ReturnType<typeof vi.fn> }[] = [];
  const request = vi.fn(() => {
    if (opts.reject) return Promise.reject(new Error("denied"));
    const s = { release: vi.fn(() => Promise.resolve()) };
    sentinels.push(s);
    return Promise.resolve(s);
  });
  const env = {
    request: opts.noApi ? undefined : request,
    visible: () => visible,
    onVisible: (fn: () => void) => {
      listener = fn;
      return () => {
        listener = () => {};
      };
    },
  };
  const show = (v: boolean) => {
    visible = v;
    listener();
  };
  return { env, request, sentinels, show };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("holdWakeLock", () => {
  it("requests a lock and releases it on cleanup", async () => {
    const t = setup();
    const stop = holdWakeLock(t.env);
    await tick();
    expect(t.request).toHaveBeenCalledTimes(1);
    stop();
    expect(t.sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after cleanup", async () => {
    const t = setup();
    holdWakeLock(t.env)();
    await tick();
    expect(t.sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("asks again when the page becomes visible", async () => {
    const t = setup();
    holdWakeLock(t.env);
    await tick();
    t.show(false);
    await tick();
    expect(t.request).toHaveBeenCalledTimes(1);
    t.show(true);
    await tick();
    expect(t.request).toHaveBeenCalledTimes(2);
  });

  it("does nothing without the API or when refused", async () => {
    const none = setup({ noApi: true });
    expect(() => holdWakeLock(none.env)()).not.toThrow();
    const refused = setup({ reject: true });
    const stop = holdWakeLock(refused.env);
    await tick();
    expect(() => stop()).not.toThrow();
  });
});
