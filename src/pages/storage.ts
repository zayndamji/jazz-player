/** A stored setting, falling back to its name from when the site was called Jazz Teacher. */
export const readStored = (key: string) => {
  try {
    return localStorage.getItem(key) ?? localStorage.getItem(key.replace("jazz-player.", "jazz-teacher."));
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
