// =============================================================================
// FireISP 5.0 — Shared Client create/edit modal
// =============================================================================
// Used by ClientList (create + edit) and ClientDetail (edit). Talks to the
// typed API client (POST /clients, PUT /clients/:id) and reports success via
// onSaved so the caller can refresh its own queries.
// =============================================================================

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientFormBody {
  name: string;
  email?: string;
  phone?: string;
  client_type?: string;
  status?: string;
  tax_id?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  locale?: string;
}

/** Minimal shape needed to pre-fill the edit form (nullable to match API rows). */
export interface ClientFormInitial {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  client_type?: string | null;
  status?: string | null;
  tax_id?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  country?: string | null;
  locale?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function extractApiError(err: unknown, fallback: string): string {
  const e = err as { error?: { message?: string }; message?: string };
  return e?.error?.message || e?.message || fallback;
}

async function createClient(body: ClientFormBody): Promise<void> {
  const { error } = await api.POST('/clients', { body: body as never });
  if (error) throw new Error(extractApiError(error, 'Failed to create client'));
}

async function updateClient(id: number, body: ClientFormBody): Promise<void> {
  const { error } = await api.PUT('/clients/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to update client'));
}

const CLIENT_TYPES = ['residential', 'business', 'government', 'wholesale'];
const STATUSES = ['active', 'inactive', 'suspended'];
const LOCALES = ['global', 'MX'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ClientFormModalProps {
  mode: 'create' | 'edit';
  initial?: ClientFormInitial;
  onClose: () => void;
  onSaved: () => void;
}

export function ClientFormModal({ mode, initial, onClose, onSaved }: ClientFormModalProps) {
  const [form, setForm] = useState<ClientFormBody>({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    client_type: initial?.client_type ?? 'residential',
    status: initial?.status ?? 'active',
    tax_id: initial?.tax_id ?? '',
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    zip_code: initial?.zip_code ?? '',
    country: initial?.country ?? '',
    locale: initial?.locale ?? 'global',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (body: ClientFormBody) =>
      mode === 'create' ? createClient(body) : updateClient(initial!.id, body),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Failed to save client'),
  });

  function set<K extends keyof ClientFormBody>(key: K, value: ClientFormBody[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    // Drop empty optional strings so they are not sent as "" (which can fail
    // email/enum validation). Always send name and the select values.
    const body: ClientFormBody = { name: form.name.trim() };
    (
      ['email', 'phone', 'tax_id', 'address', 'city', 'state', 'zip_code', 'country'] as const
    ).forEach(k => {
      const v = (form[k] ?? '').trim();
      if (v) body[k] = v;
    });
    body.client_type = form.client_type;
    body.status = form.status;
    body.locale = form.locale;
    setError('');
    mutation.mutate(body);
  }

  const title = mode === 'create' ? 'New Client' : `Edit ${initial?.name ?? 'Client'}`;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Name *</label>
          <input
            style={inputStyle}
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            required
            autoFocus
          />

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} type="text" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
          </div>

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={form.client_type} onChange={e => set('client_type', e.target.value)}>
                {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div style={twoCol}>
            <div>
              <label style={labelStyle}>Tax ID</label>
              <input style={inputStyle} type="text" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Locale</label>
              <select style={inputStyle} value={form.locale} onChange={e => set('locale', e.target.value)}>
                {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <label style={labelStyle}>Address</label>
          <input style={inputStyle} type="text" value={form.address} onChange={e => set('address', e.target.value)} />

          <div style={threeCol}>
            <div>
              <label style={labelStyle}>City</label>
              <input style={inputStyle} type="text" value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <input style={inputStyle} type="text" value={form.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>ZIP</label>
              <input style={inputStyle} type="text" value={form.zip_code} onChange={e => set('zip_code', e.target.value)} />
            </div>
          </div>

          <label style={labelStyle}>Country (ISO-2)</label>
          <input
            style={inputStyle}
            type="text"
            maxLength={2}
            placeholder="MX"
            value={form.country}
            onChange={e => set('country', e.target.value.toUpperCase())}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared modal styles (exported for reuse by client-related modals)
// ---------------------------------------------------------------------------

export const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
export const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 420, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
export const errorBox: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b', padding: '8px 12px',
  borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
};
export const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem',
  color: 'var(--text-secondary)', marginBottom: 4, marginTop: 12,
};
export const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem',
};
export const twoCol: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
};
export const threeCol: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10,
};
export const submitBtn: React.CSSProperties = {
  background: '#e25822', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
export const cancelBtn: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
export const dangerBtn: React.CSSProperties = {
  background: '#dc2626', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
