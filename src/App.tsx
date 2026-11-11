import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type Mixable, type Position } from "./audio/player";
import { displayParts, keyName as plainKeyName, keyPitchClass, parseChord, transposeSymbol } from "./chart/chords";
import { INSTRUMENTS } from "./chart/instruments";
import { chordScale } from "./chart/scales";
import { exampleTune } from "./charts/example-tune";
import { ChordGrid } from "./components/ChordGrid";
import { ControlBar } from "./components/ControlBar";
import { Mixer, type MixState } from "./components/Mixer";
import { buildSchedule, type PlaybackOptions, type Repeat, type Schedule } from "./engine/schedule";
import { chartBars, chordAt, playOrder, sameRef, type BarRef } from "./engine/timeline";
import { STYLES } from "./styles";

const chart = exampleTune;
const style = STYLES[chart.style];
const chartKeyPc = keyPitchClass(chart.key);
const bars = chartBars(chart);
const keyName = (pc: number) => plainKeyName(pc).replace("b", "♭").replace("#", "♯");

/** "A2" for the second A section, "B" when there's only one B. */
function sectionName(index: number): string {
  const label = chart.form[index].label;
  const same = chart.form.filter((s) => s.label === label).length;
  return same > 1 ? label + chart.form.slice(0, index + 1).filter((s) => s.label === label).length : label;
}

/** Fold semitones into -6..+5 so transposed charts stay near the written register. */
const fold = (n: number) => ((((n + 6) % 12) + 12) % 12) - 6;

type Status = "idle" | "loading" | "playing";

const initialMix: Record<Mixable, MixState> = {
  bass: { level: 1, mute: false },
  guitar: { level: 1, mute: false },
  piano: { level: 1, mute: false },
  drums: { level: 1, mute: false },
  metronome: { level: 1, mute: false },
};

const REPEATS: Repeat[] = [1, 2, 3, 4, 5, 6, 8, "loop"];

