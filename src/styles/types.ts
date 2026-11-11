import type { TimelineBar } from "../engine/timeline";

export type Track = "bass" | "piano" | "guitar" | "drums";
/** "brush" is a sweep across the snare, "brushTap" a brush stroke on it; both are synthesized. */
export type DrumSound = "kick" | "rim" | "hat" | "pedal" | "ride" | "snare" | "tomHigh" | "tomLow" | "crash" | "brush" | "brushTap";

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
  /** Level changes in dB for this style's band, on top of the player's defaults. */
  mix?: Partial<Record<Track, number>>;
}
