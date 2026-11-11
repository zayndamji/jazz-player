import { useEffect, useRef } from "react";
import { BEAT, barTokens, displayParts, parseBar, parseChord, transposeSymbol } from "../chart/chords";
import { chordScale } from "../chart/scales";
import type { Chart, Section } from "../chart/types";
import { chartBars, sameRef, type BarRef } from "../engine/timeline";

interface Props {
  chart: Chart;
  /** Semitones to print the chart in (key plus instrument). */
  shift: number;
  /** Pitch class of the printed key, for spelling. */
  keyPc: number;
  active: BarRef | null;
  /** The bar the band will start from when paused. */
  cued: BarRef | null;
  showScales: boolean;
  loopSection: number | null;
  onBar: (ref: BarRef) => void;
  onSection: (section: number) => void;
}

function ChordSymbol({ symbol, showScale, keyPc }: { symbol: string; showScale: boolean; keyPc: number }) {
  const { root, quality, bass } = displayParts(symbol);
  const scale = showScale ? chordScale(parseChord(symbol), symbol.match(/^[A-G][#b]?/)![0], keyPc) : null;
  return (
    <span className="chord">
      <span className="chord-name">
        <span className="chord-root">{root}</span>
        {quality && <span className="chord-quality">{quality}</span>}
        {bass && <span className="chord-bass">/{bass}</span>}
      </span>
      {scale && <span className="chord-scale">{scale.name}</span>}
    </span>
  );
}

export function ChordGrid({ chart, shift, keyPc, active, cued, showScales, loopSection, onBar, onSection }: Props) {
  const numbers = new Map(chartBars(chart).map((b) => [`${b.ref.part}${b.ref.section}.${b.ref.bar}`, b.number]));
  const activeEl = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeEl.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, cued]);

  const sections: { part: BarRef["part"]; index: number; section: Section }[] = [
    ...(chart.intro ? [{ part: "intro" as const, index: 0, section: chart.intro }] : []),
    ...chart.form.map((section, index) => ({ part: "form" as const, index, section })),
    ...(chart.ending ?? []).map((section, index) => ({ part: "ending" as const, index, section })),
  ];

  return (
    <div className="grid">
      {sections.map(({ part, index, section }) => {
        const rows: string[][] = [];
        for (let i = 0; i < section.bars.length; i += 4) rows.push(section.bars.slice(i, i + 4));
        const looping = part === "form" && loopSection === index;
        const label = section.repeat && section.repeat > 1 ? `${section.label} ×${section.repeat}` : section.label;
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
                </div>
                {row.map((text, i) => {
                  const bar = r * 4 + i;
                  const ref: BarRef = { part, section: index, bar };
                  const parsed = parseBar(text, chart.beatsPerBar);
                  const isActive = sameRef(active, ref);
                  const isCued = !isActive && sameRef(cued, ref);
                  const number = numbers.get(`${part}${index}.${bar}`);
                  return (
                    <button
                      type="button"
                      ref={isActive || isCued ? activeEl : undefined}
                      aria-current={isActive || isCued ? "true" : undefined}
                      className={`bar${isActive ? " active" : ""}${isCued ? " cued" : ""}${barTokens(text).length > 1 ? " split" : ""}${bar === section.bars.length - 1 ? " section-end" : ""}`}
                      key={bar}
                      onClick={() => onBar(ref)}
                      aria-label={`Bar ${number}: ${parsed.repeat ? "same chord" : parsed.chords.map((c) => c.symbol).join(", ")}. Play from here.`}
                    >
                      {i === 0 && <span className="bar-number">{number}</span>}
                      {parsed.repeat ? (
                        <svg className="simile" viewBox="0 0 24 24" aria-hidden="true">
                          <line x1="5" y1="20" x2="19" y2="4" />
                          <circle cx="7" cy="7" r="2" />
                          <circle cx="17" cy="17" r="2" />
                        </svg>
                      ) : (
                        // Chords in order, with a slash for each beat that holds the chord before it.
                        barTokens(text).map((token, k) =>
                          token === BEAT ? (
                            <span key={k} className="beat-slash" aria-hidden="true">
                              /
                            </span>
                          ) : (
                            <ChordSymbol key={k} symbol={transposeSymbol(token, shift, keyPc)} showScale={showScales} keyPc={keyPc} />
                          ),
                        )
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
