import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  applyTheme,
  nextPreference,
  persistTheme,
  readStoredPreference,
  resolvePreference,
  systemTheme,
  type Theme,
  type ThemePreference,
} from '@/app/theme';

interface ThemeApi {
  preference: ThemePreference;
  resolved: Theme;
  setPreference: (preference: ThemePreference) => void;
  cyclePreference: () => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => readStoredPreference() ?? 'system',
  );
  const [system, setSystem] = useState<Theme>(() => systemTheme());
  const resolved = preference === 'system' ? system : resolvePreference(preference);

  // Follow the operating system while the preference is `system`.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    persistTheme(next);
    setPreferenceState(next);
  }, []);

  const cyclePreference = useCallback(() => {
    setPreference(nextPreference(preference));
  }, [preference, setPreference]);

  const api = useMemo(
    () => ({ preference, resolved, setPreference, cyclePreference }),
    [preference, resolved, setPreference, cyclePreference],
  );

  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return ctx;
}
