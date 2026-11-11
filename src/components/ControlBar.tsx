import { useEffect, useRef, useState, type ReactNode } from "react";
import { shortcut, withKey } from "../pages/shortcuts";

export type View = "chords" | "sheet";

interface Props {
  status: "idle" | "loading" | "playing";
  onPlay: () => void;
  tempo: number;
  onTempo: (bpm: number) => void;
  where: string;
  detail: string | null;
  /** 0 to 1 through the song, or null when stopped. */
  progress: number | null;
  onSeek: (fraction: number) => void;
  beat: number | null;
  beats: number;
  view: View;
  onView: ((v: View) => void) | null;
  loopLabel: string | null;
  onLoop: () => void;
  metronome: boolean;
  onMetronome: (on: boolean) => void;
  muted: boolean;
  onMuted: (muted: boolean) => void;
  /** Go back to the top; shown only while paused away from it. */
  onFromTop: (() => void) | null;
  /** Everything that isn't needed while playing. */
  settings: ReactNode;
  /** Open the keyboard shortcuts list. */
  onHelp: () => void;
}

/** The one control bar, fixed to the bottom of the window like a player. */
export function ControlBar(p: Props) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  // Only offer the shortcuts list where there's likely a keyboard (not on phones).
  const [keyboard, setKeyboard] = useState(() => matchMedia("(any-pointer: fine)").matches);
  useEffect(() => {
    if (keyboard) return;
    const seen = () => setKeyboard(true);
    window.addEventListener("keydown", seen, { once: true });
    return () => window.removeEventListener("keydown", seen);
  }, [keyboard]);
  const playing = p.status === "playing";

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      moreButton.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <section className="controlbar" aria-label="Player">
      <div
        className="progress"
        role="slider"
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((p.progress ?? 0) * 100)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          p.onSeek((e.clientX - r.left) / r.width);
        }}
      >
        <div className="progress-fill" style={{ width: `${(p.progress ?? 0) * 100}%` }} />
      </div>
      <div className="controlbar-row">
        <button
          type="button"
          className="play"
          onClick={p.onPlay}
          disabled={p.status === "loading"}
          aria-keyshortcuts="Space"
          title={withKey(playing ? "Pause" : "Play", "play")}
          aria-label={playing ? "Pause" : "Play"}
        >
          <span className={`play-icon${playing ? " pause" : ""}`} aria-hidden="true" />
        </button>

        <div className="position">
          <div className="position-main">
            <span className="beats" aria-hidden="true">
              {Array.from({ length: p.beats }, (_, i) => (
                <span key={i} className={`beat${p.beat === i ? " on" : ""}`} />
              ))}
            </span>
            <span>{p.status === "loading" ? "Loading sounds…" : p.where || "Ready"}</span>
            {p.onFromTop && (
              <button type="button" className="from-top" aria-keyshortcuts="Home" title={withKey("From the top", "start")} onClick={p.onFromTop}>
                From the top
              </button>
            )}
          </div>
          {p.detail && <div className="position-detail">{p.detail}</div>}
        </div>

        <div className="tempo" aria-label="Tempo">
          <button type="button" aria-label="Slower" aria-keyshortcuts={shortcut("slower").aria} title={withKey("Slower", "slower")} onClick={() => p.onTempo(Math.max(60, p.tempo - 5))}>
            −
          </button>
          <span className="tempo-value">
            <strong>{p.tempo}</strong> BPM
          </span>
          <button type="button" aria-label="Faster" aria-keyshortcuts={shortcut("faster").aria} title={withKey("Faster", "faster")} onClick={() => p.onTempo(Math.min(240, p.tempo + 5))}>
            +
          </button>
        </div>

        {p.onView && (
          <div className="segmented" role="group" aria-label="View" aria-keyshortcuts="V" title={withKey("Switch view", "view")}>
            <button type="button" aria-pressed={p.view === "chords"} onClick={() => p.onView!("chords")}>
              Chords
            </button>
            <button type="button" aria-pressed={p.view === "sheet"} onClick={() => p.onView!("sheet")}>
              <span className="long">Lead sheet</span>
              <span className="short">Sheet</span>
            </button>
          </div>
        )}

        <button type="button" className="toggle" aria-pressed={!!p.loopLabel} aria-keyshortcuts="L" title={withKey("Loop", "loop")} onClick={p.onLoop}>
          {p.loopLabel ? `Loop ${p.loopLabel}` : "Loop"}
        </button>
        <button type="button" className="toggle" aria-pressed={p.metronome} aria-keyshortcuts="C" title={withKey("Metronome", "click")} onClick={() => p.onMetronome(!p.metronome)}>
          <span className="long">Metronome</span>
          <span className="short">Click</span>
        </button>

        <button type="button" className="toggle" aria-pressed={p.muted} aria-keyshortcuts="M" title={withKey("Mute", "mute")} onClick={() => p.onMuted(!p.muted)}>
          {p.muted ? "Muted" : "Mute"}
        </button>

        <div className="more" ref={panel}>
          <button type="button" ref={moreButton} className="toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            More
          </button>
          {open && (
            <div className="panel">
              {p.settings}
              {keyboard && (
                <button
                  type="button"
                  className="shortcuts-button"
                  aria-keyshortcuts="Shift+?"
                  onClick={() => {
                    setOpen(false);
                    p.onHelp();
                  }}
                >
                  Keyboard shortcuts
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
