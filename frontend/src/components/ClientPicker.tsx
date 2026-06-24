// =============================================================================
// FireISP 5.0 — Client typeahead picker
// =============================================================================
// Reusable, dependency-free typeahead for choosing a client by name instead of
// guessing a raw client_id. As the user types, it debounces (~250ms) and hits
// the server-side client search (GET /clients?search=<term>), showing matching
// {id, name, email} in a dropdown. Selecting an entry reports the id + name back
// to the parent and shows the chosen name with a "change" affordance.
//
// Styling reuses the shared inputStyle/labelStyle from ClientFormModal so the
// picker matches the surrounding form fields exactly.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { inputStyle, labelStyle } from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientOption {
  id: number;
  name: string;
  email: string | null;
}

interface ClientsSearchResponse {
  data: ClientOption[];
}

export interface ClientPickerProps {
  /** Currently selected client id (empty string when nothing is chosen). */
  value: number | '';
  /** Fired when a client is selected (or cleared with id 0 + empty name). */
  onChange: (id: number, name: string) => void;
  /** Name to display for the already-selected client (e.g. when editing). */
  initialName?: string;
  /** Whether the client is mandatory. Shows a "*" on the label. Default true. */
  required?: boolean;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async function searchClients(term: string): Promise<ClientOption[]> {
  // The clients list endpoint is typed loosely in the generated schema, so the
  // query is cast through `never` and the response is read via an unknown cast.
  const res = await api.GET('/clients', {
    params: { query: { search: term, limit: 20 } as never },
  });
  if (res.error) return [];
  return (res.data as unknown as ClientsSearchResponse).data ?? [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientPicker({ value, onChange, initialName, required = true }: ClientPickerProps) {
  const { t } = useTranslation();
  // The picker is "resolved" once a client is selected. Until then we show the
  // search input; afterwards we show the chosen name + a Change button.
  const [selectedName, setSelectedName] = useState(initialName ?? '');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ClientOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the displayed name in sync if the parent seeds a different initialName
  // (e.g. when the same modal instance is reused for a different row).
  useEffect(() => {
    setSelectedName(initialName ?? '');
  }, [initialName]);

  const isSelected = value !== '' && selectedName !== '';

  // Debounced search (~250ms) whenever the term changes and nothing is selected.
  useEffect(() => {
    if (isSelected) return;
    const q = term.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setOpen(true); // open immediately so the "Searching…" hint is visible
    let cancelled = false;
    const handle = setTimeout(async () => {
      const rows = await searchClients(q);
      if (cancelled) return; // a newer term superseded this run — drop stale results
      setResults(rows);
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [term, isSelected]);

  // Close the dropdown when clicking outside the picker.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function handleSelect(opt: ClientOption) {
    setSelectedName(opt.name);
    setTerm('');
    setResults([]);
    setOpen(false);
    onChange(opt.id, opt.name);
  }

  function handleClear() {
    setSelectedName('');
    setTerm('');
    setResults([]);
    setOpen(false);
    onChange(0, '');
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <label style={labelStyle}>{t('clientPicker.label')}{required ? ' *' : ''}</label>

      {isSelected ? (
        <div style={selectedRow}>
          <span style={selectedName_}>{selectedName}</span>
          <button type="button" style={changeBtn} onClick={handleClear}>
            {t('clientPicker.change')}
          </button>
        </div>
      ) : (
        <>
          <input
            style={inputStyle}
            type="text"
            value={term}
            placeholder={t('clientPicker.placeholder')}
            autoComplete="off"
            onChange={e => setTerm(e.target.value)}
            onFocus={() => { if (results.length) setOpen(true); }}
          />
          {open && (term.trim() || loading) && (
            <ul style={dropdown} role="listbox">
              {loading && <li style={hintItem}>{t('clientPicker.searching')}</li>}
              {!loading && results.length === 0 && (
                <li style={hintItem}>{t('clientPicker.noMatches')}</li>
              )}
              {!loading &&
                results.map(opt => (
                  <li key={opt.id}>
                    <button
                      type="button"
                      style={optionBtn}
                      role="option"
                      aria-selected={false}
                      onClick={() => handleSelect(opt)}
                    >
                      <span style={{ fontWeight: 600 }}>{opt.name}</span>
                      <span style={optionMeta}>
                        {opt.email || `#${opt.id}`}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles (local — the picker-specific bits not covered by ClientFormModal)
// ---------------------------------------------------------------------------

const selectedRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 10px',
  border: '1px solid var(--input-border)',
  borderRadius: 6,
  fontSize: '0.875rem',
  background: 'var(--surface-2, #f8fafc)',
};
const selectedName_: React.CSSProperties = {
  flex: 1,
  fontWeight: 600,
  color: 'var(--text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const changeBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--accent)',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.8rem',
  padding: 0,
  whiteSpace: 'nowrap',
};
const dropdown: React.CSSProperties = {
  position: 'absolute',
  zIndex: 10,
  left: 0,
  right: 0,
  margin: '2px 0 0',
  padding: 0,
  listStyle: 'none',
  background: 'var(--bg-card)',
  border: '1px solid var(--input-border)',
  borderRadius: 6,
  boxShadow: '0 6px 20px rgba(0,0,0,.15)',
  maxHeight: 240,
  overflowY: 'auto',
};
const optionBtn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 1,
  width: '100%',
  textAlign: 'left',
  padding: '7px 10px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: '0.85rem',
  color: 'var(--text-primary)',
};
const optionMeta: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-secondary)',
};
const hintItem: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: '0.82rem',
  color: 'var(--text-secondary)',
  fontStyle: 'italic',
};
