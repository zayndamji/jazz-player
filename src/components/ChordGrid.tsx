import { displayParts, parseBar, transposeSymbol } from "../chart/chords";
import type { Chart, Section } from "../chart/types";
import type { BarRef } from "../engine/timeline";

interface Props {
  chart: Chart;
  transpose: number;
  keyPc: number;
  active: BarRef | null;
}

function ChordSymbol({ symbol }: { symbol: string }) {
  const { root, quality, bass } = displayParts(symbol);
  return (
    <span className="chord">
      <span className="chord-root">{root}</span>
      {quality && <sup className="chord-quality">{quality}</sup>}
      {bass && <span className="chord-bass">/{bass}</span>}
    </span>
  );
}

function SectionRows({ section, part, index, props }: { section: Section; part: BarRef["part"]; index: number; props: Props }) {
  const { chart, transpose, keyPc, active } = props;
  const rows: string[][] = [];
  for (let i = 0; i < section.bars.length; i += 4) rows.push(section.bars.slice(i, i + 4));
  return (
    <div className={`section section-${part}`}>
      {rows.map((row, r) => (
        <div className="row" key={r}>
          <div className="section-label">{r === 0 ? <span className="label-box">{section.label}</span> : null}</div>
          <div className="bars">
            {row.map((text, i) => {
              const bar = r * 4 + i;
              const parsed = parseBar(text, chart.beatsPerBar);
              const isActive = active?.part === part && active.section === index && active.bar === bar;
              return (
                <div className={`bar${isActive ? " active" : ""}${parsed.chords.length > 1 ? " split" : ""}`} key={bar}>
                  {parsed.repeat ? (
                    <span className="repeat" aria-label="same chord">
                      %
                    </span>
                  ) : (
                    parsed.chords.map((slot) => (
                      <ChordSymbol key={slot.beat} symbol={transposeSymbol(slot.symbol, transpose, keyPc)} />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChordGrid(props: Props) {
  const { chart } = props;
  return (
    <div className="grid" role="table" aria-label={`${chart.title} chord chart`}>
      {chart.intro && <SectionRows section={chart.intro} part="intro" index={0} props={props} />}
      {chart.form.map((section, i) => (
        <SectionRows key={i} section={section} part="form" index={i} props={props} />
      ))}
      {chart.ending && <SectionRows section={chart.ending} part="ending" index={0} props={props} />}
    </div>
  );
}
