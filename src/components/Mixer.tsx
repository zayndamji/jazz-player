import type { Mixable } from "../audio/player";
import { currentPreset, effectiveMute, presetsFor } from "../pages/mix";
import type { Track } from "../styles/types";

export interface MixState {
  level: number;
  mute: boolean;
  /** When any part is soloed, only soloed parts sound (the metronome is never affected). */
  solo: boolean;
}

const TRACKS: { id: Mixable; name: string }[] = [
  { id: "bass", name: "Bass" },
  { id: "guitar", name: "Guitar" },
  { id: "piano", name: "Piano" },
  { id: "drums", name: "Drums" },
  { id: "melody", name: "Melody" },
  { id: "metronome", name: "Metronome" },
];

interface Props {
  /** The master volume, 0 to 1, for every tune. */
  volume: number;
  onVolume: (volume: number) => void;
  mix: Record<Mixable, MixState>;
  onChange: (track: Mixable, state: MixState) => void;
  /** Apply a ready-made mix of the band (an id from `presetsFor`). */
  onPreset: (id: string) => void;
  band: Track[];
}

/** The master volume, a band preset, then volume, mute and solo for each part that plays (the band) and the metronome. */
export function Mixer({ volume, onVolume, mix, onChange, onPreset, band }: Props) {
  const preset = currentPreset(mix, band);
  return (
    <div className="mixer">
      <div className="strip master">
        <label htmlFor="vol-master">Volume</label>
        <input id="vol-master" type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => onVolume(Number(e.target.value))} />
      </div>
      <label className="field">
        <span>Mix</span>
        <select value={preset?.id ?? "custom"} onChange={(e) => onPreset(e.target.value)}>
          {presetsFor(band).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {!preset && (
            <option value="custom" disabled>
              Custom
            </option>
          )}
        </select>
      </label>
      {TRACKS.filter(({ id }) => id === "metronome" || band.includes(id)).map(({ id, name }) => (
        <div className={`strip${effectiveMute(mix, id) ? " muted" : ""}`} key={id}>
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
            Mute
          </button>
          {id === "metronome" ? (
            <span />
          ) : (
            <button type="button" className="mute" aria-pressed={mix[id].solo} aria-label={`Solo ${name}`} onClick={() => onChange(id, { ...mix[id], solo: !mix[id].solo })}>
              Solo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
