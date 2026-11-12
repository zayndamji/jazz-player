import { useRef, type MouseEvent, type PointerEvent } from "react";

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
