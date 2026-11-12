import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type Mixable, type Position } from "../audio/player";
import { displayParts, isMinorKey, keyPitchClass, parseChord, spellingPc, transposeSymbol } from "../chart/chords";
import { INSTRUMENTS } from "../chart/instruments";
import { chordScale } from "../chart/scales";
import { TEMPO, type Chart } from "../chart/types";
import { hasHead } from "../charts/heads";
import { ChordGrid } from "../components/ChordGrid";
import { ControlBar, type View } from "../components/ControlBar";
import { LeadSheet } from "../components/LeadSheet";
import { Mixer, type MixState } from "../components/Mixer";
import { ShortcutHelp } from "../components/ShortcutHelp";
import { bandFor, buildSchedule, type PlaybackOptions, type Repeat, type Schedule } from "../engine/schedule";
import { chartBars, chordAt, navOrder, playOrder, sameRef, stepBar, stepSection, type BarRef, type PlayItem } from "../engine/timeline";
import { STYLES } from "../styles";
import type { Style } from "../styles/types";
import { keyLabel, keyWords } from "./format";
import { clearSettings, defaultSettings, loadSettings, REPEATS, saveSettings } from "./settings";
import { leaveAlone, shortcutFor, type ShortcutId } from "./shortcuts";
import { readStored, store } from "./storage";

const MUTE_KEY = "jazz-player.muted";
const INSTRUMENT_KEY = "jazz-player.instrument";
const SHORTCUTS_KEY = "jazz-player.shortcuts";
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

