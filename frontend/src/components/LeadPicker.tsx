// =============================================================================
// FireISP 5.0 — Lead typeahead picker
// =============================================================================
// Reusable, dependency-free typeahead for choosing a lead by name instead of
// guessing a raw lead_id. Modeled closely on ClientPicker.tsx: debounces
// (~250ms) and hits the server-side lead search (GET /leads?search=<term>),
// showing matching {id, name, email} in a dropdown. Won/lost leads are
// excluded client-side (a won lead has already been converted to a client —
// see ClientPicker/the client select — and a lost lead is a dead end).
//
// Before the user types anything (on focus), browses the newest 100 leads
// (GET /leads?order_by=id&order=DESC) instead of showing nothing, so the
// picker is usable without knowing the lead's name.
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

interface LeadOption {
  id: number;
  name: string;
  email: string | null;
  status: string;
}

interface LeadsSearchResponse {
  data: LeadOption[];
}

export interface LeadPickerProps {
  /** Currently selected lead id (empty string when nothing is chosen). */
  value: number | '';
  /** Fired when a lead is selected (or cleared with id 0 + empty name). */
  onChange: (id: number, name: string) => void;
  /** Name to display for the already-selected lead (e.g. when editing). */
  initialName?: string;
  /** Whether the lead is mandatory. Shows a "*" on the label. Default false. */
  required?: boolean;
}

const EXCLUDED_STATUSES = ['won', 'lost'];

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async function searchLeads(term: string): Promise<LeadOption[]> {
  const query = term
    ? { search: term, limit: 20 }
    : { order_by: 'id', order: 'DESC', limit: 100 }; // browse state: newest first
  const res = await api.GET('/leads', { params: { query: query as never } });
  if (res.error) return [];
  const rows = (res.data as unknown as LeadsSearchResponse).data ?? [];
  return rows.filter(l => !EXCLUDED_STATUSES.includes(l.status));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LeadPicker({ value, onChange, initialName, required = false }: LeadPickerProps) {
  const { t } = useTranslation();
  const [selectedName, setSelectedName] = useState(initialName ?? '');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<LeadOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedName(initialName ?? '');
  }, [initialName]);

  const isSelected = value !== '' && selectedName !== '';

  useEffect(() => {
    if (isSelected || !focused) return;
    const q = term.trim();
    setLoading(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      const rows = await searchLeads(q);
      if (cancelled) return;
      setResults(rows);
      setLoading(false);
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [term, isSelected, focused]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function handleSelect(opt: LeadOption) {
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
      <label style={labelStyle}>{t('leadPicker.label', 'Lead')}{required ? ' *' : ''}</label>

      {isSelected ? (
        <div style={selectedRow}>
          <span style={selectedName_}>{selectedName}</span>
          <button type="button" style={changeBtn} onClick={handleClear}>
            {t('leadPicker.change', 'Change')}
          </button>
        </div>
      ) : (
        <>
          <input
            style={inputStyle}
            type="text"
            value={term}
            placeholder={t('leadPicker.placeholder', 'Search leads by name, email, phone, or company…')}
            autoComplete="off"
            onChange={e => setTerm(e.target.value)}
            onFocus={() => { setFocused(true); setOpen(true); }}
          />
          {open && (term.trim() || loading || results.length > 0) && (
            <ul style={dropdown} role="listbox">
              {loading && <li style={hintItem}>{t('leadPicker.searching', 'Searching…')}</li>}
              {!loading && results.length === 0 && (
                <li style={hintItem}>{t('leadPicker.noMatches', 'No matching leads.')}</li>
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
// Styles (local — identical values to ClientPicker's picker-specific bits)
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
