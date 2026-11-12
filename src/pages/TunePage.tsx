import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type Mixable, type Position } from "../audio/player";
import { displayParts, isMinorKey, keyPitchClass, parseChord, spellingPc, transposeSymbol } from "../chart/chords";
import { INSTRUMENTS } from "../chart/instruments";
import { chordScale } from "../chart/scales";
import { TEMPO, type Chart } from "../chart/types";
import { hasHead, loadMelody } from "../charts/heads";
import { ChordGrid } from "../components/ChordGrid";
import { ControlBar, type ProgressStep, type View } from "../components/ControlBar";
import { LeadSheet } from "../components/LeadSheet";
import { Mixer, type MixState } from "../components/Mixer";
import { ShortcutHelp } from "../components/ShortcutHelp";
import { MELODY_LABELS, MELODY_MODES, type MelodyMode, type MelodyNote } from "../engine/melody";
import { bandFor, buildSchedule, chorusesFor, chorusLayoutChanges, clickLabel, performanceBeats, type ClickMode, type PlaybackOptions, type Repeat, type Schedule } from "../engine/schedule";
import { chartBars, chorusTranspose, chordAt, fold, itemAtFraction, keyCycle, nextChord, performanceFraction, navOrder, playOrder, rangeBars, rangeOrder, sameRef, stepBar, stepSection, type BarRange, type BarRef, type KeyStep, type PlayItem } from "../engine/timeline";
import { STYLES, playableStyle, stylesFor } from "../styles";
import type { Style } from "../styles/types";
import { keyLabel, keyWords } from "./format";
import { TRADE_LABELS, TRADE_MODES, tradeLabel, type TradeMode } from "../engine/trading";
import { shareUrl, rememberable, withLink, type LinkSettings } from "./share";
import { recordOpened } from "./tuneList";
import { applyPreset, effectiveMute, PRESETS } from "./mix";
import { CHORDS_SHOWN, clearSettings, defaultSettings, loadSettings, raisedTempo, REPEATS, saveSettings, SPEED_UPS, type ChordsShown, type SpeedUp } from "./settings";
import { leaveAlone, shortcutFor, type ShortcutId } from "./shortcuts";
import { readStored, store } from "./storage";
import { useWakeLock } from "./useWakeLock";

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

type Status = "idle" | "loading" | "playing";

/** What the band repeats until stopped: one form section, a run of bars, or nothing. */
type Loop = { section: number } | { range: BarRange } | null;

const sectionStart = (section: number): PlayItem => ({ ref: { part: "form", section, bar: 0 }, chorus: 1 });