export function TunePage({ chart }: { chart: Chart }) {
  /** The band's style: the chart's own by default, any other on request. */
  const initial = useMemo(() => loadSettings(chart), [chart]);
  const [styleId, setStyleId] = useState(initial.style);
  const style = STYLES[styleId] ?? STYLES[chart.style];
  const chartKeyPc = keyPitchClass(chart.key);
  const minor = isMinorKey(chart.key);
  const bars = useMemo(() => chartBars(chart), [chart]);
  const headAvailable = hasHead(chart.id);
  const player = useRef<Player | null>(sharedPlayer);
  const current = useRef<{ opts: PlaybackOptions; schedule: Schedule; style: Style } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tempo, setTempo] = useState(initial.tempo);
  const [twoFeel, setTwoFeel] = useState(initial.twoFeel);
  const [transpose, setTranspose] = useState(initial.transpose);
  const [instrumentId, setInstrumentId] = useState(readInstrument);
  const [repeat, setRepeat] = useState<Repeat>(initial.choruses);
  const [countIn, setCountIn] = useState(initial.countIn);
  const [metronome, setMetronome] = useState(false);
  const [showScales, setShowScales] = useState(initial.showScales);
  const [view, setView] = useState<View>(initial.view);
  const [loopSection, setLoopSection] = useState<number | null>(null);
  /** The last bar the user clicked, so Loop knows which section they mean. */
  const [picked, setPicked] = useState<BarRef | null>(null);
  const [mix, setMix] = useState(initial.mix);
  const [position, setPosition] = useState<Position | null>(null);
  const [loops, setLoops] = useState(0);
  const [muted, setMuted] = useState(() => readMuted());
  /** Letter, digit and punctuation shortcuts; off for people who type by voice or switch (WCAG 2.1.4). */
  const [singleKeys, setSingleKeys] = useState(() => readStored(SHORTCUTS_KEY) !== "0");
  const [helpOpen, setHelpOpen] = useState(false);
  /** Where the band starts when Play is pressed: the bar it was paused on, or null for the top. */
  const [cueState, setCueState] = useState<PlayItem | null>(null);
  /** The cue as of the last key press, which can be ahead of the rendered state. */
  const cueNow = useRef<PlayItem | null>(null);
  const cue = cueState;
  const setCue = (item: PlayItem | null) => {
    cueNow.current = item;
    setCueState(item);
  };
  /** While playing, the bar the arrow keys are taking the band to, shown until it restarts there. */
  const [jump, setJump] = useState<PlayItem | null>(null);
  const pending = useRef<{ item: PlayItem; loop: number | null; countIn: boolean } | null>(null);
  const pendingTimer = useRef<number | null>(null);
  /** Read out to screen readers after a keyboard move. */
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    sharedPlayer?.setMasterMute(muted);
    store(MUTE_KEY, muted ? "1" : "0");
  }, [muted]);
  // Each tune remembers its own settings.
  useEffect(() => {
    saveSettings(chart, { tempo, transpose, style: styleId, choruses: repeat, countIn, twoFeel, view, showScales, mix });
  }, [chart, tempo, transpose, styleId, repeat, countIn, twoFeel, view, showScales, mix]);
  useEffect(() => store(INSTRUMENT_KEY, instrumentId), [instrumentId]);
  useEffect(() => store(SHORTCUTS_KEY, singleKeys ? "1" : "0"), [singleKeys]);

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
    p.onEnd = (finished) => {
      setStatus("idle");
      current.current = null;
      if (finished) setCue(null);
    };
    player.current = p;
    return p;
  };

  // Leaving the tune stops the band.
  useEffect(() => () => {
    if (sharedPlayer?.playing) sharedPlayer.stop();
  }, []);

  const start = useCallback(
    async (opts: Omit<PlaybackOptions, "choruses" | "transpose" | "tempo" | "twoFeel">, chorusOffset = 0) => {
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
      const full: PlaybackOptions = { ...opts, choruses: repeat, transpose, tempo, twoFeel };
      const schedule = buildSchedule(chart, style, full);
      current.current = { opts: full, schedule, style };
      p.metronomeOn = metronome;
      p.setMasterMute(muted);
      p.setTempo(tempo);
      p.setSchedule(schedule);
      p.play();
      setLoops(chorusOffset);
      setCue(null);
      setStatus("playing");
    },
    [chart, style, mix, repeat, transpose, metronome, tempo, twoFeel, muted],
  );


  // Changes that apply while playing.
  useEffect(() => player.current?.setTempo(tempo), [tempo]);
  useEffect(() => {
    if (player.current) player.current.metronomeOn = metronome;
  }, [metronome]);
  // Key, style and feel changes rebuild the notes in place; the Transport keeps its position.
  // A tempo change rebuilds once the presses settle, so the swing and comping fit the new tempo.
  useEffect(() => {
    const c = current.current;
    if (!playing || !c) return;
    const sameShape = c.opts.transpose === transpose && c.style === style && c.opts.twoFeel === twoFeel;
    if (sameShape && c.opts.tempo === tempo) return;
    const rebuild = () => {
      const now = current.current;
      if (!now || !player.current?.playing) return;
      const opts = { ...now.opts, transpose, tempo, twoFeel };
      const schedule = buildSchedule(chart, style, opts);
      current.current = { opts, schedule, style };
      player.current.setSchedule(schedule);
    };
    if (!sameShape) return rebuild();
    const id = window.setTimeout(rebuild, 400);
    return () => window.clearTimeout(id);
  }, [chart, style, transpose, tempo, twoFeel, playing]);

  const schedule = current.current?.schedule ?? null;
  const totalBeats = useMemo(
    () => playOrder(chart, repeat === "loop" ? 1 : repeat).length * chart.beatsPerBar + (countIn ? 2 * chart.beatsPerBar : 0),
    [chart, repeat, countIn],
  );
  const nowBar = position && schedule ? schedule.bars[position.bar] : null;
  const looping = current.current?.opts.loopSection != null;
  /** The chorus a bar is in, counting the repeats when the choruses go on until stopped. */
  const realChorus = (chorus: number) => (repeat === "loop" && !looping && chorus > 0 ? chorus + loops : chorus);

  /**
   * Start the band at a bar (null: the top, or the looped section's first bar).
   * When the choruses repeat until stopped the schedule holds only two, so a later
   * chorus starts in the second and the readout counts on from there.
   */
  const begin = (item: PlayItem | null, withCountIn: boolean, loop: number | null) => {
    let from = item ?? (loop !== null ? { ref: { part: "form" as const, section: loop, bar: 0 }, chorus: 1 } : null);
    let offset = 0;
    if (from && loop !== null) from = { ...from, chorus: from.ref.part === "form" ? 1 : 0 };
    else if (from && repeat === "loop" && from.chorus > 2) {
      offset = from.chorus - 2;
      from = { ...from, chorus: 2 };
    } else if (from && typeof repeat === "number" && from.chorus > repeat) from = { ...from, chorus: repeat };
    void start({ countIn: withCountIn, loopSection: loop, start: from }, offset);
  };

  /** The bar that's playing (or that the count-in leads into), as a place to come back to. */
  const placeNow = (): PlayItem | null => {
    if (nowBar?.ref) return { ref: nowBar.ref, chorus: realChorus(nowBar.chorus) };
    const target = current.current?.opts.start;
    return target ? { ref: target.ref, chorus: target.chorus } : null;
  };

  /** Space: pause and keep the place, or play from it. */
  const toggle = () => {
    if (status === "loading") return;
    if (status === "playing") {
      setCue(placeNow());
      player.current?.stop();
      return;
    }
    const outside = loopSection !== null && cue && !(cue.ref.part === "form" && cue.ref.section === loopSection);
    begin(outside ? null : cue, countIn, loopSection);
  };

  /** Home: stop and go back to the start (of the loop, when looping). */
  const toStart = () => {
    if (playing) player.current?.stop();
    setCue(null);
  };

  /**
   * Move to a bar from the keyboard. Stopped: move the cue. Playing: show it now and
   * restart there once the keys have been quiet for 200 ms, so holding an arrow
   * scrubs instead of restarting on every bar. During the count-in, count in again.
   */
  const go = (item: PlayItem, loop: number | null) => {
    setAnnounce(describe(item.ref, item.chorus, loop !== null));
    if (!playing) {
      setCue(item);
      return;
    }
    pending.current = { item, loop, countIn: !!nowBar?.countIn && countIn };
    setJump(item);
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = window.setTimeout(() => {
      const p = pending.current;
      pending.current = null;
      pendingTimer.current = null;
      setJump(null);
      if (p) keys.current.begin(p.item, p.countIn, p.loop);
    }, 200);
  };

  const fromHere = (): PlayItem | null => pending.current?.item ?? (playing ? placeNow() : cueNow.current);

  /** Left and Right: a bar back or on, in playing order; inside a loop they wrap. */
  const move = (delta: number) => {
    const from = fromHere();
    const order = navOrder(chart, repeat, loopSection, from?.chorus ?? 1);
    go(stepBar(order, from, delta, loopSection !== null), loopSection);
  };

  /** Shift with Left or Right: a section back or on; when looping, loop the next or previous section. */
  const moveSection = (delta: number) => {
    if (loopSection !== null) {
      const next = Math.min(chart.form.length - 1, Math.max(0, loopSection + delta));
      setLoopSection(next);
      go({ ref: { part: "form", section: next, bar: 0 }, chorus: 1 }, next);
      return;
    }
    const from = fromHere();
    go(stepSection(navOrder(chart, repeat, null, from?.chorus ?? 1), from, delta), null);
  };

  const playFrom = (ref: BarRef, loop: number | null) => {
    const chorus = ref.part === "form" ? (playing && nowBar ? realChorus(nowBar.chorus) : (cue?.chorus || 1)) : 0;
    begin({ ref, chorus }, playing ? false : countIn, loop);
  };

  const onBar = (ref: BarRef) => {
    setPicked(ref);
    const keepLoop = loopSection !== null && ref.part === "form" && ref.section === loopSection;
    if (!keepLoop && loopSection !== null) setLoopSection(null);
    playFrom(ref, keepLoop ? loopSection : null);
  };

  /** Loop the section that's playing, or the one last clicked; again to stop looping. */
  const toggleLoop = (section?: number) => {
    const here = nowBar?.ref ?? cue?.ref ?? picked;
    const target = section ?? (here?.part === "form" ? here.section : 0);
    const next = loopSection === target ? null : target;
    setLoopSection(next);
    if (!playing) {
      if (next !== null && cue && !(cue.ref.part === "form" && cue.ref.section === next)) setCue(null);
      return;
    }
    const inSection = here?.part === "form" && here.section === target;
    playFrom(next !== null && !inSection ? { part: "form", section: target, bar: 0 } : (here ?? { part: "form", section: target, bar: 0 }), next);
  };

  const onSeek = (fraction: number) => {
    // Seek within one pass of the chart: intro, form, ending.
    const b = bars[Math.min(bars.length - 1, Math.max(0, Math.floor(fraction * bars.length)))];
    onBar(b.ref);
  };

  const changeMix = (track: Mixable, state: MixState) => setMix((m) => ({ ...m, [track]: state }));
  // The mixer's state goes to the player as it changes, even while playing.
  useEffect(() => {
    (Object.keys(mix) as Mixable[]).forEach((t) => {
      player.current?.setVolume(t, mix[t].level);
      player.current?.setMute(t, mix[t].mute);
    });
  }, [mix]);

  /** Put every setting of this tune back to the chart's own and forget the stored entry. */
  const resetSettings = () => {
    const d = defaultSettings(chart);
    setTempo(d.tempo);
    setTranspose(d.transpose);
    setStyleId(d.style);
    setRepeat(d.choruses);
    setCountIn(d.countIn);
    setTwoFeel(d.twoFeel);
    setView(d.view);
    setShowScales(d.showScales);
    setMix(d.mix);
    clearSettings(chart.id);
  };

  /** What each shortcut does (keys in `./shortcuts.ts`). */
  const run = (id: ShortcutId, repeated: boolean) => {
    // Toggles ignore a held key, so holding one doesn't flicker; arrows and tempo repeat.
    const toggles: ShortcutId[] = ["play", "start", "loop", "click", "mute", "view", "help"];
    if (repeated && toggles.includes(id)) return;
    if (id === "play") toggle();
    else if (id === "start") toStart();
    else if (id === "bar-back" || id === "bar-on") move(id === "bar-on" ? 1 : -1);
    else if (id === "section-back" || id === "section-on") moveSection(id === "section-on" ? 1 : -1);
    else if (id === "slower" || id === "faster") setTempo((t) => Math.min(TEMPO.max, Math.max(TEMPO.min, t + (id === "faster" ? 5 : -5))));
    else if (id === "loop") toggleLoop();
    else if (id === "click") setMetronome((m) => !m);
    else if (id === "mute") setMuted((m) => !m);
    else if (id === "view" && headAvailable) setView((v) => (v === "chords" ? "sheet" : "chords"));
    else if (id === "help") setHelpOpen((o) => !o);
  };

  // Keys call the latest handlers through a ref, so the listener is added once.
  const keys = useRef({ run, begin, singleKeys });
  keys.current = { run, begin, singleKeys };
  useEffect(() => {
    let tookSpace = false;
    const onKey = (e: KeyboardEvent) => {
      if (leaveAlone(e)) return;
      const id = shortcutFor(e, keys.current.singleKeys);
      if (!id) return;
      e.preventDefault();
      if (id === "play") tookSpace = true;
      keys.current.run(id, e.repeat);
    };
    // Buttons click on Space's keyup, so a clicked-then-focused button needs it stopped too.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && tookSpace) {
        e.preventDefault();
        tookSpace = false;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Where we are, in words: the bar that's playing, or the one the band will start from.
  const shownRef = nowBar?.ref ?? (status === "idle" ? cue?.ref : null) ?? null;
  const nowNumber = shownRef ? bars.find((b) => sameRef(b.ref, shownRef)) : undefined;
  const describe = (ref: BarRef, chorus: number, inLoop: boolean) => {
    const number = bars.find((b) => sameRef(b.ref, ref))?.number;
    const part =
      ref.part === "intro"
        ? "Intro"
        : ref.part === "ending"
          ? chart.ending![ref.section].label
          : inLoop
            ? `${chart.form[ref.section].label} section`
            : repeat === "loop"
              ? `Chorus ${chorus}`
              : `Chorus ${chorus} of ${repeat}`;
    return `Bar ${number} · ${part}`;
  };
  let where = "";
  if (nowBar?.countIn) where = "Count-in";
  else if (nowBar?.ref) where = describe(nowBar.ref, realChorus(nowBar.chorus), looping);
  else if (status === "idle" && cue) where = `Paused · ${describe(cue.ref, cue.chorus, loopSection !== null)}`;
  if (!where && status === "idle") {
    const seconds = Math.round((totalBeats * 60) / tempo);
    where = repeat === "loop" ? "Repeats until stopped" : `${repeat} ${repeat === 1 ? "chorus" : "choruses"} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const progress = nowNumber ? (bars.indexOf(nowNumber) + (nowBar ? (position?.beat ?? 0) : 0) / chart.beatsPerBar) / bars.length : null;

  const nowChord = useMemo(() => {
    if (!nowBar || !position || nowBar.countIn) return null;
    const slot = chordAt(nowBar, position.beat);
    if (!slot) return null;
    const symbol = transposeSymbol(slot.chord.symbol, fold(instrument.offset), printedSpellPc);
    const scale = chordScale(parseChord(symbol), symbol.match(/^[A-G][#b]?/)![0], printedSpellPc);
    return `${displayParts(symbol).root} ${scale.name.toLowerCase()}: ${scale.notes.join(" ")}`;
  }, [nowBar, position, instrument.offset, printedSpellPc]);

  const sheetBar = nowBar?.ref ? (nowNumber?.sheetNumber ?? null) : null;
  const cueSheetBar = !nowBar?.ref && nowNumber ? nowNumber.sheetNumber : null;
  const onSheetBar = (n: number) => {
    const b = bars.find((x) => x.ref.part !== "ending" && x.sheetNumber === n);
    if (b) onBar(b.ref);
  };

  const loopLabel = loopSection !== null ? sectionName(chart, loopSection) : null;

  const settings = (
    <div className="settings">
      <label className="field">
        <span>Style</span>
        <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
          {Object.values(STYLES).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.id === chart.style ? " (original)" : ""}
            </option>
          ))}
        </select>
      </label>
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
      {style.twoFeel && (
        <label className="check">
          <input type="checkbox" checked={twoFeel} onChange={(e) => setTwoFeel(e.target.checked)} />
          Two-feel first chorus
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} />
        Two-bar count-in
      </label>
      <label className="check">
        <input type="checkbox" checked={showScales} onChange={(e) => setShowScales(e.target.checked)} />
        Show scales on the chart
      </label>
      <button type="button" className="quiet" onClick={resetSettings}>
        Reset to original
      </button>
      <h3>Mix</h3>
      <Mixer mix={mix} onChange={changeMix} band={bandFor(chart, style)} />
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
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <main className={`view view-${view}`}>
        {view === "sheet" && headAvailable ? (
          <LeadSheet
            chartId={chart.id}
            shift={shift}
            bar={sheetBar}
            cue={cueSheetBar}
            loopBars={loopSection === null ? [] : bars.filter((b) => b.ref.part === "form" && b.ref.section === loopSection).map((b) => b.sheetNumber)}
            onBar={onSheetBar}
          />
        ) : (
          <ChordGrid
            chart={chart}
            shift={shift}
            keyPc={printedSpellPc}
            active={jump?.ref ?? nowBar?.ref ?? null}
            cued={status === "idle" ? (cue?.ref ?? null) : null}
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
        onFromTop={status === "idle" && cue ? toStart : null}
        settings={settings}
        onHelp={() => setHelpOpen(true)}
      />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} singleKeys={singleKeys} onSingleKeys={setSingleKeys} />
    </div>
  );
}
