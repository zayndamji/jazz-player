import type { TimelineBar } from "../engine/timeline";

export type Track = "bass" | "piano" | "guitar" | "drums" | "melody";
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
  /** Seconds added to `time` for each note of `notes` (a rolled or spread chord). */
  offsets?: number[];
  /** Velocity factor for each note of `notes` (voicing: the top note louder). */
  levels?: number[];
  /** Which drum for the drums track. */
  drum?: DrumSound;
}

/** How the band should play beyond the chords, set per playback. */
export interface Feel {
  /** Tempo in BPM the notes are generated for: styles straighten the swing and thin out the comping as it gets faster. */
  tempo: number;
  /** Play the intro and first chorus in two (half-note bass, lighter drums), then walk. Styles without a two-feel ignore it. */
  twoFeel: boolean;
  /** The chart's comping colour (swing reads it; other styles ignore it). */
  comp?: "sparse" | "busy" | "blues";
}

/**
 * A backing style turns the laid-out chart into notes. Styles only read the
 * timeline, so a new style is a new file and the engine stays the same.
 */
export interface Style {
  id: string;
  name: string;
  generate(bars: TimelineBar[], seed: number, feel: Feel): NoteEvent[];
  /** The parts this style plays unless a chart names its own `band`. */
  band: Track[];
  /** Beats per bar the style can play; 4 only when left out. */
  meters?: number[];
  /** True when the style honours `Feel.twoFeel`, so the page offers it. */
  twoFeel?: boolean;
  /** Level changes in dB for this style's band, on top of the player's defaults. */
  mix?: Partial<Record<Track, number>>;
}
