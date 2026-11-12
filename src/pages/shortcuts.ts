/**
 * The tune page's keyboard shortcuts, in one table that the key handler, the
 * help panel and the buttons' aria-keyshortcuts all read, so they can't disagree.
 */
export type ShortcutId =
  | "play"
  | "start"
  | "bar-back"
  | "bar-on"
  | "section-back"
  | "section-on"
  | "slower"
  | "faster"
  | "loop"
  | "unloop"
  | "loop-bars"
  | "click"
  | "mute"
  | "view"
  | "help";

export interface Shortcut {
  id: ShortcutId;
  /** Keys as shown in the help panel. */
  keys: string[];
  /** For aria-keyshortcuts. */
  aria: string;
  label: string;
  group: "Playing" | "Moving" | "Settings";
  /** A plain character key, which the "Single-key shortcuts" switch turns off (WCAG 2.1.4). */
  singleKey: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { id: "play", keys: ["Space"], aria: "Space", label: "Play, or pause and keep the place", group: "Playing", singleKey: false },
  { id: "start", keys: ["Home", "0"], aria: "Home", label: "Back to the start", group: "Playing", singleKey: false },
  { id: "slower", keys: ["-"], aria: "-", label: "Slower, 5 BPM", group: "Playing", singleKey: true },
  { id: "faster", keys: ["="], aria: "=", label: "Faster, 5 BPM", group: "Playing", singleKey: true },
  { id: "bar-back", keys: ["←"], aria: "ArrowLeft", label: "A bar back", group: "Moving", singleKey: false },
  { id: "bar-on", keys: ["→"], aria: "ArrowRight", label: "A bar on", group: "Moving", singleKey: false },
  { id: "section-back", keys: ["Shift ←"], aria: "Shift+ArrowLeft", label: "Start of this section, or the one before; when looping, loop the one before", group: "Moving", singleKey: false },
  { id: "section-on", keys: ["Shift →"], aria: "Shift+ArrowRight", label: "Next section; when looping, loop the next one", group: "Moving", singleKey: false },
  { id: "loop-bars", keys: ["Shift-click"], aria: "", label: "Loop from the bar you last clicked to this one (on touch, press and hold)", group: "Moving", singleKey: false },
  { id: "unloop", keys: ["Esc"], aria: "Escape", label: "Stop looping", group: "Moving", singleKey: false },
  { id: "loop", keys: ["L"], aria: "L", label: "Loop", group: "Settings", singleKey: true },
  { id: "click", keys: ["C"], aria: "C", label: "Metronome", group: "Settings", singleKey: true },
  { id: "mute", keys: ["M"], aria: "M", label: "Mute", group: "Settings", singleKey: true },
  { id: "view", keys: ["V"], aria: "V", label: "Chords or lead sheet", group: "Settings", singleKey: true },
  { id: "help", keys: ["?"], aria: "Shift+?", label: "This list", group: "Settings", singleKey: true },
];

export const shortcut = (id: ShortcutId) => SHORTCUTS.find((s) => s.id === id)!;

/** "Loop (L)": a button's tooltip with its key. */
export const withKey = (label: string, id: ShortcutId) => `${label} (${shortcut(id).keys.join(" or ")})`;

/** A letter key by the user's layout, or by its QWERTY position on non-Latin layouts. */
function letter(e: KeyboardEvent): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  return /^Key[A-Z]$/.test(e.code) ? e.code[3].toLowerCase() : "";
}

/** The shortcut a key press means, or null. Only plain keys and Shift are used. */
export function shortcutFor(e: KeyboardEvent, singleKeys: boolean): ShortcutId | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.defaultPrevented) return null;
  if (e.code === "Space") return e.shiftKey ? null : "play";
  if (e.code === "Home") return "start";
  if (e.code === "ArrowLeft") return e.shiftKey ? "section-back" : "bar-back";
  if (e.code === "ArrowRight") return e.shiftKey ? "section-on" : "bar-on";
  if (!singleKeys) return null;
  // Digits by position: on AZERTY the top row needs Shift for them.
  if (e.code === "Digit0" || e.code === "Numpad0") return "start";
  if (e.key === "?") return "help";
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") return "slower";
  if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") return "faster";
  if (e.shiftKey) return null;
  return ({ l: "loop", c: "click", m: "mute", v: "view" } as Record<string, ShortcutId>)[letter(e)] ?? null;
}

/**
 * The control that last got focus from a pointer (mouse or touch), so Space can
 * tell a clicked button from one reached with Tab. Browsers' :focus-visible
 * isn't reliable for this: after recent key presses Chrome reports it on a click too.
 */
let clicked: Element | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => (clicked = (e.target as HTMLElement).closest?.("button, a") ?? null), true);
  window.addEventListener("focusin", (e) => {
    if (e.target !== clicked) clicked = null;
  });
}

/**
 * Whether the page should leave a key press alone: typing in a field, using a
 * control that owns its keys, inside the More panel or the help dialog, or
 * Space on a button the user reached with the keyboard (it presses that button).
 * A button that only has focus because it was clicked doesn't keep Space.
 */
export function leaveAlone(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target?.closest) return false;
  if (target.closest('input, select, textarea, [contenteditable="true"], [role="slider"], [role="spinbutton"], .panel, dialog')) return true;
  const control = target.closest("button, a");
  if (e.code === "Space" && control && control !== clicked) return true;
  return false;
}
