/**
 * Theme attribute handling. The palette itself lives in src/styles/tokens.css; this module only
 * decides which block is active by setting `data-theme` on <html>.
 *
 * Contract (STYLE.md section 15): the user preference is `light`, `dark` or `system`; the
 * resolved value (`light` or `dark`) is what lands on <html data-theme>.
 */

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

export const THEME_STORAGE_KEY = 'sem-studio:theme';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return isTheme(value) || value === 'system';
}

export function readStoredPreference(): ThemePreference | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    // Storage can be unavailable (privacy mode, sandboxed frame); fall through to the system setting.
    return null;
  }
}

export function systemTheme(): Theme {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function resolvePreference(preference: ThemePreference): Theme {
  return preference === 'system' ? systemTheme() : preference;
}

/** Stored preference first (resolved), then the operating-system preference, then light. */
export function resolveInitialTheme(): Theme {
  return resolvePreference(readStoredPreference() ?? 'system');
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}

export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  const value = root.dataset.theme;
  return isTheme(value) ? value : 'light';
}

export function persistTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not being able to remember the choice is not an error worth surfacing.
  }
}

/** light -> dark -> system -> light */
export function nextPreference(preference: ThemePreference): ThemePreference {
  if (preference === 'light') return 'dark';
  if (preference === 'dark') return 'system';
  return 'light';
}
