import { useEffect, useRef } from "react";
import { SHORTCUTS, type Shortcut } from "../pages/shortcuts";

interface Props {
  open: boolean;
  onClose: () => void;
  singleKeys: boolean;
  onSingleKeys: (on: boolean) => void;
}

const GROUPS: Shortcut["group"][] = ["Playing", "Moving", "Settings"];

/** The list of keyboard shortcuts, in a modal dialog (opened with "?" or from More). */
export function ShortcutHelp({ open, onClose, singleKeys, onSingleKeys }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="shortcut-help" aria-labelledby="shortcut-help-title" onClose={onClose}
      onKeyDown={(e) => {
        // "?" opened it, so "?" closes it too (Escape closes any dialog).
        if (e.key === "?" && !(e.target as HTMLElement).closest("input")) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="shortcut-help-head">
        <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
        <button type="button" className="toggle" onClick={onClose}>
          Close
        </button>
      </div>
      {GROUPS.map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          <table>
            <tbody>
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <tr key={s.id} className={s.singleKey && !singleKeys ? "off" : undefined}>
                  <th scope="row">
                    {s.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && " or "}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </th>
                  <td>{s.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <label className="check">
        <input type="checkbox" checked={singleKeys} onChange={(e) => onSingleKeys(e.target.checked)} />
        Single-key shortcuts (letters, digits, - = [ and ])
      </label>
    </dialog>
  );
}
