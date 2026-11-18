// The design system's three themes, switched with data-theme on <html>.
// Remembered per browser: it's a convenience for whoever uses this
// machine, not something the server needs to know. Storage can be
// unavailable (private windows, blocked site data); then it's light.
export const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "high-contrast", label: "High contrast" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
const KEY = "nmbm-theme";

export function storedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    // Storage blocked.
  }
  return "light";
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: it still applies for this visit.
  }
}
