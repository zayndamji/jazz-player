import { useEffect, useRef } from "react";
import { BEAT, barTokens, displayParts, parseBar, parseChord, transposeSymbol } from "../chart/chords";
import { chordScale } from "../chart/scales";
import type { Chart, Section } from "../chart/types";
import { chartBars, sameRef, type BarRef } from "../engine/timeline";
import { barName, sectionName, shownNumber } from "../pages/format";
import { STYLES } from "../styles";
import { neighbourRow, scrollBehavior, tabStop, useBarPress, useFocusFollow } from "./barPress";

interface Props {
  chart: Chart;
  /** Semitones to print the chart in (key plus instrument). */
  shift: number;
  /** Pitch class of the printed key, for spelling. */
  keyPc: number;
  active: BarRef | null;
  /** The beat sounding in the active bar (from 0), to mark which of its chords is playing; null when not playing. */
  activeBeat?: number | null;
  /** The bar the band will start from when paused. */
  cued: BarRef | null;
  showScales: boolean;
  /** Keep the bars, numbers and beat marks but not the chord symbols (the layout stays the same). */
  hideChords?: boolean;
  loopSection: number | null;
  /** The bars of a looped run, when one is set. */
  loopRange: BarRef[];
  onBar: (ref: BarRef) => void;
  /** Loop from the bar last clicked to this one (Shift-click, or press and hold on touch). */
  onRange: (ref: BarRef) => void;
  onSection: (section: number) => void;
  /** Print each section's style under its letter: the tune plays in its own style, and its sections in more than one. */
  sectionStyles?: boolean;
}

