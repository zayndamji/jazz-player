import type { Mixable } from "../audio/player";

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  display?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}

export function Stepper({ label, value, min, max, display, disabled, onChange }: StepperProps) {
  return (
    <div className="control stepper">
      <span className="control-label">{label}</span>
      <div className="stepper-body">
        <button type="button" aria-label={`${label} down`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="stepper-value">{display ?? value}</span>
        <button type="button" aria-label={`${label} up`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`toggle${on ? " on" : ""}`} aria-pressed={on} onClick={() => onChange(!on)}>
      <span className="toggle-dot" />
      {label}
    </button>
  );
}

export interface MixState {
  level: number;
  mute: boolean;
}

const TRACKS: { id: Mixable; name: string }[] = [
  { id: "bass", name: "Bass" },
  { id: "piano", name: "Piano" },
  { id: "drums", name: "Drums" },
  { id: "metronome", name: "Click" },
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
          <button type="button" className="mute" aria-pressed={mix[id].mute} onClick={() => onChange(id, { ...mix[id], mute: !mix[id].mute })}>
            {mix[id].mute ? "Muted" : "Mute"}
          </button>
        </div>
      ))}
    </div>
  );
}
