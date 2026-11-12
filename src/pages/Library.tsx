import { useEffect, useMemo, useState } from "react";
import { isMinorKey, keyPitchClass } from "../chart/chords";
import { allCharts, isImported, removeImported } from "../charts/imported";
import { hasHead } from "../charts/heads";
import { STYLES } from "../styles";
import { keyLabel } from "./format";
import { ImportPanel } from "./ImportPanel";
import { countLabel, listTunes, readOpened, readView, saveView, type Sort } from "./tuneList";

/** The list of tunes, searchable by title, filterable by style, sorted A to Z or by when you opened them. */
export function Library({ missing }: { /** A tune id in the address that matches no tune. */ missing?: string }) {
  const [view, setView] = useState(readView);
  useEffect(() => saveView(view), [view]);
  const opened = useMemo(readOpened, []);
  const [importing, setImporting] = useState(false);
  /** Bumped when imported tunes change, so the list reads them again. */
  const [version, setVersion] = useState(0);
  const charts = useMemo(allCharts, [version]);
  const shown = useMemo(() => listTunes(charts, view, opened), [charts, view, opened]);
  const styles = [...new Set(charts.map((c) => c.style))];

  return (
    <div className="app library">
      <header className="head">
        <h1>Jazz Player</h1>
        <p className="meta">
          <span>{countLabel(shown.length, charts.length)}</span>
        </p>
      </header>
      {importing && (
        <ImportPanel
          onCancel={() => setImporting(false)}
          onDone={(added) => {
            setImporting(false);
            setVersion((v) => v + 1);
            if (added.length === 1) window.location.hash = `#/tune/${added[0].id}`;
          }}
        />
      )}
      {missing && <p className="not-found">No tune called {missing}.</p>}
      <div className="filters">
        <input type="search" placeholder="Search tunes" aria-label="Search tunes" value={view.query} onChange={(e) => setView({ ...view, query: e.target.value })} />
        <select value={view.style} aria-label="Style" onChange={(e) => setView({ ...view, style: e.target.value })}>
          <option value="">All styles</option>
          {styles.map((s) => (
            <option key={s} value={s}>
              {STYLES[s]?.name ?? s}
            </option>
          ))}
        </select>
        <select value={view.sort} aria-label="Sort" onChange={(e) => setView({ ...view, sort: e.target.value as Sort })}>
          <option value="az">A to Z</option>
          <option value="recent">Recently opened</option>
        </select>
        <button type="button" className="quiet import-button" aria-expanded={importing} onClick={() => setImporting(!importing)}>
          Import
        </button>
      </div>
      <ul className="tunes">
        {shown.map((c) => (
          <li key={c.id}>
            <a href={`#/tune/${c.id}`}>
              <span className="tune-title">{c.title}</span>
              <span className="tune-meta">
                {STYLES[c.style]?.name ?? c.style} · {keyLabel(keyPitchClass(c.key), isMinorKey(c.key))} · {c.tempo} BPM{hasHead(c.id) && " · Lead sheet"}
                {isImported(c) && " · Imported"}
              </span>
            </a>
            {isImported(c) && (
              <button
                type="button"
                className="quiet remove"
                aria-label={`Remove ${c.title}`}
                onClick={() => {
                  removeImported(c.id);
                  setVersion((v) => v + 1);
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="empty">No tunes match.</li>}
      </ul>
    </div>
  );
}
