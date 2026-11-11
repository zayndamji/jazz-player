/**
 * Transposing instruments. The backing track always plays in concert pitch;
 * the chart is printed for the player's instrument.
 */
export interface Instrument {
  id: string;
  name: string;
  /** Semitones from concert pitch up to the written pitch. */
  offset: number;
}

export const INSTRUMENTS: Instrument[] = [
  { id: "C", name: "Concert (C)", offset: 0 },
  { id: "Bb", name: "B♭ (trumpet, tenor sax, clarinet)", offset: 2 },
  { id: "Eb", name: "E♭ (alto, baritone sax)", offset: 9 },
  { id: "F", name: "F (horn)", offset: 7 },
];
