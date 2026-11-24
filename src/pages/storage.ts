const PREFIX = "jazz-stand.";
/** The site's earlier names, newest first: a setting not found under its name is read from these. */
const OLD_PREFIXES = ["bandstand.", "jazz-player.", "jazz-teacher."];

/** A stored setting, falling back to its name from when the site was called Bandstand, Jazz Player or Jazz Teacher. */
export const readStored = (key: string) => {
  try {
    const value = localStorage.getItem(key);
    if (value !== null || !key.startsWith(PREFIX)) return value;
    for (const prefix of OLD_PREFIXES) {
      const old = localStorage.getItem(prefix + key.slice(PREFIX.length));
      if (old !== null) return old;
    }
    return null;
  } catch {
    return null;
  }
};

export const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private windows); the setting still works for this visit.
  }
};

export const forget = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to remove when storage is unavailable.
  }
};
