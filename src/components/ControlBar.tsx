import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { withKey } from "../pages/shortcuts";
import { TempoControl } from "./TempoControl";

export type View = "chords" | "sheet";

/** The readout's second line while playing: the scale for the chord, its notes, and the next chord. */
export interface ScaleDetail {
  /** "D dorian" */
  scale: string;
  /** "D E F G A B C" */
  notes: string;
  /** "next G7", or null when the chord doesn't change soon. */
  next: string | null;
}

/** What a key press on the progress line means. */
export type ProgressStep = "bar-back" | "bar-on" | "section-back" | "section-on" | "start" | "end";

const PROGRESS_KEYS: Record<string, ProgressStep> = {
  ArrowLeft: "bar-back",
  ArrowRight: "bar-on",
  PageUp: "section-back",
  PageDown: "section-on",
  Home: "start",
  End: "end",
};

interface Props {
  status: "idle" | "loading" | "playing";
  onPlay: () => void;
  /** While playing, what the play button does when it isn't a plain pause (Live), and its icon. */
  playAction?: { label: string; icon: "stop" } | null;
  tempo: number;
  /** The chart's own tempo. */
  originalTempo: number;
  onTempo: (bpm: number) => void;
  /** The place: "Bar 7 · Chorus 1 of 3". Always shown in full. */
  where: string;
  /** Before the place ("Paused"); left out when the line doesn't fit. */
  wherePrefix?: string;
  /** What follows the place (whose turn it is in a trade, "Ending after this chorus"); left out first. */
  whereMore?: string;
  detail: ScaleDetail | null;
  /** 0 to 1 through the song, or null when stopped. */
  progress: number | null;
  onSeek: (fraction: number) => void;
  /** Keys on the progress line. */
  onStep: (step: ProgressStep) => void;
  /** The readout, for screen readers on the progress line. */
  progressText: string;
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
  /** A bar back or on, for narrow and touch screens where there are no arrow keys. */
  onPrevBar: () => void;
  onNextBar: () => void;
  /** Open the keyboard shortcuts list. */
  onHelp: () => void;
}

/**
 * Leave out parts of a one-line element, in the order given, until it fits (on every change of `key` and of
 * its width). Parts are found by selector inside it.
 */
function useFit(ref: RefObject<HTMLElement | null>, parts: string[], key: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const found = parts.map((s) => el.querySelector<HTMLElement>(s));
      found.forEach((part) => part && (part.hidden = false));
      for (const part of found) if (part && el.scrollWidth > el.clientWidth + 1) part.hidden = true;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [key]);
}

