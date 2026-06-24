// =============================================================================
// FireISP 5.0 — Lead List (prospect pipeline) — §1.2
// =============================================================================
// CRUD for sales leads plus pipeline-stage summary and lead → client conversion.
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  submitBtn,
  cancelBtn,
} from '@/components/ClientFormModal';

interface Lead {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  status: string;
  estimated_value: number | null;
  assigned_to: number | null;
  converted_client_id: number | null;
  created_at: string;
}

interface LeadsResponse {
  data: Lead[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface LeadFormBody {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source: string;
  status: string;
  estimated_value?: number;
}

const SOURCES = ['website', 'referral', 'phone', 'walk_in', 'social', 'campaign', 'other'];
const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

async function fetchLeads(): Promise<LeadsResponse> {
  const res = await api.GET('/leads', { params: { query: { limit: 200 } as never } });
  if (res.error) throw new Error('Failed to load leads');
  return res.data as unknown as LeadsResponse;
}

async function fetchPipeline(): Promise<Record<string, number>> {
  const res = await api.GET('/leads/pipeline');
  if (res.error) throw new Error('Failed to load pipeline');
  return (res.data as unknown as { data: Record<string, number> }).data;
}

function LeadFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Lead;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<LeadFormBody>({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    company: initial?.company ?? '',
    source: initial?.source ?? 'other',
    status: initial?.status ?? 'new',
    estimated_value: initial?.estimated_value ?? undefined,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (body: LeadFormBody) => {
      if (mode === 'create') {
        const { error } = await api.POST('/leads', { body: body as never });
        if (error) throw new Error(extractApiError(error, 'Failed to create lead'));
      } else {
        const { error } = await api.PUT('/leads/{id}', {
          params: { path: { id: initial!.id } },
          body: body as never,
        });
        if (error) throw new Error(extractApiError(error, 'Failed to update lead'));
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save lead'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    const body: LeadFormBody = { name: form.name.trim(), source: form.source, status: form.status };
    if (form.email && form.email.trim()) body.email = form.email.trim();
    if (form.phone && form.phone.trim()) body.phone = form.phone.trim();
    if (form.company && form.company.trim()) body.company = form.company.trim();
    if (form.estimated_value !== undefined && !Number.isNaN(form.estimated_value)) body.estimated_value = Number(form.estimated_value);
    setError('');
    mutation.mutate(body);
  }

  const title = mode === 'create' ? 'New Lead' : `Edit ${initial?.name ?? 'Lead'}`;
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} type="text" value={form.name} autoFocus
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />

          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={form.email}
            onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />

          <label style={labelStyle}>Phone</label>
          <input style={inputStyle} type="text" value={form.phone}
            onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />

          <label style={labelStyle}>Company</label>
          <input style={inputStyle} type="text" value={form.company}
            onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />

          <label style={labelStyle}>Source</label>
          <select style={inputStyle} value={form.source}
            onChange={e => setForm(p => ({ ...p, source: e.target.value }))}>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <label style={labelStyle}>Pipeline stage</label>
          <select style={inputStyle} value={form.status}
            onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <label style={labelStyle}>Estimated value</label>
          <input style={inputStyle} type="number" min={0} step="0.01" value={form.estimated_value ?? ''}
            onChange={e => setForm(p => ({ ...p, estimated_value: e.target.value ? Number(e.target.value) : undefined }))} />

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

export function LeadList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);

  const canCreate = can(user?.role, 'leads.create');
  const canUpdate = can(user?.role, 'leads.update');
  const canConvert = can(user?.role, 'clients.create');

  const { data, isLoading, error } = useQuery({ queryKey: ['leads'], queryFn: fetchLeads });
  const { data: pipeline } = useQuery({ queryKey: ['leads', 'pipeline'], queryFn: fetchPipeline });

  const convertMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error: e } = await api.POST('/leads/{id}/convert', { params: { path: { id } }, body: {} as never });
      if (e) throw new Error(extractApiError(e, 'Failed to convert lead'));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leads'] });
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Leads</h2>
        {canCreate && (
          <button type="button" style={submitBtn} onClick={() => setShowCreate(true)}>+ New Lead</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
        Capture prospects and move them through the sales pipeline. Won leads can be converted into clients.
      </p>

      {pipeline && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
          {STAGES.map(stage => (
            <span key={stage} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: '0.8rem',
              background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}>
              {stage}: <strong>{pipeline[stage] ?? 0}</strong>
            </span>
          ))}
        </div>
      )}

      {isLoading && <p>Loading…</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>Name</th>
              <th style={{ padding: '8px' }}>Company</th>
              <th style={{ padding: '8px' }}>Source</th>
              <th style={{ padding: '8px' }}>Stage</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Est. value</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No leads yet.</td></tr>
            )}
            {data.data.map(l => (
              <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>{l.name}</td>
                <td style={{ padding: '8px' }}>{l.company ?? '—'}</td>
                <td style={{ padding: '8px', textTransform: 'capitalize' }}>{l.source.replace('_', ' ')}</td>
                <td style={{ padding: '8px', textTransform: 'capitalize' }}>{l.status}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{l.estimated_value ?? '—'}</td>
                <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canUpdate && (
                    <button type="button" style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                      onClick={() => setEditLead(l)}>Edit</button>
                  )}
                  {canConvert && !l.converted_client_id && (
                    <button type="button" style={{ ...submitBtn, padding: '4px 10px' }}
                      disabled={convertMutation.isPending}
                      onClick={() => convertMutation.mutate(l.id)}>Convert</button>
                  )}
                  {l.converted_client_id && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Client #{l.converted_client_id}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <LeadFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
      {editLead && (
        <LeadFormModal mode="edit" initial={editLead} onClose={() => setEditLead(null)} onSaved={refresh} />
      )}
    </div>
  );
}
