// =============================================================================
// FireISP 5.0 — Dark Mode Context
// =============================================================================
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

interface DarkModeContextValue {
  theme: ThemePreference;
  effectiveTheme: 'light' | 'dark';
  setTheme: (t: ThemePreference) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'fireisp_theme';

const DarkModeContext = createContext<DarkModeContextValue | null>(null);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? getSystemTheme() : pref;
}

export function DarkModeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {
      // localStorage unavailable (SSR / private browsing)
    }
    return 'system';
  });

  const effectiveTheme = useMemo(() => resolveTheme(theme), [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
  }, [effectiveTheme]);

  // Re-compute when system preference changes (for 'system' mode)
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      document.documentElement.setAttribute('data-theme', getSystemTheme());
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((t: ThemePreference) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(effectiveTheme === 'dark' ? 'light' : 'dark');
  }, [effectiveTheme, setTheme]);

  const value = useMemo(
    () => ({ theme, effectiveTheme, setTheme, toggleTheme }),
    [theme, effectiveTheme, setTheme, toggleTheme],
  );

  return <DarkModeContext.Provider value={value}>{children}</DarkModeContext.Provider>;
}

export function useDarkMode(): DarkModeContextValue {
  const ctx = useContext(DarkModeContext);
  if (!ctx) throw new Error('useDarkMode must be used within DarkModeProvider');
  return ctx;
}
