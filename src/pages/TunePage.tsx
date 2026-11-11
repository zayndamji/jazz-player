import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type Mixable, type Position } from "../audio/player";
import { displayParts, isMinorKey, keyPitchClass, parseChord, spellingPc, transposeSymbol } from "../chart/chords";
import { INSTRUMENTS } from "../chart/instruments";
import { chordScale } from "../chart/scales";
import type { Chart } from "../chart/types";
import { hasHead } from "../charts/heads";
import { ChordGrid } from "../components/ChordGrid";
import { ControlBar, type View } from "../components/ControlBar";
import { LeadSheet } from "../components/LeadSheet";
import { Mixer, type MixState } from "../components/Mixer";
import { buildSchedule, type PlaybackOptions, type Repeat, type Schedule } from "../engine/schedule";
import { chartBars, chordAt, playOrder, sameRef, type BarRef } from "../engine/timeline";
import { STYLES } from "../styles";
import { keyLabel, keyWords } from "./format";

const MUTE_KEY = "jazz-player.muted";
const INSTRUMENT_KEY = "jazz-player.instrument";
/** A stored setting, falling back to its name from when the site was called Jazz Teacher. */
const readStored = (key: string) => {
  try {
    return localStorage.getItem(key) ?? localStorage.getItem(key.replace("jazz-player.", "jazz-teacher."));
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private windows); the setting still works for this visit.
  }
};
const readMuted = () => readStored(MUTE_KEY) === "1";
/** The player's instrument, kept between tunes and visits. */
const readInstrument = () => {
  const id = readStored(INSTRUMENT_KEY);
  return INSTRUMENTS.some((i) => i.id === id) ? id! : "C";
};

/** "up 2" or "down 3": how far a key is from the original, in half steps. */
const steps = (n: number) => (n > 0 ? `up ${n}` : `down ${-n}`);

/** One player for the whole site, so samples load once even when switching tunes. */
let sharedPlayer: Player | null = null;

