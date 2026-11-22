import { useEffect, useRef, useState } from "react";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { loadHead } from "../charts/heads";
import { sectionName } from "../pages/format";
import { scrollBehavior, useBarPress, useFocusFollow } from "./barPress";

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
  /** Leave the chord symbols off the page (to play from memory). */
  hideChords?: boolean;
  /** The number printed for a bar of the file (from 1), as the chart counts it; null for none (the intro). */
  barNumber?: (bar: number) => number | null;
  /** A bar's name for screen readers, as the chart reads it ("Bar 3", "Intro bar 2"). */
  barName?: (bar: number) => string;
  /** Called with the printed bar number (from 1) when a bar is clicked. */
  onBar: (number: number) => void;
  /** Loop from the bar last clicked to this one (Shift-click, or press and hold on touch). */
  onRange: (number: number) => void;
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
const SVG_NS = "http://www.w3.org/2000/svg";

/** A chord symbol as OSMD writes it ("Bbm7(b5)/Ab"), split like the chart prints it: root, raised quality, bass. */
export function chordParts(text: string): { root: string; quality: string; bass: string } {
  const pretty = (s: string) => s.replace(/#/g, "♯").replace(/b/g, "♭");
  const m = /^([A-G](?:[b#♭♯])?)(.*?)(?:\/([A-G](?:[b#♭♯])?))?$/.exec(text.trim());
  if (!m) return { root: text, quality: "", bass: "" };
  const quality = m[2].replace(/#/g, "♯").replace(/(?<![a-z])b(?=\d)/g, "♭");
  return { root: pretty(m[1]), quality, bass: m[3] ? pretty(m[3]) : "" };
}

/** The chart's chord type sizes, from its root size (27 px root, 15 px quality raised 11 px, 19 px bass). */
const QUALITY = 15 / 27;
const RAISE = 11 / 27;
const BASS = 19 / 27;

/**
 * Restyle what OSMD drew so the lead sheet reads like the chord chart: chord symbols with a small raised
 * quality, rehearsal letters boxed and other section names (Intro, Ending) as plain text, the chart's bar
 * numbers (none in the intro, which `draw` numbers below zero).
 */
function restyle(svg: SVGElement) {
  svg.querySelectorAll<SVGTextElement>(".osmd-chord-symbol text").forEach((text) => {
    const { root, quality, bass } = chordParts(text.textContent ?? "");
    const size = parseFloat(text.getAttribute("font-size") ?? "") || 26;
    text.textContent = "";
    const add = (cls: string, content: string, fontSize: number, dy = 0) => {
      const span = document.createElementNS(SVG_NS, "tspan");
      span.setAttribute("class", cls);
      span.setAttribute("font-size", String(fontSize));
      if (dy) span.setAttribute("dy", String(dy));
      span.textContent = content;
      text.appendChild(span);
    };
    add("sheet-chord-root", root, size);
    if (quality) add("sheet-chord-quality", quality, size * QUALITY, -size * RAISE);
    if (bass) add("sheet-chord-bass", "/" + bass, size * BASS, quality ? size * RAISE : 0);
  });
  svg.querySelectorAll(".osmd-measure-number").forEach((g) => {
    if ((g.textContent ?? "").trim().startsWith("-")) g.remove();
  });
  svg.querySelectorAll(".vf-stavesection").forEach((g) => {
    const text = g.querySelector("text");
    if (!text) return;
    const label = sectionName(text.textContent ?? "");
    text.textContent = label;
    const rect = g.querySelector("rect");
    if (/^[A-Z]\d?$/.test(label)) {
      rect?.setAttribute("rx", "4");
      rect?.setAttribute("stroke-width", "1.5");
      text.setAttribute("class", "sheet-letter");
    } else {
      rect?.remove();
      text.setAttribute("class", "sheet-section-name");
    }
  });
}

/**
 * Renders the head from MusicXML with OpenSheetMusicDisplay, in the page's
 * own colours and font, with the same current-bar and loop marks as the chord chart.
 */
export function LeadSheet({ chartId, shift, bar, cue, loopBars, hideChords = false, barNumber, barName, onBar, onRange }: Props) {
  const press = useBarPress(onBar, onRange);
  const host = useRef<HTMLDivElement>(null);
  const osmd = useRef<OpenSheetMusicDisplay | null>(null);
  const mark = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const hide = useRef(hideChords);
  hide.current = hideChords;
  const numberOf = useRef(barNumber);
  numberOf.current = barNumber;

  const draw = () => {
    const o = osmd.current;
    if (!o || !host.current) return;
    o.EngravingRules.RenderChordSymbols = !hide.current;
    const ink = cssVar("--ink");
    const width = host.current.clientWidth;
    // Four bars per line as printed (the file's line breaks); on a phone OSMD fits
    // as many bars as there's room for, so chords and notes don't collide.
    o.setOptions({ defaultColorMusic: ink, defaultColorLabel: ink, defaultColorTitle: ink });
    o.EngravingRules.NewSystemAtXMLNewSystemAttribute = width >= NARROW;
    // One drawn bar per chart bar, so the highlight lines up (no multi-bar rests for an intro).
    o.EngravingRules.RenderMultipleRestMeasures = false;
    o.EngravingRules.ChordSymbolTextHeight = width >= NARROW ? 2.7 : 2.1;
    o.zoom = zoomFor(width);
    // Bars numbered as the chart counts them; the intro's get a number below zero, which restyle() removes.
    o.Sheet.SourceMeasures.forEach((m, i) => {
      const n = numberOf.current ? numberOf.current(i + 1) : i + 1;
      m.MeasureNumberXML = n ?? -(i + 1);
    });
    o.updateGraphic();
    o.render();
    const svg = host.current.querySelector("svg");
    if (svg) restyle(svg);
    const unit = 10 * o.zoom;
    setBoxes(
      o.GraphicSheet.MeasureList.map((staves) => {
        // OSMD can leave a measure without a laid-out staff; keep its slot so the bars stay numbered.
        if (!staves[0]) return { left: 0, top: 0, width: 0, height: 0 };
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
      rules.UseXMLMeasureNumbers = true;
      // The chart's small bar numbers (10 px at full size).
      rules.MeasureNumberLabelHeight = 1;
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

  // Chord symbols are drawn with the page, so showing or hiding them draws it again.
  useEffect(() => {
    if (ready && osmd.current) draw();
  }, [hideChords]);

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
    mark.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, [box?.top, cueBox?.top]);

  // One Tab stop for the bars: the current, cued or first. Focus follows it after the keyboard moves it.
  const stop = bar ?? cue ?? 1;
  const page = useRef<HTMLDivElement>(null);
  const follow = useFocusFollow(page, () => page.current?.querySelector<HTMLElement>(`[data-bar="${stop}"]`) ?? null, String(stop));

  const at = (b: Box) => ({ left: b.left, top: b.top, width: b.width, height: b.height });
  return (
    <div className="lead-sheet">
      {error && <p className="error">{error}</p>}
      {!ready && !error && <p className="loading">Loading lead sheet</p>}
      <div className="lead-sheet-page" ref={page} {...follow}>
        {loopBars.map((n) => boxes[n - 1] && <div key={n} className="sheet-loop" style={at(boxes[n - 1])} />)}
        {box && <div ref={mark} className="sheet-now" style={at(box)} />}
        {cueBox && <div ref={mark} className="sheet-cued" style={at(cueBox)} />}
        <div ref={host} className="sheet-music" />
        {boxes.map((b, i) => (
          <button type="button" key={i} className="sheet-bar" data-bar={i + 1} tabIndex={i + 1 === stop ? 0 : -1} style={at(b)} aria-label={`${barName ? barName(i + 1) : `Bar ${i + 1}`}. Play from here.`} {...press(i + 1)} />
        ))}
      </div>
    </div>
  );
}
