import { useRef, useState, type DragEvent, type FormEvent } from "react";
import type { Chart } from "../chart/types";
import { importSource } from "../import";
import { MXL_MESSAGE } from "../import/musicxml";
import { addImported } from "../charts/imported";

/** Loads a tune from a MusicXML file (chosen or dropped) or a pasted iReal Pro link. */
export function ImportPanel({ onDone, onCancel }: { onDone: (added: Chart[]) => void; onCancel: () => void }) {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const run = (text: string, name = "") => {
    try {
      const { charts } = importSource(text, name);
      onDone(addImported(charts));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    if (/\.mxl$/i.test(f.name)) return setError(MXL_MESSAGE);
    try {
      run(await f.text(), f.name);
    } catch {
      setError("That file could not be read.");
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (link.trim()) run(link);
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void readFile(e.dataTransfer.files[0]);
  };

  return (
    <section
      className={dragging ? "import dragging" : "import"}
      aria-label="Import a tune"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="import-row">
        <button type="button" autoFocus onClick={() => file.current?.click()}>
          Choose MusicXML file
        </button>
        <input ref={file} type="file" accept=".musicxml,.xml,text/xml,application/xml" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
      </div>
      <form className="import-row" onSubmit={submit}>
        <input type="text" placeholder="Paste an irealb:// link" aria-label="iReal Pro link" value={link} onChange={(e) => setLink(e.target.value)} />
        <button type="submit" disabled={!link.trim()}>
          Import
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
