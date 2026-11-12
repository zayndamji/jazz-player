import type { Mixable } from "../audio/player";
import type { MixState } from "../components/Mixer";
import type { Track } from "../styles/types";

type Mix = Record<Mixable, MixState>;

const isBand = (t: Mixable): t is Track => t !== "metronome";

/** Whether any part is soloed (the metronome can't be). */
export const anySolo = (mix: Mix) => (Object.keys(mix) as Mixable[]).some((t) => isBand(t) && mix[t].solo);

/** Whether a track is silent: muted itself, or another part is soloed. The metronome ignores solo. */
export const effectiveMute = (mix: Mix, track: Mixable) => mix[track].mute || (isBand(track) && anySolo(mix) && !mix[track].solo);

export interface BandPreset {
  id: string;
  name: string;
  /** The parts it silences. */
  mutes: Track[];
}

/** Ready-made mixes of the band, set by muting parts. */
export const PRESETS: BandPreset[] = [
  { id: "full", name: "Full band", mutes: [] },
  { id: "no-piano", name: "No piano", mutes: ["piano"] },
  { id: "no-bass", name: "No bass", mutes: ["bass"] },
  { id: "no-drums", name: "No drums", mutes: ["drums"] },
  { id: "bass-drums", name: "Bass and drums", mutes: ["piano", "guitar"] },
  { id: "drums", name: "Drums only", mutes: ["piano", "guitar", "bass"] },
];

/** What a preset silences in a band, leaving out parts that don't play. */
const mutesIn = (preset: BandPreset, band: Track[]) => preset.mutes.filter((t) => band.includes(t)).sort();

/** The presets worth offering for a band: the full band, and each one that silences something different among the parts that play. */
export function presetsFor(band: Track[]): BandPreset[] {
  const seen = new Set<string>([""]);
  return PRESETS.filter((p) => {
    const key = mutesIn(p, band).join();
    if (seen.has(key) && p.id !== "full") return false;
    seen.add(key);
    return true;
  });
}

/** The preset the mixer matches right now, or null (shown as "Custom"). Any solo makes it custom. */
export function currentPreset(mix: Mix, band: Track[]): BandPreset | null {
  if (anySolo(mix)) return null;
  const muted = band.filter((t) => mix[t].mute).sort().join();
  return presetsFor(band).find((p) => mutesIn(p, band).join() === muted) ?? null;
}

/** The mixer with a preset applied: the band's mutes set, solos cleared; levels and the metronome stay. */
export function applyPreset(mix: Mix, preset: BandPreset, band: Track[]): Mix {
  const next = { ...mix };
  for (const t of band) next[t] = { ...mix[t], mute: preset.mutes.includes(t), solo: false };
  return next;
}
