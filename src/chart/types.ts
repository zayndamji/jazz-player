/**
 * A chord chart as the app stores it. Charts are plain data so any tune can be
 * added by writing one of these (or, later, by importing MusicXML or iReal Pro).
 */
export interface Chart {
  id: string;
  title: string;
  /**
   * Original concert key, as the composer published it, never a transposed
   * part's key: "C", "Bb", or "Em" for minor. Charts are always stored in it.
   */
  key: string;
  /** Default tempo in quarter notes per minute. */
  tempo: number;
  /** Beats per bar. Only 4 is supported by the styles so far. */
  beatsPerBar: number;
  /** Id of the default backing style, e.g. "bossa". */
  style: string;
  /** Played once before the first chorus. */
  intro?: Section;
  /** The repeating form, in playing order. */
  form: Section[];
  /** Played after the last chorus, in order (a tag, then the final bar). */
  ending?: Section[];
}

export interface Section {
  /** Short label shown on the chart, e.g. "A", "B", "Intro". */
  label: string;
  /**
   * One string per bar. Chords are separated by spaces and split the bar
   * evenly ("Em7/A A7" is two beats each). "/" holds the chord before it for
   * one slot ("Am7 / / Fmaj7" changes on beat 4). "%" alone repeats the
   * previous chord without a new attack.
   */
  bars: string[];
  /** Times the section is played in a row (a tag played twice). Default 1. */
  repeat?: number;
  /** Printed bar on the lead sheet where this section's first bar is, when it repeats earlier bars (a tag). */
  sheetBar?: number;
}

/** One chord placed in a bar. */
export interface ChordSlot {
  symbol: string;
  /** Beat in the bar where the chord starts, from 0. */
  beat: number;
}

/** A bar after parsing: its chords and whether it only repeats the last one. */
export interface ParsedBar {
  chords: ChordSlot[];
  repeat: boolean;
}
