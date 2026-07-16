// =============================================================================
// FireISP 5.0 — Command palette (Ctrl/Cmd+K) — "Faro" nav power layer
// =============================================================================
// Fuzzy jump-to-page over the nav registry, filtered to what the current
// role/locale can actually see (same canSee() as the sidebar). Empty query
// shows the most recent destinations. Div-overlay modal (the app's existing
// modal pattern — no native <dialog>).
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import { buildPaletteIndex, resolveRecents, searchPalette, type PaletteEntry } from '@/nav/search';

const RECENTS_KEY = 'fireisp.nav.recents';

function loadRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(path: string) {
  const next = [path, ...loadRecents().filter(p => p !== path)].slice(0, 8);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — recents just won't persist
  }
}

interface CommandPaletteProps {
  onClose: () => void;
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => (user ? buildPaletteIndex(user, t) : []), [user, t]);
  const results: PaletteEntry[] = useMemo(() => {
    const found = searchPalette(index, query);
    if (found.length > 0 || query.trim()) return found;
    return resolveRecents(index, loadRecents());
  }, [index, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  function go(entry: PaletteEntry) {
    pushRecent(entry.path);
    onClose();
    navigate(entry.path);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[cursor]) go(results[cursor]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="palette-overlay" onClick={onClose} role="presentation">
      <div
        className="palette-box"
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.palette.title')}
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('nav.palette.placeholder')}
          aria-label={t('nav.palette.title')}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
        />
        <ul className="palette-list" id="palette-results" role="listbox">
          {results.length === 0 && (
            <li className="palette-empty">{t('nav.palette.noResults')}</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.path}
              role="option"
              aria-selected={i === cursor}
              className={`palette-item${i === cursor ? ' selected' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(r)}
            >
              <span className="palette-label">{r.label}</span>
              <span className="palette-section">{r.sectionLabel}</span>
              <span className="palette-path">{r.path}</span>
            </li>
          ))}
        </ul>
        <div className="palette-foot">{t('nav.palette.hint')}</div>
      </div>
    </div>
  );
}
