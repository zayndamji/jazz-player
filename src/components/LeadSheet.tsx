import { useEffect, useRef, useState } from "react";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { loadHead } from "../charts/heads";

interface Props {
  chartId: string;
  /** Semitones to print the melody in. */
  shift: number;
  /** Printed bar to highlight, from 1, or null. */
  bar: number | null;
  /** Printed bar the band will start from when paused, or null. */
  cue: number | null;
  /** Printed bars of the section being looped. */
  loopBars: number[];
  /** Called with the printed bar number (from 1) when a bar is clicked. */
  onBar: (number: number) => void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const NARROW = 760; // matches the phone breakpoint in styles.css
const zoomFor = (width: number) => (width < NARROW ? Math.min(0.75, width / 500) : Math.min(1, width / 820));

/**
 * Renders the head from MusicXML with OpenSheetMusicDisplay, in the page's
 * own colours and font, with the same current-bar and loop marks as the chord chart.
 */
export function LeadSheet({ chartId, shift, bar, cue, loopBars, onBar }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const osmd = useRef<OpenSheetMusicDisplay | null>(null);
  const mark = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const draw = () => {
    const o = osmd.current;
    if (!o || !host.current) return;
    const ink = cssVar("--ink");
    const width = host.current.clientWidth;
    // Four bars per line as printed (the file's line breaks); on a phone OSMD fits
    // as many bars as there's room for, so chords and notes don't collide.
    o.setOptions({ defaultColorMusic: ink, defaultColorLabel: ink, defaultColorTitle: ink });
    o.EngravingRules.NewSystemAtXMLNewSystemAttribute = width >= NARROW;
    o.EngravingRules.ChordSymbolTextHeight = width >= NARROW ? 2.6 : 2.1;
    o.zoom = zoomFor(width);
    o.updateGraphic();
    o.render();
    const unit = 10 * o.zoom;
    setBoxes(
      o.GraphicSheet.MeasureList.map((staves) => {
        const p = staves[0].PositionAndShape.AbsolutePosition;
        const s = staves[0].PositionAndShape.Size;
        return { left: p.x * unit, top: (p.y - 6) * unit, width: s.width * unit, height: 12 * unit };
      }),
    );
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const xml = await loadHead(chartId);
      if (!xml || !host.current) return;
      const { OpenSheetMusicDisplay, TransposeCalculator, ChordSymbolEnum } = await import("opensheetmusicdisplay");
      if (cancelled || !host.current) return;
      const o = new OpenSheetMusicDisplay(host.current, {
        backend: "svg",
        autoResize: false,
        autoBeam: true,
        drawTitle: false,
        drawSubtitle: false,
        drawComposer: false,
        drawLyricist: false,
        drawPartNames: false,
        drawMeasureNumbers: true,
        drawingParameters: "compact",
        newSystemFromXML: true,
        defaultFontFamily: FONT,
      });
      // Chord names and sizes to match the chord chart.
      const rules = o.EngravingRules;
      rules.ChordSymbolLabelTexts.setValue(ChordSymbolEnum.majorseventh, "Δ7");
      rules.ChordSymbolLabelTexts.setValue(ChordSymbolEnum.augmentedseventh, "7(♯5)");
      rules.ChordSymbolLabelTexts.setValue(ChordSymbolEnum.majorsixth, "6");
      // Widen bars to fit their chord names, so long ones (Ab7(#5)/Gb) don't run together.
      rules.ChordSymbolXSpacing = 3;
      rules.ChordOverlapAllowedIntoNextMeasure = 0;
      rules.RenderMeasureNumbersOnlyAtSystemStart = true;
      rules.PageLeftMargin = 0.5;
      rules.PageRightMargin = 0.5;
      o.TransposeCalculator = new TransposeCalculator();
      try {
        await o.load(xml);
      } catch (e) {
        setError("Couldn't read the lead sheet file.");
        console.error(e);
        return;
      }
      osmd.current = o;
      if (import.meta.env.DEV) (window as unknown as { __osmd: unknown }).__osmd = o;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      osmd.current?.clear();
      osmd.current = null;
    };
  }, [chartId]);

  useEffect(() => {
    const o = osmd.current;
    if (!ready || !o) return;
    o.Sheet.Transpose = shift;
    o.updateGraphic();
    draw();
  }, [ready, shift]);

  // Redraw when the width changes.
  useEffect(() => {
    if (!ready || !host.current) return;
    let width = host.current.clientWidth;
    const observer = new ResizeObserver(() => {
      const w = host.current?.clientWidth ?? 0;
      if (Math.abs(w - width) < 8) return;
      width = w;
      draw();
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [ready]);

  const box = bar !== null ? boxes[bar - 1] : undefined;
  const cueBox = bar === null && cue !== null ? boxes[cue - 1] : undefined;
  useEffect(() => {
    mark.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [box?.top, cueBox?.top]);

  const at = (b: Box) => ({ left: b.left, top: b.top, width: b.width, height: b.height });
  return (
    <div className="lead-sheet">
      {error && <p className="error">{error}</p>}
      <div className="lead-sheet-page">
        {loopBars.map((n) => boxes[n - 1] && <div key={n} className="sheet-loop" style={at(boxes[n - 1])} />)}
        {box && <div ref={mark} className="sheet-now" style={at(box)} />}
        {cueBox && <div ref={mark} className="sheet-cued" style={at(cueBox)} />}
        <div ref={host} className="sheet-music" />
        {boxes.map((b, i) => (
          <button type="button" key={i} className="sheet-bar" style={at(b)} aria-label={`Bar ${i + 1}. Play from here.`} onClick={() => onBar(i + 1)} />
        ))}
      </div>
    </div>
  );
}