/** "A2" for the second A section, "B" when there's only one B. */
function sectionName(chart: Chart, index: number): string {
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

export function TunePage({ chart }: { chart: Chart }) {
  const style = STYLES[chart.style];
  const chartKeyPc = keyPitchClass(chart.key);
  const minor = isMinorKey(chart.key);
  const bars = useMemo(() => chartBars(chart), [chart]);
  const headAvailable = hasHead(chart.id);
  const player = useRef<Player | null>(sharedPlayer);
  const current = useRef<{ opts: PlaybackOptions; schedule: Schedule } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tempo, setTempo] = useState(chart.tempo);
  const [transpose, setTranspose] = useState(0);
  const [instrumentId, setInstrumentId] = useState(readInstrument);
  const [repeat, setRepeat] = useState<Repeat>(3);
  const [countIn, setCountIn] = useState(true);
  const [metronome, setMetronome] = useState(false);
  const [showScales, setShowScales] = useState(false);
  const [view, setView] = useState<View>("chords");
  const [loopSection, setLoopSection] = useState<number | null>(null);
  /** The last bar the user clicked, so Loop knows which section they mean. */
  const [picked, setPicked] = useState<BarRef | null>(null);
  const [mix, setMix] = useState(initialMix);
  const [position, setPosition] = useState<Position | null>(null);
  const [loops, setLoops] = useState(0);
  const [muted, setMuted] = useState(() => readMuted());

  useEffect(() => {
    sharedPlayer?.setMasterMute(muted);
    store(MUTE_KEY, muted ? "1" : "0");
  }, [muted]);
  useEffect(() => store(INSTRUMENT_KEY, instrumentId), [instrumentId]);

  const instrument = INSTRUMENTS.find((i) => i.id === instrumentId)!;
  const shift = fold(transpose + instrument.offset);
  const printedKeyPc = (chartKeyPc + shift + 12) % 12;
  /** The major key the printed chords are spelled in (the relative major for a minor tune). */
  const printedSpellPc = spellingPc(printedKeyPc, minor);
  const concertKeyPc = (chartKeyPc + transpose + 12) % 12;
  const playing = status === "playing";

  const getPlayer = () => {
    if (!sharedPlayer) sharedPlayer = new Player();
    const p = sharedPlayer;
    p.onPosition = setPosition;
    p.onLoop = () => setLoops((n) => n + 1);
    p.onEnd = () => {
      setStatus("idle");
      current.current = null;
    };
    player.current = p;
    return p;
  };

  // Leaving the tune stops the band.
  useEffect(() => () => {
    if (sharedPlayer?.playing) sharedPlayer.stop();
  }, []);

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
      p.setMasterMute(muted);
      p.setTempo(tempo);
      p.setSchedule(schedule);
      p.play();
      setLoops(0);
      setStatus("playing");
    },
    [chart, style, mix, repeat, transpose, metronome, tempo, muted],
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
  }, [chart, style, transpose, playing]);

  const schedule = current.current?.schedule ?? null;
  const totalBeats = useMemo(
    () => playOrder(chart, repeat === "loop" ? 1 : repeat).length * chart.beatsPerBar + (countIn ? 2 * chart.beatsPerBar : 0),
    [chart, repeat, countIn],
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
    const symbol = transposeSymbol(slot.chord.symbol, fold(instrument.offset), printedSpellPc);
    const scale = chordScale(parseChord(symbol), symbol.match(/^[A-G][#b]?/)![0], printedSpellPc);
    return `${displayParts(symbol).root} ${scale.name.toLowerCase()}: ${scale.notes.join(" ")}`;
  }, [nowBar, position, instrument.offset, printedSpellPc]);

  const sheetBar = nowNumber?.sheetNumber ?? null;
  const onSheetBar = (n: number) => {
    const b = bars.find((x) => x.ref.part !== "ending" && x.sheetNumber === n);
    if (b) onBar(b.ref);
  };

  const loopLabel = loopSection !== null ? sectionName(chart, loopSection) : null;

  const settings = (
    <div className="settings">
      <label className="field">
        <span>Band plays in</span>
        <select value={transpose} onChange={(e) => setTranspose(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => {
            const n = i - 6;
            const pc = (chartKeyPc + n + 12) % 12;
            return (
              <option key={n} value={n}>
                {keyLabel(pc, minor)} {n === 0 ? "(original)" : `(${steps(n)})`}
              </option>
            );
          })}
        </select>
      </label>
      <label className="field">
        <span>Written for</span>
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
        <a className="back" href="#/">
          All tunes
        </a>
        <h1>{chart.title}</h1>
        <p className="meta">
          <span>{style.name}</span>
          <span>
            {keyWords(concertKeyPc, minor)}
            {transpose !== 0 && `, ${steps(transpose)} from ${keyLabel(chartKeyPc, minor)}`}
          </span>
          <span>{chart.beatsPerBar}/4</span>
          {instrument.offset !== 0 && (
            <span className="part">
              {instrument.name.split(" ")[0]} part, written in {keyLabel(printedKeyPc, minor)}
            </span>
          )}
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <main className={`view view-${view}`}>
        {view === "sheet" && headAvailable ? (
          <LeadSheet
            chartId={chart.id}
            shift={shift}
            bar={sheetBar}
            loopBars={loopSection === null ? [] : bars.filter((b) => b.ref.part === "form" && b.ref.section === loopSection).map((b) => b.sheetNumber)}
            onBar={onSheetBar}
          />
        ) : (
          <ChordGrid
            chart={chart}
            shift={shift}
            keyPc={printedSpellPc}
            active={nowBar?.ref ?? null}
            showScales={showScales}
            loopSection={loopSection}
            onBar={onBar}
            onSection={(s) => toggleLoop(s)}
          />
        )}
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
        view={view}
        onView={headAvailable ? setView : null}
        loopLabel={loopLabel}
        onLoop={() => toggleLoop()}
        metronome={metronome}
        onMetronome={setMetronome}
        muted={muted}
        onMuted={setMuted}
        settings={settings}
      />
    </div>
  );
}