function ChordSymbol({ symbol, next, showScale, keyPc, sounding }: { symbol: string; /** The chord after it, which can choose the scale. */ next: string | null; showScale: boolean; keyPc: number; sounding: boolean }) {
  const { root, quality, bass } = displayParts(symbol);
  const scale = showScale ? chordScale(parseChord(symbol), symbol.match(/^[A-G][#b]?/)![0], keyPc, next ? parseChord(next) : null) : null;
  return (
    <span className={sounding ? "chord sounding" : "chord"}>
      <span className="chord-name">
        <span className="chord-root">{root}</span>
        {quality && <span className="chord-quality">{quality}</span>}
        {bass && <span className="chord-bass">/{bass}</span>}
      </span>
      {scale && <span className="chord-scale">{scale.name}</span>}
    </span>
  );
}

export function ChordGrid({ chart, shift, keyPc, active, activeBeat = null, cued, showScales, hideChords = false, loopSection, loopRange, onBar, onRange, onSection, sectionStyles = false }: Props) {
  const press = useBarPress(onBar, onRange);
  const introBars = chart.intro?.bars.length ?? 0;
  const numbers = new Map(chartBars(chart).map((b) => [`${b.ref.part}${b.ref.section}.${b.ref.bar}`, b]));
  const activeEl = useRef<HTMLButtonElement | null>(null);

  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeEl.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, [active, cued]);

  // Focus follows the current bar after Left or Right moves it (those keys are handled once, on the page).
  const follow = useFocusFollow(grid, () => activeEl.current, `${active?.part}${active?.section}.${active?.bar}/${cued?.part}${cued?.section}.${cued?.bar}`);

  // Up and Down move focus by a row; the playhead stays where it is.
  const rowKeys = (e: React.KeyboardEvent) => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const from = (e.target as HTMLElement).closest<HTMLElement>(".bar");
    const rows = Array.from(grid.current?.querySelectorAll<HTMLElement>(".row") ?? []);
    const row = rows.findIndex((r) => r.contains(from));
    if (!from || row < 0) return;
    const bars = (r: HTMLElement) => Array.from(r.querySelectorAll<HTMLElement>(".bar"));
    const to = neighbourRow(rows.map((r) => bars(r).length), row, bars(rows[row]).indexOf(from), e.key === "ArrowDown" ? 1 : -1);
    e.preventDefault();
    if (to) bars(rows[to.row])[to.col]?.focus();
  };

  const sections: { part: BarRef["part"]; index: number; section: Section }[] = [
    ...(chart.intro ? [{ part: "intro" as const, index: 0, section: chart.intro }] : []),
    ...chart.form.map((section, index) => ({ part: "form" as const, index, section })),
    ...(chart.ending ?? []).map((section, index) => ({ part: "ending" as const, index, section })),
  ];

  // Each chord's next one in the chart's order (a repeat bar holds the chord before it), for its scale.
  const nextChord = new Map<string, string>();
  if (showScales) {
    let last: string | null = null;
    for (const { part, index, section } of sections)
      section.bars.forEach((text, bar) => {
        parseBar(text, chart.beatsPerBar).chords.forEach((c, k) => {
          if (last) nextChord.set(last, c.symbol);
          last = `${part}${index}.${bar}:${k}`;
        });
      });
  }

  // One Tab stop for all the bars (the current, cued or first bar), and one for the section letters.
  const allBars: BarRef[] = sections.flatMap(({ part, index, section }) => section.bars.map((_, bar) => ({ part, section: index, bar })));
  const stop = allBars[tabStop(allBars, active, cued, sameRef)];

  return (
    <div className={`grid${hideChords ? " chords-hidden" : ""}`} ref={grid} onKeyDown={rowKeys} {...follow}>
      {sections.map(({ part, index, section }) => {
        const rows: string[][] = [];
        for (let i = 0; i < section.bars.length; i += 4) rows.push(section.bars.slice(i, i + 4));
        const looping = part === "form" && loopSection === index;
        const name = part === "form" ? section.label : sectionName(section.label);
        const label = section.repeat && section.repeat > 1 ? `${name} ×${section.repeat}` : name;
        return (
          <section className={`section part-${part}${looping ? " looping" : ""}`} key={`${part}${index}`}>
            {rows.map((row, r) => (
              <div className="row" key={r}>
                <div className="gutter">
                  {r === 0 &&
                    (part === "form" ? (
                      <button
                        type="button"
                        className="section-label"
                        aria-pressed={looping}
                        aria-label={`${looping ? "Stop looping" : "Loop"} section ${section.label}`}
                        onClick={() => onSection(index)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span className="section-label static">{label}</span>
                    ))}
                  {r === 0 && section.play && <span className="section-role">{section.play === "head" ? "head" : "solos"}</span>}
                  {r === 0 && section.break && <span className="section-role">break</span>}
                  {r === 0 && sectionStyles && !section.break && <span className="section-role">{(STYLES[section.style ?? chart.style]?.name ?? "").toLowerCase()}</span>}
                </div>
                {row.map((text, i) => {
                  const bar = r * 4 + i;
                  const ref: BarRef = { part, section: index, bar };
                  const parsed = parseBar(text, chart.beatsPerBar);
                  const isActive = sameRef(active, ref);
                  const isCued = !isActive && sameRef(cued, ref);
                  const inRange = loopRange.some((r) => sameRef(r, ref));
                  const numbered = numbers.get(`${part}${index}.${bar}`)!;
                  const number = shownNumber(numbered, introBars);
                  // In a bar of two or more chords, the one sounding now (the last that starts at or before the beat).
                  let sounding = -1;
                  if (isActive && activeBeat !== null && parsed.chords.length > 1) parsed.chords.forEach((c, k) => c.beat <= activeBeat + 1e-6 && (sounding = k));
                  let chordIndex = -1;
                  return (
                    <button
                      type="button"
                      ref={isActive || isCued ? activeEl : undefined}
                      tabIndex={sameRef(stop, ref) ? 0 : -1}
                      aria-current={isActive || isCued ? "true" : undefined}
                      className={`bar${isActive ? " active" : ""}${isCued ? " cued" : ""}${inRange ? " in-range" : ""}${barTokens(text).length > 1 ? " split" : ""}${bar === section.bars.length - 1 ? " section-end" : ""}`}
                      key={bar}
                      {...press(ref)}
                      aria-label={`${barName(numbered, introBars)}${hideChords ? "" : `: ${parsed.repeat ? "same chord" : parsed.chords.map((c) => c.symbol).join(", ")}`}. Play from here.`}
                    >
                      {i === 0 && number !== null && <span className="bar-number">{number}</span>}
                      {parsed.repeat ? (
                        <svg className="simile" viewBox="0 0 24 24" aria-hidden="true">
                          <line x1="5" y1="20" x2="19" y2="4" />
                          <circle cx="7" cy="7" r="2" />
                          <circle cx="17" cy="17" r="2" />
                        </svg>
                      ) : (
                        // Chords in order, with a slash for each beat that holds the chord before it.
                        barTokens(text).map((token, k) => {
                          if (token === BEAT)
                            return (
                              <span key={k} className="beat-slash" aria-hidden="true">
                                /
                              </span>
                            );
                          const c = ++chordIndex;
                          const next = nextChord.get(`${part}${index}.${bar}:${c}`);
                          return (
                            <ChordSymbol
                              key={k}
                              symbol={transposeSymbol(token, shift, keyPc)}
                              next={next ? transposeSymbol(next, shift, keyPc) : null}
                              showScale={showScales}
                              keyPc={keyPc}
                              sounding={c === sounding}
                            />
                          );
                        })
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
