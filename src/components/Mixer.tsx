import type { Mixable } from "../audio/player";
import type { Track } from "../styles/types";

export interface MixState {
  level: number;
  mute: boolean;
}

const TRACKS: { id: Mixable; name: string }[] = [
  { id: "bass", name: "Bass" },
  { id: "guitar", name: "Guitar" },
  { id: "piano", name: "Piano" },
  { id: "drums", name: "Drums" },
  { id: "metronome", name: "Metronome" },
];

/** Volume and mute for each part that plays (the band) and the metronome. */
export function Mixer({ mix, onChange, band }: { mix: Record<Mixable, MixState>; onChange: (track: Mixable, state: MixState) => void; band: Track[] }) {
  return (
    <div className="mixer">
      {TRACKS.filter(({ id }) => id === "metronome" || band.includes(id)).map(({ id, name }) => (
        <div className={`strip${mix[id].mute ? " muted" : ""}`} key={id}>
          <label htmlFor={`vol-${id}`}>{name}</label>
          <input
            id={`vol-${id}`}
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={mix[id].level}
            onChange={(e) => onChange(id, { ...mix[id], level: Number(e.target.value) })}
          />
          <button type="button" className="mute" aria-pressed={mix[id].mute} aria-label={`Mute ${name}`} onClick={() => onChange(id, { ...mix[id], mute: !mix[id].mute })}>
            M
          </button>
        </div>
      ))}
    </div>
  );
}