/** The one control bar, fixed to the bottom of the window like a player. */
export function ControlBar(p: Props) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
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

  // The readout shortens to fit, so the place and the scale always show: the first line leaves out what follows
  // the place, then "Paused"; the scale line the notes, then the next chord.
  const main = useRef<HTMLSpanElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useFit(main, [".where-more", ".where-prefix"], `${p.status}|${p.wherePrefix}|${p.where}|${p.whereMore}`);
  useFit(detail, [".detail-notes", ".detail-next"], p.detail ? `${p.detail.scale}|${p.detail.notes}|${p.detail.next}` : "");

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (panel.current?.contains(e.target as Node)) return;
      setOpen(false);
      // Focus left on a menu or checkbox in the panel would keep Space and the arrows from the page.
      if (panel.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      // A tap on the player bar's own controls closes the panel and does what it says (More itself only closes it).
      const target = e.target as HTMLElement;
      if (bar.current?.contains(target) && !moreButton.current?.contains(target)) return;
      // A tap on the music only closes the panel: swallow the click that follows so it doesn't also play from the bar under it.
      const swallow = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
    };
    // Capture phase, and preventDefault so the page's Escape (clear the loop) skips this press.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest?.(".tempo-input")) return;
      e.preventDefault();
      setOpen(false);
      moreButton.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  // The More panel on a phone sits just above the bar, whatever height the bar wraps to.
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement.style;
    const measure = () => root.setProperty("--player-h", `${el.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeProperty("--player-h");
    };
  }, []);

  return (
    <section className="controlbar" aria-label="Player" id="player" ref={bar}>
      <div
        className="progress"
        role="slider"
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((p.progress ?? 0) * 100)}
        aria-valuetext={p.progressText || undefined}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.ctrlKey || e.altKey || e.metaKey || e.shiftKey ? undefined : PROGRESS_KEYS[e.key];
          if (!step) return;
          e.preventDefault();
          p.onStep(step);
        }}
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
          aria-keyshortcuts="Space"
          title={withKey(playing ? (p.playAction?.label ?? "Pause") : p.status === "loading" ? "Cancel" : "Play", "play")}
          aria-label={playing ? (p.playAction?.label ?? "Pause") : p.status === "loading" ? "Cancel" : "Play"}
        >
          <span className={`play-icon${playing ? ` ${p.playAction?.icon ?? "pause"}` : ""}`} aria-hidden="true" />
        </button>

        <div className="position">
          <div className="position-main">
            <span className="beats" aria-hidden="true">
              {Array.from({ length: p.beats }, (_, i) => (
                <span key={i} className={`beat${p.beat === i ? " on" : ""}`} />
              ))}
            </span>
            {p.status === "loading" ? (
              <span className="where">Loading sounds…</span>
            ) : (
              <span className="where" ref={main}>
                {p.wherePrefix && <span className="where-prefix">{p.wherePrefix} · </span>}
                <span className="where-place">{p.where || "Ready"}</span>
                {p.whereMore && <span className="where-more"> · {p.whereMore}</span>}
              </span>
            )}
          </div>
          {p.detail && (
            <div className="position-detail scale-detail" ref={detail}>
              <span className="detail-scale">{p.detail.scale}</span>
              <span className="detail-notes">: {p.detail.notes}</span>
              {p.detail.next && <span className="detail-next"> · {p.detail.next}</span>}
            </div>
          )}
          {(p.onFromTop || (!playing && p.tempo !== p.originalTempo)) && (
            <div className="position-detail quiet-links">
              {p.onFromTop && (
                <button type="button" className="from-top" aria-keyshortcuts="Home" title={withKey("From the top", "start")} onClick={p.onFromTop}>
                  From the top
                </button>
              )}
              {!playing && p.tempo !== p.originalTempo && (
                <button type="button" className="from-top" onClick={() => p.onTempo(p.originalTempo)}>
                  Back to {p.originalTempo} BPM
                </button>
              )}
            </div>
          )}
        </div>

        <TempoControl tempo={p.tempo} original={p.originalTempo} onTempo={p.onTempo} />

        {p.onView ? (
          <div className="segmented" role="group" aria-label="View" title={withKey("Switch view", "view")}>
            <button type="button" aria-pressed={p.view === "chords"} aria-keyshortcuts="V" onClick={() => p.onView!("chords")}>
              Chords
            </button>
            <button type="button" aria-pressed={p.view === "sheet"} aria-keyshortcuts="V" aria-label="Lead sheet" onClick={() => p.onView!("sheet")}>
              <span className="long">Lead sheet</span>
              <span className="short">Sheet</span>
            </button>
          </div>
        ) : (
          // A tune without a lead sheet keeps the switch's place, so the controls sit where they do on every tune.
          <div className="segmented placeholder" aria-hidden="true">
            <span>Chords</span>
            <span>
              <span className="long">Lead sheet</span>
              <span className="short">Sheet</span>
            </span>
          </div>
        )}

        <button type="button" className="toggle nav-touch" aria-label="Previous bar" aria-keyshortcuts="ArrowLeft" onClick={p.onPrevBar}>
          <span className="long">Prev bar</span>
          <span className="short">Prev</span>
        </button>
        <button type="button" className="toggle nav-touch" aria-label="Next bar" aria-keyshortcuts="ArrowRight" onClick={p.onNextBar}>
          <span className="long">Next bar</span>
          <span className="short">Next</span>
        </button>

        <button type="button" className="toggle loop-toggle" aria-pressed={!!p.loopLabel} aria-keyshortcuts="L" title={withKey("Loop", "loop")} onClick={p.onLoop}>
          {p.loopLabel ?? "Loop"}
        </button>
        <button type="button" className="toggle" aria-pressed={p.metronome} aria-keyshortcuts="C" title={withKey("Metronome", "click")} onClick={() => p.onMetronome(!p.metronome)}>
          <span className="long">Metronome</span>
          <span className="short">Click</span>
        </button>

        <button type="button" className="toggle" aria-pressed={p.muted} aria-keyshortcuts="M" title={withKey("Mute", "mute")} onClick={() => p.onMuted(!p.muted)}>
          {/* Both labels take the same space, so the button keeps its width when it changes. */}
          <span className="label-stack">
            <span className={p.muted ? undefined : "label-spare"}>Muted</span>
            <span className={p.muted ? "label-spare" : undefined}>Mute</span>
          </span>
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
                    // The panel unmounts, so the dialog would hand focus back to the page; give it More to return to.
                    moreButton.current?.focus();
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
