/**
 * A chord chart as the app stores it. Charts are plain data so any tune can be
 * added by writing one of these (or, later, by importing MusicXML or iReal Pro).
 */
/** Tempos a chart and the player accept, in BPM. */
export const TEMPO = { min: 40, max: 320 };

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
  /** Beats per bar: 4 or 3. A style plays the meters in its `meters` (4 only, unless it says otherwise). */
  beatsPerBar: number;
  /** Id of the default backing style, e.g. "bossa". */
  style: string;
  /**
   * The parts that play, when not the style's own band: add "guitar" to a swing tune for
   * four-to-the-bar rhythm guitar, or leave out "piano" for a pianoless trio.
   */
  band?: ("bass" | "guitar" | "piano" | "drums")[];
  /** The heads in two: the intro, first chorus and out-head with half-note bass, the solos walking (swing). Default false. */
  twoFeel?: boolean;
  /**
   * How the piano comps, when the tune's records differ from the style's middle ground. Swing:
   * "sparse" (few, longer chords, and in the solos the piano strolls for whole phrases), "busy" (on most beats), "blues"
   * (laid back, riffs repeated, crushed notes into the third). Bossa: "sparse" lays the piano out for most of the
   * head and keeps the cross-stick for the solos, as on the vocal records.
   */
  comp?: "sparse" | "busy" | "blues";
  /**
   * Level changes in dB per part on top of the style's mix, when the tune's record balances
   * the band differently (Nardis: Motian's brushes well under the bass). Applied only in the chart's own style.
   */
  mix?: Partial<Record<"bass" | "guitar" | "piano" | "drums", number>>;
  /** A note the bass holds under every chord, as a drone ("E": Coltrane's My Favorite Things). The waltz reads it. */
  pedal?: string;
  /** Trading with the drums the page starts with, when the tune's record trades (Tenor Madness trades fours). Default off. */
  trade?: "fours" | "eights" | "fours-out";
  /**
   * The style the solo choruses play in, when the tune plays in its own style: the head keeps its sections' styles
   * (Latin A's, a swing bridge) and every solo chorus plays in this one (A Night in Tunisia's solos, swung). A looped
   * section or run of bars keeps the sections' own styles.
   */
  soloStyle?: string;
  /**
   * The form sections a solo chorus plays, by index into `form`, in order, when it isn't the form order: Autumn
   * Serenade's solos on C A B, the vamp first. The head choruses keep the form order.
   */
  soloOrder?: number[];
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
  /** Printed bar on the lead sheet where this section's first bar is, when it repeats earlier bars (a tag, solo changes). */
  sheetBar?: number;
  /**
   * Form sections only: "head" plays in head choruses (the first and the last), "solos" in
   * the choruses between, for tunes whose solo changes differ from the head; "first" only in the
   * first chorus, for a passage that leads into the solos (A Night in Tunisia's interlude and break).
   * Default: every chorus.
   */
  play?: "head" | "solos" | "first";
  /**
   * The backing style this section plays in, when it differs from the chart's `style`: Latin A sections
   * with a swing bridge ("latin" on the A's, the chart's style "swing"). Used when the tune plays in its own
   * style; any other style chosen on the page plays the whole tune.
   */
  style?: string;
  /**
   * A break: the band stops for the whole section (the 4-bar solo break of A Night in Tunisia) while the
   * chords print and the metronome and melody go on. Notes ringing into it stop where it starts. Default false.
   */
  break?: boolean;
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
