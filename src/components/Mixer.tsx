import type { Mixable } from "../audio/player";

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

export function Mixer({ mix, onChange }: { mix: Record<Mixable, MixState>; onChange: (track: Mixable, state: MixState) => void }) {
  return (
    <div className="mixer">
      {TRACKS.map(({ id, name }) => (
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
