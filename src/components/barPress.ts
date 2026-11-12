import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";

/** How long a touch is held on a bar to loop up to it, in ms. */
export const HOLD_TO_LOOP = 500;

/**
 * What a bar does when pressed: a click plays from it, Shift-click (or a press
 * and hold with a finger) loops from the bar last clicked up to it.
 * Returns the event props for a bar identified by `key`.
 */
export function useBarPress<K>(onBar: (key: K) => void, onRange: (key: K) => void) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const touching = useRef(false);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (key: K) => ({
    onPointerDown: (e: PointerEvent) => {
      held.current = false;
      touching.current = e.pointerType === "touch";
      if (!touching.current) return;
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        held.current = true;
        onRange(key);
      }, HOLD_TO_LOOP);
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // A long press would open the browser's menu on a touch screen.
    onContextMenu: (e: MouseEvent) => {
      if (touching.current) e.preventDefault();
    },
    onClick: (e: MouseEvent) => {
      cancel();
      if (held.current) {
        held.current = false;
        return;
      }
      if (e.shiftKey) onRange(key);
      else onBar(key);
    },
  });
}

/** Smooth scrolling unless the person asked for less motion. */
export const scrollBehavior = (): ScrollBehavior =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/**
 * Which bar is the grid's one Tab stop: the current bar, else the cued one, else the first.
 * Returns an index into `keys`, or 0.
 */
export function tabStop<K>(keys: K[], current: K | null, cued: K | null, same: (a: K, b: K) => boolean = (a, b) => a === b): number {
  for (const want of [current, cued]) {
    if (want === null) continue;
    const i = keys.findIndex((k) => same(k, want));
    if (i >= 0) return i;
  }
  return 0;
}

/** The bar one row up or down in a grid of rows with the given lengths, keeping the column where it can. */
export function neighbourRow(rowLengths: number[], row: number, col: number, direction: 1 | -1): { row: number; col: number } | null {
  const next = row + direction;
  if (next < 0 || next >= rowLengths.length || rowLengths[next] === 0) return null;
  return { row: next, col: Math.min(col, rowLengths[next] - 1) };
}

/**
 * Keeps DOM focus on the current bar while the playhead or cue moves, but only
 * when focus is already inside `root` and the last input there was the keyboard,
 * so a click on a bar (Space then still pauses) and controls elsewhere keep their focus.
 * Spread the result on the container.
 */
export function useFocusFollow(root: RefObject<HTMLElement | null>, find: () => HTMLElement | null, key: string) {
  const byKey = useRef(false);
  useEffect(() => {
    const r = root.current;
    if (!byKey.current || !r || !r.contains(document.activeElement)) return;
    const el = find();
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    onKeyDownCapture: () => {
      byKey.current = true;
    },
    onPointerDownCapture: () => {
      byKey.current = false;
    },
  };
}
