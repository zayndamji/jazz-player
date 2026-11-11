import type { TimelineBar } from "../engine/timeline";

export type Track = "bass" | "piano" | "guitar" | "drums";
export type DrumSound = "kick" | "rim" | "hat" | "snare" | "tomHigh" | "tomLow" | "crash";

/** One note or drum hit, timed in beats from the start of playback. */
export interface NoteEvent {
  track: Track;
  time: number;
  duration: number;
  velocity: number;
  /** MIDI notes for bass, piano and guitar. */
  notes?: number[];
  /** Which drum for the drums track. */
  drum?: DrumSound;
}

/**
 * A backing style turns the laid-out chart into notes. Styles only read the
 * timeline, so a new style is a new file and the engine stays the same.
 */
export interface Style {
  id: string;
  name: string;
  generate(bars: TimelineBar[], seed: number): NoteEvent[];
}
