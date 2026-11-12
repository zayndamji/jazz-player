import { useEffect, useRef, useState } from "react";
import { TEMPO } from "../chart/types";
import { shortcut, withKey } from "../pages/shortcuts";

export const clampTempo = (bpm: number) => Math.min(TEMPO.max, Math.max(TEMPO.min, Math.round(bpm)));

/** How long a button is held before it starts repeating, and the gap between repeats, in ms. */
export const HOLD_DELAY = 400;
export const HOLD_EVERY = 80;
const STEP = 5;

interface Props {
  tempo: number;
  /** The chart's own tempo, for the tooltip and the reset button. */
  original: number;
  onTempo: (bpm: number) => void;
}

/** Tempo with − and + that repeat while held, and a number you can click to type a tempo. */
export function TempoControl({ tempo, original, onTempo }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const latest = useRef(tempo);
  latest.current = tempo;
  const hold = useRef<{ delay: number; every: number } | null>(null);
  /** Set when Escape or a commit has already closed the field, so the blur that follows does nothing. */
  const closed = useRef(false);

  const stop = () => {
    if (!hold.current) return;
    window.clearTimeout(hold.current.delay);
    window.clearInterval(hold.current.every);
    hold.current = null;
  };
  useEffect(() => stop, []);

  const press = (direction: 1 | -1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    stop();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const step = () => onTempo(clampTempo(latest.current + direction * STEP));
    step();
    hold.current = {
      delay: window.setTimeout(() => {
        if (!hold.current) return;
        hold.current.every = window.setInterval(step, HOLD_EVERY);
      }, HOLD_DELAY),
      every: 0,
    };
  };
  // A key press on a focused button clicks it with no pointer (detail 0); pointer clicks are handled on press.
  const keyClick = (direction: 1 | -1) => (e: React.MouseEvent) => {
    if (e.detail === 0) onTempo(clampTempo(latest.current + direction * STEP));
  };

  const open = () => {
    closed.current = false;
    setDraft(String(tempo));
    setEditing(true);
  };
  const commit = () => {
    if (closed.current) return;
    closed.current = true;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onTempo(clampTempo(n));
    setEditing(false);
  };
  const cancel = () => {
    closed.current = true;
    setEditing(false);
  };

  const slower = shortcut("slower");
  const faster = shortcut("faster");
  return (
    <div className="tempo" role="group" aria-label="Tempo" title={`Tempo (original ${original} BPM)`}>
      <button
        type="button"
        aria-label="Slower"
        aria-keyshortcuts={slower.aria}
        title={withKey("Slower", "slower")}
        onPointerDown={press(-1)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onClick={keyClick(-1)}
      >
        −
      </button>
      <span className="tempo-value">
        {editing ? (
          <input
            type="number"
            className="tempo-input"
            aria-label="Tempo in BPM"
            min={TEMPO.min}
            max={TEMPO.max}
            value={draft}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") {
                e.stopPropagation();
                cancel();
              }
            }}
          />
        ) : (
          <button type="button" className="tempo-number" title="Type a tempo" aria-label={`${tempo} BPM, type a tempo`} onClick={open}>
            <strong>{tempo}</strong>
          </button>
        )}{" "}
        BPM
      </span>
      <button
        type="button"
        aria-label="Faster"
        aria-keyshortcuts={faster.aria}
        title={withKey("Faster", "faster")}
        onPointerDown={press(1)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onClick={keyClick(1)}
      >
        +
      </button>
    </div>
  );
}
