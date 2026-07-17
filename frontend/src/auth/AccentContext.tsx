// =============================================================================
// FireISP 5.0 — Accent Colour Context
// =============================================================================
// The app ships two brand accents: the default FireISP orange and an emerald
// green. This context mirrors DarkModeContext — it persists the choice and
// stamps `data-accent` on <html>, where index.css swaps the --accent* tokens.
// Orange is the default (no data-accent match needed); green overrides apply
// under [data-accent="green"] (and [data-theme="dark"][data-accent="green"]).
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

export type AccentPreference = 'orange' | 'green';

interface AccentContextValue {
  accent: AccentPreference;
  setAccent: (a: AccentPreference) => void;
  toggleAccent: () => void;
}

const STORAGE_KEY = 'fireisp_accent';

const AccentContext = createContext<AccentContextValue | null>(null);

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<AccentPreference>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as AccentPreference | null;
      if (stored === 'orange' || stored === 'green') return stored;
    } catch {
      // localStorage unavailable (SSR / private browsing)
    }
    return 'orange';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
  }, [accent]);

  const setAccent = useCallback((a: AccentPreference) => {
    setAccentState(a);
    try {
      localStorage.setItem(STORAGE_KEY, a);
    } catch {
      // ignore
    }
  }, []);

  const toggleAccent = useCallback(() => {
    setAccent(accent === 'green' ? 'orange' : 'green');
  }, [accent, setAccent]);

  const value = useMemo(
    () => ({ accent, setAccent, toggleAccent }),
    [accent, setAccent, toggleAccent],
  );

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

export function useAccent(): AccentContextValue {
  const ctx = useContext(AccentContext);
  if (!ctx) throw new Error('useAccent must be used within AccentProvider');
  return ctx;
}
