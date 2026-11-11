import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type Mixable, type Position } from "./audio/player";
import { keyName, keyPitchClass } from "./chart/chords";
import { exampleTune } from "./charts/example-tune";
import { ChordGrid } from "./components/ChordGrid";
import { Mixer, Stepper, Toggle, type MixState } from "./components/Controls";
import { Credits } from "./components/Credits";
import { buildSchedule } from "./engine/schedule";
import { STYLES } from "./styles";

const chart = exampleTune;
const style = STYLES[chart.style];

type Status = "idle" | "loading" | "playing";

const initialMix: Record<Mixable, MixState> = {
  bass: { level: 1, mute: false },
  piano: { level: 1, mute: false },
  drums: { level: 1, mute: false },
  metronome: { level: 1, mute: false },
};

export default function App() {
  const player = useRef<Player | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tempo, setTempo] = useState(chart.tempo);
  const [transpose, setTranspose] = useState(0);
  const [choruses, setChoruses] = useState(3);
  const [countIn, setCountIn] = useState(true);
  const [metronome, setMetronome] = useState(false);
  const [mix, setMix] = useState(initialMix);
  const [position, setPosition] = useState<Position | null>(null);

  const keyPc = (keyPitchClass(chart.key) + transpose + 120) % 12;
  const schedule = useMemo(() => buildSchedule(chart, style, { choruses, countIn, transpose }), [choruses, countIn, transpose]);

  const getPlayer = () => {
    if (!player.current) {
      const p = new Player();
      p.onPosition = setPosition;
      p.onEnd = () => setStatus("idle");
      player.current = p;
    }
    return player.current;
  };

  const start = useCallback(async () => {
    const p = getPlayer();
    setError(null);
    setStatus("loading");
    try {
      await p.load();
    } catch (e) {
      setError("Couldn't load the instrument sounds. Check your connection and try again.");
      setStatus("idle");
      console.error(e);
      return;
    }
    (Object.keys(mix) as Mixable[]).forEach((t) => {
      p.setVolume(t, mix[t].level);
      p.setMute(t, mix[t].mute);
    });
    p.metronomeOn = metronome;
    p.setTempo(tempo);
    p.setSchedule(schedule);
    p.play();
    setStatus("playing");
  }, [mix, metronome, tempo, schedule]);

  const stop = useCallback(() => player.current?.stop(), []);
  const toggle = useCallback(() => (status === "playing" ? stop() : status === "idle" ? void start() : undefined), [status, start, stop]);

  // Live changes while playing.
  useEffect(() => player.current?.setTempo(tempo), [tempo]);
  useEffect(() => {
    if (player.current) player.current.metronomeOn = metronome;
  }, [metronome]);
  useEffect(() => {
    if (status === "playing") player.current?.setSchedule(schedule);
    // Only the transpose can change while playing; the other inputs are locked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  const changeMix = (track: Mixable, state: MixState) => {
    setMix((m) => ({ ...m, [track]: state }));
    player.current?.setVolume(track, state.level);
    player.current?.setMute(track, state.mute);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement).closest("input, button, select")) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const bar = position ? schedule.bars[position.bar] : null;
  const playing = status === "playing";
  const transposeLabel = transpose === 0 ? "" : ` (${transpose > 0 ? "+" : "−"}${Math.abs(transpose)})`;

  let where = "Stopped";
  if (status === "loading") where = "Loading sounds…";
  else if (bar?.countIn) where = "Count-in";
  else if (bar?.ref?.part === "intro") where = "Intro";
  else if (bar?.ref?.part === "ending") where = "Ending";
  else if (bar) where = `Chorus ${bar.chorus} of ${choruses}`;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Jazz Teacher</div>
        <div className="song">
          <h1>{chart.title}</h1>
          <p>
            {chart.composers.join(" · ")}
            {chart.year ? `, ${chart.year}` : ""}
          </p>
        </div>
        <div className="meta">
          <span className="pill">{style.name}</span>
          <span className="pill">Key of {keyName(keyPc)}</span>
          <span className="pill">{chart.beatsPerBar}/4</span>
        </div>
      </header>

      <section className="transport" aria-label="Playback">
        <button type="button" className={`play${playing ? " stop" : ""}`} onClick={toggle} disabled={status === "loading"}>
          {playing ? "■ Stop" : status === "loading" ? "Loading…" : "▶ Play"}
        </button>

        <div className="control tempo">
          <label className="control-label" htmlFor="tempo">
            Tempo <strong>{tempo}</strong> BPM
          </label>
          <input id="tempo" type="range" min={60} max={240} step={1} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
        </div>

        <div className="toggles">
          <Toggle label="Metronome" on={metronome} onChange={setMetronome} />
          <Toggle label="Count-in" on={countIn} onChange={(v) => !playing && setCountIn(v)} />
        </div>

        <Stepper label="Choruses" value={choruses} min={1} max={10} disabled={playing} onChange={setChoruses} />
        <Stepper
          label="Transpose"
          value={transpose}
          min={-6}
          max={6}
          display={`${keyName(keyPc)}${transposeLabel}`}
          onChange={setTranspose}
        />

        <div className="status" aria-live="polite">
          <div className="beats" aria-hidden="true">
            {Array.from({ length: chart.beatsPerBar }, (_, i) => (
              <span key={i} className={`beat${position && position.beat === i ? " on" : ""}${i === 0 ? " one" : ""}`} />
            ))}
          </div>
          <span className="where">{where}</span>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      <main className="paper">
        <ChordGrid chart={chart} transpose={transpose} keyPc={keyPc} active={bar?.ref ?? null} />
      </main>

      <section className="mix-panel" aria-label="Mixer">
        <h2>Mixer</h2>
        <Mixer mix={mix} onChange={changeMix} />
      </section>

      <Credits />
    </div>
  );
}
