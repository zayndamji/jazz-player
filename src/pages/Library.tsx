import { useMemo, useState } from "react";
import { keyPitchClass } from "../chart/chords";
import { CHARTS } from "../charts";
import { STYLES } from "../styles";
import { keyName } from "./format";

/** The list of tunes, searchable by title and filterable by style. */
export function Library() {
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CHARTS.filter((c) => (!style || c.style === style) && (!q || c.title.toLowerCase().includes(q)));
  }, [query, style]);
  const styles = [...new Set(CHARTS.map((c) => c.style))];

  return (
    <div className="app library">
      <header className="head">
        <h1>Jazz Teacher</h1>
        <p className="meta">
          <span>
            {CHARTS.length} {CHARTS.length === 1 ? "tune" : "tunes"}
          </span>
        </p>
      </header>
      <div className="filters">
        <input type="search" placeholder="Search tunes" aria-label="Search tunes" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={style} aria-label="Style" onChange={(e) => setStyle(e.target.value)}>
          <option value="">All styles</option>
          {styles.map((s) => (
            <option key={s} value={s}>
              {STYLES[s]?.name ?? s}
            </option>
          ))}
        </select>
      </div>
      <ul className="tunes">
        {shown.map((c) => (
          <li key={c.id}>
            <a href={`#/tune/${c.id}`}>
              <span className="tune-title">{c.title}</span>
              <span className="tune-meta">
                {STYLES[c.style]?.name ?? c.style} · {keyName(keyPitchClass(c.key))} · {c.tempo} BPM
              </span>
            </a>
          </li>
        ))}
        {shown.length === 0 && <li className="empty">No tunes match.</li>}
      </ul>
    </div>
  );
}
