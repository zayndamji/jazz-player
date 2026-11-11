import { keyName as plainKeyName } from "../chart/chords";

/** Key name with music sharps and flats, e.g. "B♭". */
export const keyName = (pc: number) => plainKeyName(pc).replace("b", "♭").replace("#", "♯");