export function TunePage({ chart, link = {} }: { chart: Chart; /** Settings from the address, for this visit only. */ link?: LinkSettings }) {
  /** What the tune remembers, and with a shared link's settings on top for this visit. */
  const stored = useMemo(() => loadSettings(chart), [chart]);
  const initial = useMemo(() => withLink(stored, link), [stored, link]);
  /** The link whose values aren't remembered yet; emptied by Reset, which leaves nothing stored. */
  const linkNow = useRef(link);
  /** False once the page is left, so a load that finishes late doesn't start the band. */
  const alive = useRef(true);
  /** The band's style: the chart's own by default, any other on request. */
  const [styleId, setStyleId] = useState(playableStyle(chart, initial.style));
  const style = STYLES[playableStyle(chart, styleId)];
  const chartKeyPc = keyPitchClass(chart.key);
  const minor = isMinorKey(chart.key);
  const bars = useMemo(() => chartBars(chart), [chart]);
  const headAvailable = hasHead(chart.id);
  const player = useRef<Player | null>(sharedPlayer);
  const current = useRef<{ opts: PlaybackOptions; schedule: Schedule; style: Style; repeat: Repeat } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tempo, setTempo] = useState(initial.tempo);
  const [twoFeel, setTwoFeel] = useState(initial.twoFeel);
  const [transpose, setTranspose] = useState(initial.transpose);
  const [instrumentId, setInstrumentId] = useState(() => link.instrument ?? readInstrument());
  const linkedInstrument = useRef(link.instrument);
  const [repeat, setRepeat] = useState<Repeat>(initial.choruses);
  const [countInBars, setCountInBars] = useState(initial.countIn);
  const countIn = countInBars > 0;
  const [intro, setIntro] = useState(initial.intro);
  const [ending, setEnding] = useState(initial.ending);
  const [clickMode, setClickMode] = useState<ClickMode>(initial.click);
  const [speedUp, setSpeedUp] = useState<SpeedUp>(initial.speedUp);
  /** Read by the player's callbacks, which outlive a render. */
  const speedUpNow = useRef(speedUp);
  speedUpNow.current = speedUp;
  const [keyStep, setKeyStep] = useState<KeyStep>(initial.keyStep);
  const [trade, setTrade] = useState<TradeMode>(initial.trade);
  const [melody, setMelody] = useState<MelodyMode>(initial.melody);
  /** The head's notes by printed measure, read when the melody is on. */
  const measures = useRef<MelodyNote[][] | null>(null);
  const [measuresReady, setMeasuresReady] = useState(false);
  const melodyOpts = () => (headAvailable && melody !== "off" && measures.current ? { mode: melody, measures: measures.current } : undefined);
  const [chordsShown, setChordsShown] = useState<ChordsShown>(initial.chords);
  const [metronome, setMetronome] = useState(false);
  const [showScales, setShowScales] = useState(initial.showScales);
  const [view, setView] = useState<View>(initial.view);
  const [loop, setLoop] = useState<Loop>(null);
  const loopSection = loop && "section" in loop ? loop.section : null;
  const loopRange = loop && "range" in loop ? loop.range : null;
  const rangeNumbers = useMemo(() => (loopRange ? rangeBars(chart, loopRange) : []), [chart, loopRange]);
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
  const pending = useRef<{ item: PlayItem; loop: Loop; countIn: boolean } | null>(null);
  const pendingTimer = useRef<number | null>(null);
  /** Read out to screen readers after a keyboard move. */
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    sharedPlayer?.setMasterMute(muted);
    store(MUTE_KEY, muted ? "1" : "0");
  }, [muted]);
  // Each tune remembers its own settings.
  useEffect(() => {
    saveSettings(chart, rememberable({ tempo, transpose, style: styleId, choruses: repeat, countIn: countInBars, twoFeel, intro, ending, view, click: clickMode, showScales, speedUp, keyStep, trade, chords: chordsShown, melody, mix }, stored, linkNow.current));
  }, [chart, tempo, transpose, styleId, repeat, countInBars, twoFeel, intro, ending, view, clickMode, showScales, speedUp, keyStep, trade, chordsShown, melody, mix]);
  useEffect(() => {
    // An instrument that came from a link isn't remembered until the player picks one.
    if (linkedInstrument.current === instrumentId) return;
    linkedInstrument.current = undefined;
    store(INSTRUMENT_KEY, instrumentId);
  }, [instrumentId]);
  useEffect(() => store(SHORTCUTS_KEY, singleKeys ? "1" : "0"), [singleKeys]);

  const instrument = INSTRUMENTS.find((i) => i.id === instrumentId)!;
  const playing = status === "playing";
  useWakeLock(playing);

  const getPlayer = () => {
    if (!sharedPlayer) sharedPlayer = new Player();
    const p = sharedPlayer;
    p.onPosition = setPosition;
    // Every pass of a loop (the player calls this from a Transport event, not from the playhead) can raise the tempo.
    p.onPass = () => {
      if (speedUpNow.current > 0) setTempo((t) => raisedTempo(t, speedUpNow.current));
    };
    // A wrap goes back a whole key cycle of choruses, so the chorus count on screen moves on by that many.
    p.onLoop = () => setLoops((n) => n + (current.current?.schedule.cycle ?? 1));
    p.onEnd = (finished) => {
      setStatus("idle");
      current.current = null;
      if (finished) setCue(null);
    };
    player.current = p;
    return p;
  };

  // Remember when this tune was opened, for the library's "Recently opened" order.
  useEffect(() => recordOpened(chart.id), [chart.id]);

  // Leaving the tune stops the band.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
      pending.current = null;
      if (sharedPlayer?.playing) sharedPlayer.stop();
    };
  }, []);

  // The head's notes load when the melody is switched on (also while playing, which then rebuilds).
  useEffect(() => {
    if (!headAvailable || melody === "off") return;
    let wanted = true;
    loadMelody(chart.id).then((m) => {
      if (!wanted) return;
      measures.current = m;
      setMeasuresReady(true);
    });
    return () => {
      wanted = false;
    };
  }, [chart.id, headAvailable, melody]);

  const start = useCallback(
    async (opts: Omit<PlaybackOptions, "choruses" | "transpose" | "tempo" | "twoFeel" | "countInBars" | "intro" | "ending" | "keyStep" | "trade" | "melody">, choruses: Repeat = repeat) => {
      const p = getPlayer();
      setError(null);
      setStatus("loading");
      try {
        await p.load();
      } catch (e) {
        console.error(e);
        if (!alive.current) return;
        setError("Couldn't load the instrument sounds. Reload the page to try again.");
        setStatus("idle");
        return;
      }
      if (headAvailable && melody !== "off") measures.current = await loadMelody(chart.id);
      // The page was left while the sounds loaded: there is nothing to play along with.
      if (!alive.current) return;
      (Object.keys(mix) as Mixable[]).forEach((t) => {
        p.setVolume(t, mix[t].level);
        p.setMute(t, effectiveMute(mix, t));
      });
      const full: PlaybackOptions = { ...opts, countInBars: opts.countIn ? countInBars : 0, intro, ending, keyStep, trade, melody: melodyOpts(), choruses, transpose, tempo, twoFeel };
      const schedule = buildSchedule(chart, style, full);
      current.current = { opts: full, schedule, style, repeat };
      p.metronomeOn = metronome;
      p.clickMode = clickMode;
      p.setMasterMute(muted);
      p.setTempo(tempo);
      p.setSchedule(schedule);
      p.play();
      setLoops(0);
      setCue(null);
      setStatus("playing");
    },
    [chart, style, mix, repeat, countInBars, intro, ending, keyStep, trade, melody, headAvailable, transpose, metronome, clickMode, tempo, twoFeel, muted],
  );


  // Changes that apply while playing.
  useEffect(() => player.current?.setTempo(tempo), [tempo]);
  useEffect(() => {
    if (player.current) player.current.metronomeOn = metronome;
  }, [metronome]);
  useEffect(() => {
    if (player.current) player.current.clickMode = clickMode;
  }, [clickMode]);
  // Key, style and feel changes rebuild the notes in place; the Transport keeps its position.
  // A tempo change rebuilds once the presses settle, so the swing and comping fit the new tempo.
  useEffect(() => {
    const c = current.current;
    if (!playing || !c) return;
    const m = melodyOpts();
    const sameShape = c.opts.melody?.mode === m?.mode && c.opts.melody?.measures === m?.measures && c.opts.transpose === transpose && c.opts.keyStep === keyStep && c.opts.trade === trade && c.style === style && c.opts.twoFeel === twoFeel && c.repeat === repeat;
    if (sameShape && c.opts.tempo === tempo) return;
    const rebuild = () => {
      const now = current.current;
      if (!now || !player.current?.playing) return;
      let choruses = now.opts.choruses;
      const looped = now.opts.loopSection != null || !!now.opts.loopRange;
      // Restart at this bar (no count-in) with the schedule's bars laid out another way.
      const restart = (withChoruses: Repeat) => {
        current.current = { ...now, repeat };
        const here = placeNow();
        if (!here) return false;
        keys.current.begin(here, false, loopOf(now.opts), withChoruses);
        return true;
      };
      if (now.repeat !== repeat && !looped) {
        if (repeat === "loop" || now.repeat === "loop") {
          // Chorus numbers mean something different when they repeat until stopped, so carry on from this bar.
          if (restart(repeat)) return;
          // Still counting in from the top: there's no place to keep, so build with the new choruses.
          choruses = repeat;
        } else if (typeof repeat === "number") {
          const part = nowBar?.ref?.part;
          const at = part === "form" ? nowBar!.chorus : part === "ending" ? (now.opts.choruses as number) : 1;
          choruses = chorusesFor(repeat, at);
          // The band keeps its place only if the bars before and in this chorus stay as they are: a head chorus
          // holds other sections than a solo one, and the ending moves when choruses are added before it.
          const moved = part === "ending" ? choruses !== now.opts.choruses : part === "form" && typeof now.opts.choruses === "number" && chorusLayoutChanges(chart, now.opts.choruses, choruses, at);
          if (moved && restart(choruses)) return;
        }
      }
      // A different key step changes how many choruses a loop lays out, so the loop starts over from this bar.
      if (now.schedule.loop && now.opts.keyStep !== keyStep && keyCycle(now.opts.keyStep ?? 0) !== keyCycle(keyStep) && restart(now.opts.choruses)) return;
      const opts = { ...now.opts, choruses, transpose, keyStep, trade, melody: melodyOpts(), tempo, twoFeel };
      const schedule = buildSchedule(chart, style, opts);
      current.current = { opts, schedule, style, repeat };
      player.current.setSchedule(schedule);
    };
    if (!sameShape) return rebuild();
    const id = window.setTimeout(rebuild, 400);
    return () => window.clearTimeout(id);
  }, [chart, style, transpose, keyStep, trade, melody, measuresReady, tempo, twoFeel, repeat, playing]);

  const schedule = current.current?.schedule ?? null;
  const totalBeats = useMemo(
    () => performanceBeats(chart, { choruses: repeat === "loop" ? 1 : repeat, countInBars, intro, ending }),
    [chart, repeat, countInBars, intro, ending],
  );
  const nowBar = position && schedule ? schedule.bars[position.bar] : null;
  const looping = current.current?.opts.loopSection != null || current.current?.opts.loopRange != null;
  /**
   * The chorus a bar is in. A loop's bars are numbered from where it started and the schedule
   * repeats a key cycle of them, so each wrap adds that many (`loops`).
   * This reads the schedule that is playing, not the Choruses setting, which may just have changed.
   */
  const realChorus = (chorus: number) => (current.current?.schedule.loop && chorus > 0 ? chorus + loops : chorus);
  /** How many choruses the schedule that's playing has (what the ending's key and "of N" go by), else the setting. */
  const builtChoruses = useMemo(() => (schedule ? Math.max(1, ...schedule.bars.map((b) => b.chorus)) : typeof repeat === "number" ? repeat : 1), [schedule, repeat]);

  // With key cycling the key follows the chorus that's playing (or the one the band will start in).
  const chorusKey = (ref: BarRef, chorus: number) => (ref.part === "form" ? chorus || 1 : ref.part === "ending" ? builtChoruses : 1);
  const placeShown: PlayItem | null = nowBar?.ref
    ? { ref: nowBar.ref, chorus: realChorus(nowBar.chorus) }
    : nowBar?.countIn
      ? (current.current?.opts.start ?? null)
      : status === "idle"
        ? cue
        : null;
  /** Half steps from the original key of the music on show. */
  const shownTranspose = chorusTranspose(transpose, keyStep, placeShown ? chorusKey(placeShown.ref, placeShown.chorus) : 1);
  const shift = fold(shownTranspose + instrument.offset);
  const printedKeyPc = (chartKeyPc + shift + 12) % 12;
  /** The major key the printed chords are spelled in (the relative major for a minor tune). */
  const printedSpellPc = spellingPc(printedKeyPc, minor);
  const concertKeyPc = (chartKeyPc + shownTranspose + 12) % 12;

  /**
   * Start the band at a bar (null: the top, or the looped section's first bar).
   * `choruses` is how many to build (the current count unless the band is finishing a chorus
   * after the count was lowered). A loop, or choruses until stopped, builds from the chorus
   * it starts in, and the readout counts on from there.
   */
  const begin = (item: PlayItem | null, withCountIn: boolean, toLoop: Loop, choruses: Repeat = repeat) => {
    let from = item ?? loopStart(toLoop);
    // Loops and choruses until stopped number their choruses from the one they start in, so a later one starts as itself.
    if (from && toLoop !== null) from = { ...from, chorus: from.ref.part === "form" ? Math.max(1, from.chorus) : 0 };
    else if (from && typeof choruses === "number" && from.chorus > choruses) from = { ...from, chorus: choruses };
    void start(
      {
        countIn: withCountIn,
        loopSection: toLoop && "section" in toLoop ? toLoop.section : null,
        loopRange: toLoop && "range" in toLoop ? toLoop.range : null,
        start: from,
      },
      choruses,
    );
  };

  /** The loop an option set repeats. */
  const loopOf = (o: PlaybackOptions): Loop => (o.loopSection != null ? { section: o.loopSection } : o.loopRange ? { range: o.loopRange } : null);

  /** The first bar of a loop. */
  const loopStart = (l: Loop): PlayItem | null => {
    if (!l) return null;
    if ("section" in l) return sectionStart(l.section);
    const first = rangeBars(chart, l.range)[0];
    return first ? { ref: first.ref, chorus: 1 } : null;
  };

  /** Whether a bar is inside a loop. */
  const inLoop = (ref: BarRef, l: Loop) => {
    if (!l) return false;
    if ("section" in l) return ref.part === "form" && ref.section === l.section;
    return rangeBars(chart, l.range).some((b) => sameRef(b.ref, ref));
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
      // A jump the arrow keys are still waiting to make becomes the cue; either way it doesn't restart the band after the pause.
      const target = pending.current?.item ?? placeNow();
      cancelPending();
      setCue(target);
      player.current?.stop();
      return;
    }
    const outside = loop !== null && cue && !inLoop(cue.ref, loop);
    begin(outside ? null : cue, countIn, loop);
  };

  /** Drop a jump the arrow keys have queued (its 200 ms timer included). */
  const cancelPending = () => {
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
    pending.current = null;
    setJump(null);
  };

  /** Home: stop and go back to the start (of the loop, when looping). */
  const toStart = () => {
    cancelPending();
    if (playing) player.current?.stop();
    setCue(null);
  };

  /**
   * Move to a bar from the keyboard. Stopped: move the cue. Playing: show it now and
   * restart there once the keys have been quiet for 200 ms, so holding an arrow
   * scrubs instead of restarting on every bar. During the count-in, count in again.
   */
  const go = (target: PlayItem, toLoop: Loop) => {
    // In a loop the order is one pass long: carry on in the chorus (so the key) the band is in.
    const item = toLoop !== null && target.ref.part === "form" ? { ...target, chorus: Math.max(1, fromHere()?.chorus ?? 1) } : target;
    setAnnounce(describe(item.ref, item.chorus, toLoop !== null));
    if (!playing) {
      setCue(item);
      return;
    }
    pending.current = { item, loop: toLoop, countIn: !!nowBar?.countIn && countIn };
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
    const order = loopRange ? rangeOrder(chart, loopRange, 1) : navOrder(chart, repeat, loopSection, from?.chorus ?? 1, intro, ending);
    go(stepBar(order, from, delta, loop !== null), loop);
  };

  /** Shift with Left or Right: a section back or on; when looping, loop the next or previous section. */
  const moveSection = (delta: number) => {
    if (loopRange) return;
    if (loopSection !== null) {
      const next = Math.min(chart.form.length - 1, Math.max(0, loopSection + delta));
      setLoop({ section: next });
      go(sectionStart(next), { section: next });
      return;
    }
    const from = fromHere();
    go(stepSection(navOrder(chart, repeat, null, from?.chorus ?? 1, intro, ending), from, delta), null);
  };

  const playFrom = (ref: BarRef, toLoop: Loop) => {
    const chorus = ref.part === "form" ? (playing && nowBar ? realChorus(nowBar.chorus) : (cue?.chorus || 1)) : 0;
    begin({ ref, chorus }, playing ? false : countIn, toLoop);
  };

  const onBar = (ref: BarRef) => {
    setPicked(ref);
    const keepLoop = loop !== null && inLoop(ref, loop);
    if (!keepLoop && loop !== null) setLoop(null);
    playFrom(ref, keepLoop ? loop : null);
  };

  /** Shift-click, or a press and hold on touch: loop from the bar last clicked to this one. */
  const onRange = (ref: BarRef) => {
    if (!picked) return onBar(ref);
    const range = { from: picked, to: ref };
    const first = rangeBars(chart, range)[0];
    if (!first) return onBar(ref);
    setLoop({ range });
    begin({ ref: first.ref, chorus: 1 }, playing ? false : countIn, { range });
  };

  /** Stop looping, and carry on from the same bar when playing. */
  const clearLoop = () => {
    if (!loop) return;
    cancelPending();
    setLoop(null);
    if (playing) {
      const here = nowBar?.ref;
      if (here) playFrom(here, null);
    }
  };

  /** Loop the section that's playing, or the one last clicked; again to stop looping. */
  const toggleLoop = (section?: number) => {
    if (section === undefined && loopRange) return clearLoop();
    const here = nowBar?.ref ?? cue?.ref ?? picked;
    const target = section ?? (here?.part === "form" ? here.section : 0);
    const next = loopSection === target ? null : target;
    const nextLoop: Loop = next === null ? null : { section: next };
    setLoop(nextLoop);
    if (!playing) {
      if (next !== null && cue && !(cue.ref.part === "form" && cue.ref.section === next)) setCue(sectionStart(next));
      return;
    }
    const inSection = here?.part === "form" && here.section === target;
    playFrom(next !== null && !inSection ? sectionStart(target).ref : (here ?? sectionStart(target).ref), nextLoop);
  };

  /** Every bar of the performance in order: intro, all the choruses, ending (one chorus when they repeat until stopped). */
  const performance = useMemo(
    () => (repeat === "loop" ? playOrder(chart, 1, intro, false, false) : playOrder(chart, repeat, intro, ending, true)),
    [chart, repeat, intro, ending],
  );

  /** The progress line: go to the bar that fraction of the way through the whole performance, in its chorus. */
  const onSeek = (fraction: number) => {
    const item = itemAtFraction(performance, fraction);
    setPicked(item.ref);
    const keepLoop = loop !== null && inLoop(item.ref, loop);
    if (!keepLoop && loop !== null) setLoop(null);
    begin(item, playing ? false : countIn, keepLoop ? loop : null);
  };

  /** Keys on the progress line: a bar, a section, or the start or end. */
  const onStep = (kind: ProgressStep) => {
    if (kind === "bar-back" || kind === "bar-on") return move(kind === "bar-on" ? 1 : -1);
    if (kind === "section-back" || kind === "section-on") return moveSection(kind === "section-on" ? 1 : -1);
    const from = fromHere();
    const order = loopRange ? rangeOrder(chart, loopRange, 1) : repeat === "loop" && loopSection === null ? performance : navOrder(chart, repeat, loopSection, from?.chorus ?? 1, intro, ending);
    go(kind === "start" ? order[0] : order[order.length - 1], loop);
  };

  const changeMix = (track: Mixable, state: MixState) => setMix((m) => ({ ...m, [track]: state }));
  const changePreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) setMix((m) => applyPreset(m, preset, bandFor(chart, style)));
  };
  // The mixer's state goes to the player as it changes, even while playing.
  useEffect(() => {
    (Object.keys(mix) as Mixable[]).forEach((t) => {
      player.current?.setVolume(t, mix[t].level);
      player.current?.setMute(t, effectiveMute(mix, t));
    });
  }, [mix]);

  const [copied, setCopied] = useState<"copied" | "address" | null>(null);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);
  /** Copy a link to this tune with the tempo, key, style, instrument and choruses on screen. */
  const copyLink = async () => {
    const url = shareUrl(window.location.origin + window.location.pathname, chart.id, { tempo, transpose, style: styleId, instrument: instrumentId, choruses: repeat, trade, chords: chordsShown, melody });
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      // No clipboard (blocked or not allowed): put the link in the address bar to copy from there.
      window.history.replaceState(null, "", url);
      setCopied("address");
    }
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 2500);
  };

  /** Put every setting of this tune back to the chart's own and forget the stored entry. */
  const resetSettings = () => {
    const d = defaultSettings(chart);
    setTempo(d.tempo);
    setTranspose(d.transpose);
    setStyleId(d.style);
    setRepeat(d.choruses);
    setCountInBars(d.countIn);
    setTwoFeel(d.twoFeel);
    setIntro(d.intro);
    setEnding(d.ending);
    setView(d.view);
    setClickMode(d.click);
    setShowScales(d.showScales);
    setSpeedUp(d.speedUp);
    setKeyStep(d.keyStep);
    setTrade(d.trade);
    setMelody(d.melody);
    setChordsShown(d.chords);
    setMix(d.mix);
    // The link no longer decides what is kept: with it, a value equal to the link's would put the old stored one back.
    linkNow.current = {};
    clearSettings(chart.id);
  };

  /** What each shortcut does (keys in `./shortcuts.ts`). */
  const run = (id: ShortcutId, repeated: boolean) => {
    // Toggles ignore a held key, so holding one doesn't flicker; arrows and tempo repeat.
    const toggles: ShortcutId[] = ["play", "start", "loop", "click", "mute", "view", "chords", "help"];
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
    else if (id === "chords") setChordsShown((c) => CHORDS_SHOWN[(CHORDS_SHOWN.indexOf(c) + 1) % CHORDS_SHOWN.length]);
    else if (id === "help") setHelpOpen((o) => !o);
  };

  // Keys call the latest handlers through a ref, so the listener is added once.
  const keys = useRef({ run, begin, singleKeys, clearLoop });
  keys.current = { run, begin, singleKeys, clearLoop };
  useEffect(() => {
    let tookSpace = false;
    const onKey = (e: KeyboardEvent) => {
      if (leaveAlone(e)) return;
      if (e.key === "Escape" && !e.defaultPrevented) return keys.current.clearLoop();
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
              : `Chorus ${chorus} of ${builtChoruses}`;
    return `Bar ${number} · ${part}`;
  };
  let where = "";
  if (nowBar?.countIn) where = "Count-in";
  else if (nowBar?.ref) {
    where = describe(nowBar.ref, realChorus(nowBar.chorus), looping);
    if (nowBar.trade) where += ` · ${tradeLabel(current.current?.opts.trade ?? trade, nowBar.trade)}`;
  } else if (status === "idle" && cue) where = `Paused · ${describe(cue.ref, cue.chorus, loop !== null)}`;
  if (!where && status === "idle") {
    const seconds = Math.round((totalBeats * 60) / tempo);
    where = repeat === "loop" ? "Repeats until stopped" : `${repeat} ${repeat === 1 ? "chorus" : "choruses"} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  // A bar the run plays twice (a repeated ending tag) is told apart by its place in the schedule that's playing.
  const performanceIndex = (() => {
    const c = current.current;
    if (!nowBar?.ref || !c || c.schedule.loop) return undefined;
    const from = c.opts.start;
    const startIndex = from ? performance.findIndex((x) => sameRef(x.ref, from.ref) && x.chorus === from.chorus) : 0;
    return startIndex < 0 ? undefined : startIndex + nowBar.index - c.schedule.bars.filter((b) => b.countIn).length;
  })();
  const progress = placeShown && !nowBar?.countIn ? performanceFraction(performance, placeShown, nowBar ? (position?.beat ?? 0) : 0, chart.beatsPerBar, performanceIndex) : null;

  // The chords stay off the page when hidden, or after the first chorus has begun (the intro, count-in and a stopped band show them).
  const chordsHidden =
    chordsShown === "hidden" ||
    (chordsShown === "after-first" && !!nowBar && ((nowBar.ref?.part === "form" && realChorus(nowBar.chorus) >= 2) || (nowBar.ref?.part === "ending" && builtChoruses >= 2)));

  const nowChord = useMemo(() => {
    if (!nowBar || !position || nowBar.countIn || chordsHidden) return null;
    const slot = chordAt(nowBar, position.beat);
    if (!slot) return null;
    const spellFor = (t: number) => spellingPc((chartKeyPc + fold(t + instrument.offset) + 12) % 12, minor);
    const symbol = transposeSymbol(slot.chord.symbol, fold(instrument.offset), spellFor(nowBar.transpose));
    const scale = chordScale(parseChord(symbol), symbol.match(/^[A-G][#b]?/)![0], spellFor(nowBar.transpose));
    let text = `${displayParts(symbol).root} ${scale.name.toLowerCase()}: ${scale.notes.join(" ")}`;
    const loopAt = current.current?.schedule.loop;
    const next = nextChord(current.current!.schedule.bars, nowBar.index, position.beat, 2, loopAt ? loopAt.start / chart.beatsPerBar : null);
    if (next) {
      const n = displayParts(transposeSymbol(next.chord.symbol, fold(instrument.offset), spellFor(next.transpose)));
      text += ` · next ${n.root}${n.quality}${n.bass ? "/" + n.bass : ""}`;
    }
    return text;
  }, [nowBar, position, instrument.offset, chartKeyPc, minor, chart.beatsPerBar, chordsHidden]);

  const sheetBar = nowBar?.ref ? (nowNumber?.sheetNumber ?? null) : null;
  const cueSheetBar = !nowBar?.ref && nowNumber ? nowNumber.sheetNumber : null;
  const sheetRef = (n: number) => bars.find((x) => x.ref.part !== "ending" && x.sheetNumber === n)?.ref;
  const onSheetBar = (n: number) => {
    const ref = sheetRef(n);
    if (ref) onBar(ref);
  };
  const onSheetRange = (n: number) => {
    const ref = sheetRef(n);
    if (ref) onRange(ref);
  };
  const loopSheetBars = loopRange
    ? rangeNumbers.map((b) => b.sheetNumber)
    : loopSection === null
      ? []
      : bars.filter((b) => b.ref.part === "form" && b.ref.section === loopSection).map((b) => b.sheetNumber);

  const rangeLabel = rangeNumbers.length
    ? rangeNumbers.length === 1
      ? `Bar ${rangeNumbers[0].number}`
      : `Bars ${rangeNumbers[0].number}-${rangeNumbers.at(-1)!.number}`
    : null;
  const loopLabel = loopSection !== null ? `Loop ${sectionName(chart, loopSection)}` : rangeLabel;

  const settings = (
    <div className="settings">
      <label className="field">
        <span>Style</span>
        <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
          {stylesFor(chart).map((s) => (
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
        <span>Key each chorus</span>
        <select value={keyStep} onChange={(e) => setKeyStep(Number(e.target.value) as KeyStep)}>
          <option value={0}>Same key</option>
          <option value={5}>Up a fourth</option>
          <option value={1}>Up a half step</option>
          <option value={-1}>Down a half step</option>
          <option value={2}>Up a whole step</option>
        </select>
      </label>
      <label className="field">
        <span>Trade</span>
        <select value={trade} onChange={(e) => setTrade(e.target.value as TradeMode)}>
          {TRADE_MODES.map((m) => (
            <option key={m} value={m}>
              {TRADE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      {headAvailable && (
        <label className="field">
          <span>Melody</span>
          <select value={melody} onChange={(e) => setMelody(e.target.value as MelodyMode)}>
            {MELODY_MODES.map((m) => (
              <option key={m} value={m}>
                {MELODY_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Chords shown</span>
        <select value={chordsShown} onChange={(e) => setChordsShown(e.target.value as ChordsShown)}>
          <option value="always">Always</option>
          <option value="after-first">After the first chorus: hidden</option>
          <option value="hidden">Hidden</option>
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
        <select value={String(repeat)} onChange={(e) => setRepeat(e.target.value === "loop" ? "loop" : Number(e.target.value))}>
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
      {chart.intro && (
        <label className="check">
          <input type="checkbox" checked={intro} onChange={(e) => setIntro(e.target.checked)} />
          Play the intro
        </label>
      )}
      {chart.ending && (
        <label className="check">
          <input type="checkbox" checked={ending} onChange={(e) => setEnding(e.target.checked)} />
          Play the ending
        </label>
      )}
      <label className="field">
        <span>Count-in</span>
        <select value={countInBars} onChange={(e) => setCountInBars(Number(e.target.value) as 0 | 1 | 2)}>
          <option value={0}>None</option>
          <option value={1}>1 bar</option>
          <option value={2}>2 bars</option>
        </select>
      </label>
      <label className="field">
        <span>Metronome plays</span>
        <select value={clickMode} onChange={(e) => setClickMode(e.target.value as ClickMode)}>
          <option value="every">Every beat</option>
          <option value="two-four">{clickLabel("two-four", chart.beatsPerBar)}</option>
          <option value="one">Beat 1 only</option>
        </select>
      </label>
      <label className="field">
        <span>Speed up</span>
        <select value={speedUp} onChange={(e) => setSpeedUp(Number(e.target.value) as SpeedUp)}>
          {SPEED_UPS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Off" : `+${n} BPM each pass`}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={showScales} onChange={(e) => setShowScales(e.target.checked)} />
        Show scales on the chart
      </label>
      <div className="quiet-row">
        <button type="button" className="quiet" onClick={resetSettings}>
          Reset to original
        </button>
        <button type="button" className="quiet" onClick={copyLink}>
          {copied === "copied" ? "Copied" : copied === "address" ? "Link in the address bar" : "Copy link"}
        </button>
      </div>
      <h3>Mix</h3>
      <Mixer mix={mix} onChange={changeMix} onPreset={changePreset} band={melody !== "off" && headAvailable ? [...bandFor(chart, style), "melody"] : bandFor(chart, style)} />
    </div>
  );

  return (
    <div className="app">
      <a
        className="skip"
        href={window.location.hash || "#/"}
        onClick={(e) => {
          e.preventDefault();
          document.querySelector<HTMLElement>("#player .play")?.focus();
        }}
      >
        Skip to player
      </a>
      <header className="head">
        <a className="back" href="#/">
          All tunes
        </a>
        <h1>{chart.title}</h1>
        <p className="meta">
          <span>{style.name}</span>
          <span>
            {keyWords(concertKeyPc, minor)}
            {shownTranspose !== 0 && `, ${steps(shownTranspose)} from ${keyLabel(chartKeyPc, minor)}`}
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
            loopBars={loopSheetBars}
            hideChords={chordsHidden}
            onBar={onSheetBar}
            onRange={onSheetRange}
          />
        ) : (
          <ChordGrid
            chart={chart}
            shift={shift}
            keyPc={printedSpellPc}
            active={jump?.ref ?? nowBar?.ref ?? null}
            cued={status === "idle" ? (cue?.ref ?? null) : null}
            showScales={showScales}
            hideChords={chordsHidden}
            loopSection={loopSection}
            loopRange={rangeNumbers.map((b) => b.ref)}
            onBar={onBar}
            onRange={onRange}
            onSection={(s) => toggleLoop(s)}
          />
        )}
      </main>

      <ControlBar
        status={status}
        onPlay={toggle}
        tempo={tempo}
        originalTempo={chart.tempo}
        onTempo={setTempo}
        where={where}
        detail={nowChord}
        progress={progress}
        onSeek={onSeek}
        onStep={onStep}
        progressText={where}
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
        onPrevBar={() => move(-1)}
        onNextBar={() => move(1)}
        settings={settings}
        onHelp={() => setHelpOpen(true)}
      />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} singleKeys={singleKeys} onSingleKeys={setSingleKeys} />
    </div>
  );
}
