import { keyName as plainKeyName, minorKeyName } from "../chart/chords";

const pretty = (name: string) => name.replace("b", "♭").replace("#", "♯");

/** Key name with music sharps and flats, e.g. "B♭". */
export const keyName = (pc: number) => pretty(plainKeyName(pc));

/** A key as a short name: "E♭" for major, "C♯m" for minor. */
export const keyLabel = (pc: number, minor: boolean) => (minor ? pretty(minorKeyName(pc)) + "m" : keyName(pc));

/** A key in words: "E♭ major", "E minor". */
export const keyWords = (pc: number, minor: boolean) => (minor ? `${pretty(minorKeyName(pc))} minor` : `${keyName(pc)} major`);