export default function App() {
  const player = useRef<Player | null>(null);
  const current = useRef<{ opts: PlaybackOptions; schedule: Schedule } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tempo, setTempo] = useState(chart.tempo);
  const [transpose, setTranspose] = useState(0);
  const [instrumentId, setInstrumentId] = useState("C");
  const [repeat, setRepeat] = useState<Repeat>(3);
  const [countIn, setCountIn] = useState(true);
  const [metronome, setMetronome] = useState(false);
  const [showScales, setShowScales] = useState(false);
  const [loopSection, setLoopSection] = useState<number | null>(null);
  /** The last bar the user clicked, so Loop knows which section they mean. */
  const [picked, setPicked] = useState<BarRef | null>(null);
  const [mix, setMix] = useState(initialMix);
  const [position, setPosition] = useState<Position | null>(null);
  const [loops, setLoops] = useState(0);

  const instrument = INSTRUMENTS.find((i) => i.id === instrumentId)!;
  const shift = fold(transpose + instrument.offset);
  const printedKeyPc = (chartKeyPc + shift + 12) % 12;
  const concertKeyPc = (chartKeyPc + transpose + 12) % 12;
  const playing = status === "playing";

  const getPlayer = () => {
    if (!player.current) {
      const p = new Player();
      p.onPosition = setPosition;
      p.onLoop = () => setLoops((n) => n + 1);
      p.onEnd = () => {
        setStatus("idle");
        current.current = null;
      };
      player.current = p;
    }
    return player.current;
  };

  const start = useCallback(
    async (opts: Omit<PlaybackOptions, "choruses" | "transpose">) => {
      const p = getPlayer();
      setError(null);
      setStatus("loading");
      try {
        await p.load();
      } catch (e) {
        console.error(e);
        setError("Couldn't load the instrument sounds. Reload the page to try again.");
        setStatus("idle");
        return;
      }
      (Object.keys(mix) as Mixable[]).forEach((t) => {
        p.setVolume(t, mix[t].level);
        p.setMute(t, mix[t].mute);
      });
      const full: PlaybackOptions = { ...opts, choruses: repeat, transpose };
      const schedule = buildSchedule(chart, style, full);
      current.current = { opts: full, schedule };
      p.metronomeOn = metronome;
      p.setTempo(tempo);
      p.setSchedule(schedule);
      p.play();
      setLoops(0);
      setStatus("playing");
    },
    [mix, repeat, transpose, metronome, tempo],
  );

  const stop = useCallback(() => player.current?.stop(), []);
  const toggle = useCallback(() => {
    if (status === "playing") stop();
    else if (status === "idle") void start({ countIn, loopSection, start: loopSection !== null ? { ref: { part: "form", section: loopSection, bar: 0 }, chorus: 1 } : null });
  }, [status, start, stop, countIn, loopSection]);

  // Changes that apply while playing.
  useEffect(() => player.current?.setTempo(tempo), [tempo]);
  useEffect(() => {
    if (player.current) player.current.metronomeOn = metronome;
  }, [metronome]);
  useEffect(() => {
    const c = current.current;
    if (!playing || !c || c.opts.transpose === transpose) return;
    const opts = { ...c.opts, transpose };
    const schedule = buildSchedule(chart, style, opts);
    current.current = { opts, schedule };
    player.current?.setSchedule(schedule);
  }, [transpose, playing]);

  const schedule = current.current?.schedule ?? null;
  const totalBeats = useMemo(
    () => playOrder(chart, repeat === "loop" ? 1 : repeat).length * chart.beatsPerBar + (countIn ? 2 * chart.beatsPerBar : 0),
    [repeat, countIn],
  );
  const nowBar = position && schedule ? schedule.bars[position.bar] : null;

  const playFrom = (ref: BarRef, loop: number | null) => {
    const chorus = ref.part === "form" ? (playing && nowBar?.chorus ? nowBar.chorus : 1) : 0;
    void start({ countIn: playing ? false : countIn, loopSection: loop, start: { ref, chorus } });
  };

  const onBar = (ref: BarRef) => {
    setPicked(ref);
    const keepLoop = loopSection !== null && ref.part === "form" && ref.section === loopSection;
    if (!keepLoop && loopSection !== null) setLoopSection(null);
    playFrom(ref, keepLoop ? loopSection : null);
  };

  /** Loop the section that's playing, or the one last clicked; again to stop looping. */
  const toggleLoop = (section?: number) => {
    const here = nowBar?.ref ?? picked;
    const target = section ?? (here?.part === "form" ? here.section : 0);
    const next = loopSection === target ? null : target;
    setLoopSection(next);
    if (!playing) return;
    const inSection = here?.part === "form" && here.section === target;
    playFrom(next !== null && !inSection ? { part: "form", section: target, bar: 0 } : (here ?? { part: "form", section: target, bar: 0 }), next);
  };

  const onSeek = (fraction: number) => {
    // Seek within one pass of the chart: intro, form, ending.
    const b = bars[Math.min(bars.length - 1, Math.max(0, Math.floor(fraction * bars.length)))];
    onBar(b.ref);
  };

  const changeMix = (track: Mixable, state: MixState) => {
    setMix((m) => ({ ...m, [track]: state }));
    player.current?.setVolume(track, state.level);
    player.current?.setMute(track, state.mute);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement).closest("input, select, textarea, button")) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Where we are, in words.
  const nowNumber = nowBar?.ref ? bars.find((b) => sameRef(b.ref, nowBar.ref)) : undefined;
  let where = "";
  if (nowBar?.countIn) where = "Count-in";
  else if (nowBar?.ref && nowNumber) {
    const part =
      nowBar.ref.part === "intro"
        ? "Intro"
        : nowBar.ref.part === "ending"
          ? chart.ending![nowBar.ref.section].label
          : current.current?.opts.loopSection != null
            ? `${chart.form[nowBar.ref.section].label} section`
            : repeat === "loop"
              ? `Chorus ${nowBar.chorus + loops}`
              : `Chorus ${nowBar.chorus} of ${repeat}`;
    where = `Bar ${nowNumber.number} · ${part}`;
  }
  if (!where && status === "idle") {
    const seconds = Math.round((totalBeats * 60) / tempo);
    where = repeat === "loop" ? "Repeats until stopped" : `${repeat} ${repeat === 1 ? "chorus" : "choruses"} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const progress = nowNumber ? (bars.indexOf(nowNumber) + (position?.beat ?? 0) / chart.beatsPerBar) / bars.length : null;

  const nowChord = useMemo(() => {
    if (!nowBar || !position || nowBar.countIn) return null;
    const slot = chordAt(nowBar, position.beat);
    if (!slot) return null;
    const symbol = transposeSymbol(slot.chord.symbol, fold(instrument.offset), printedKeyPc);
    const scale = chordScale(parseChord(symbol), symbol.match(/^[A-G][#b]?/)![0], printedKeyPc);
    return `${displayParts(symbol).root} ${scale.name.toLowerCase()}: ${scale.notes.join(" ")}`;
  }, [nowBar, position, instrument.offset, printedKeyPc]);

  const loopLabel = loopSection !== null ? sectionName(loopSection) : null;

  const settings = (
    <div className="settings">
      <label className="field">
        <span>Key</span>
        <select value={transpose} onChange={(e) => setTranspose(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, pc) => (
            <option key={pc} value={fold(pc - chartKeyPc)}>
              {keyName(pc)}
              {pc === chartKeyPc ? " (original)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Instrument</span>
        <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
          {INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Choruses</span>
        <select value={String(repeat)} disabled={playing} onChange={(e) => setRepeat(e.target.value === "loop" ? "loop" : Number(e.target.value))}>
          {REPEATS.map((r) => (
            <option key={String(r)} value={String(r)}>
              {r === "loop" ? "Until stopped" : r}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} />
        Two-bar count-in
      </label>
      <label className="check">
        <input type="checkbox" checked={showScales} onChange={(e) => setShowScales(e.target.checked)} />
        Show scales on the chart
      </label>
      <h3>Mix</h3>
      <Mixer mix={mix} onChange={changeMix} />
    </div>
  );

  return (
    <div className="app">
      <header className="head">
        <h1>{chart.title}</h1>
        <p className="meta">
          <span>{style.name}</span>
          <span>{keyName(concertKeyPc)} major</span>
          <span>{chart.beatsPerBar}/4</span>
          {instrument.offset !== 0 && (
            <span className="part">
              {instrument.name.split(" ")[0]} part, written in {keyName(printedKeyPc)}
            </span>
          )}
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <main className="view">
        <ChordGrid
            chart={chart}
            shift={shift}
            keyPc={printedKeyPc}
            active={nowBar?.ref ?? null}
            showScales={showScales}
            loopSection={loopSection}
            onBar={onBar}
            onSection={(s) => toggleLoop(s)}
          />
      </main>

      <ControlBar
        status={status}
        onPlay={toggle}
        tempo={tempo}
        onTempo={setTempo}
        where={where}
        detail={nowChord}
        progress={progress}
        onSeek={onSeek}
        beat={position?.beat ?? null}
        beats={chart.beatsPerBar}
        view="chords"
        onView={null}
        loopLabel={loopLabel}
        onLoop={() => toggleLoop()}
        metronome={metronome}
        onMetronome={setMetronome}
        settings={settings}
      />
    </div>
  );
}
