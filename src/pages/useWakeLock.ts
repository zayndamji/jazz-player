import { useEffect } from "react";

interface Sentinel {
  release(): Promise<void>;
}

export interface WakeLockEnv {
  request?: () => Promise<Sentinel>;
  visible: () => boolean;
  onVisible: (fn: () => void) => () => void;
}

/**
 * Holds a screen wake lock while `active`. Re-requests when the page comes back
 * to the foreground (the browser drops the lock when it is hidden). Does nothing
 * where the API is missing or the request is refused. Returns a cleanup function.
 */
export function holdWakeLock(env: WakeLockEnv): () => void {
  let sentinel: Sentinel | undefined;
  let stopped = false;
  let pending = false;

  const acquire = () => {
    if (stopped || sentinel || pending || !env.request || !env.visible()) return;
    pending = true;
    env
      .request()
      .then((s) => {
        pending = false;
        if (stopped) void s.release().catch(() => {});
        else sentinel = s;
      })
      .catch(() => {
        pending = false;
      });
  };

  const stopListening = env.onVisible(() => {
    // The browser released it while hidden; ask again now that it is back.
    if (env.visible()) {
      sentinel = undefined;
      acquire();
    }
  });
  acquire();

  return () => {
    stopped = true;
    stopListening();
    const s = sentinel;
    sentinel = undefined;
    if (s) void s.release().catch(() => {});
  };
}

/** Keeps the screen on while `active` is true. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || typeof document === "undefined") return;
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } }).wakeLock;
    return holdWakeLock({
      request: wl ? () => wl.request("screen") : undefined,
      visible: () => document.visibilityState === "visible",
      onVisible: (fn) => {
        document.addEventListener("visibilitychange", fn);
        return () => document.removeEventListener("visibilitychange", fn);
      },
    });
  }, [active]);
}
