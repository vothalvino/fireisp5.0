// =============================================================================
// FireISP 5.0 — Win-back Campaign Management — §1.2 Customer Lifecycle
// =============================================================================
// Full CRUD for win-back campaigns targeting cancelled customers. Each campaign
// defines:
//   • target_segment    — which cancelled cohort to reach (all / 30d / 90d / high value)
//   • offer_description  — the retention offer
//   • discount_percent   — optional discount sweetener
//   • start_date/end_date — campaign window
// A per-row "Targets" action previews the cancelled-customer cohort the
// campaign would reach (GET /winback-campaigns/{id}/targets).
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { styles } from './crudStyles';
import {
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  submitBtn,
  cancelBtn,
  dangerBtn,
} from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WinbackCampaign {
  id: number;
  name: string;
  status: string;
  target_segment: string | null;
  offer_description: string | null;
  discount_percent: number | null;
  message_template_id: number | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

interface WinbackResponse {
  data: WinbackCampaign[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

interface WinbackTarget {
  client_id: number;
  name: string;
  email: string | null;
  phone: string | null;
}

interface CampaignFormBody {
  name: string;
  status: string;
  target_segment: string;
  offer_description?: string;
  discount_percent?: number;
  start_date?: string;
  end_date?: string;
  notes?: string;
}

const DEFAULT_PAGE_SIZE = 50;
const STATUSES = ['draft', 'active', 'paused', 'completed'] as const;
const SEGMENTS = ['all_cancelled', 'cancelled_30d', 'cancelled_90d', 'high_value'] as const;

const SEGMENT_LABELS: Record<string, string> = {
  all_cancelled: 'All cancelled',
  cancelled_30d: 'Cancelled ≤ 30 days',
  cancelled_90d: 'Cancelled ≤ 90 days',
  high_value: 'High value',
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchCampaigns(page: number): Promise<WinbackResponse> {
  const res = await api.GET('/winback-campaigns', {
    params: { query: { page, limit: DEFAULT_PAGE_SIZE } as never },
  });
  if (res.error) throw new Error('Failed to load win-back campaigns');
  return res.data as unknown as WinbackResponse;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:     { bg: '#f3f4f6', color: '#374151' },
    active:    { bg: '#d1fae5', color: '#065f46' },
    paused:    { bg: '#fef3c7', color: '#92400e' },
    completed: { bg: '#dbeafe', color: '#1e40af' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form modal (create + edit)
// ---------------------------------------------------------------------------

function CampaignFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: WinbackCampaign;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CampaignFormBody>({
    name: initial?.name ?? '',
    status: initial?.status ?? 'draft',
    target_segment: initial?.target_segment ?? 'all_cancelled',
    offer_description: initial?.offer_description ?? undefined,
    discount_percent: initial?.discount_percent ?? undefined,
    start_date: initial?.start_date ?? undefined,
    end_date: initial?.end_date ?? undefined,
    notes: initial?.notes ?? undefined,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (body: CampaignFormBody) => {
      if (mode === 'create') {
        const { error } = await api.POST('/winback-campaigns', { body: body as never });
        if (error) throw new Error(extractApiError(error, 'Failed to create campaign'));
      } else {
        const { error } = await api.PUT('/winback-campaigns/{id}', {
          params: { path: { id: initial!.id } },
          body: body as never,
        });
        if (error) throw new Error(extractApiError(error, 'Failed to update campaign'));
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save campaign'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    const body: CampaignFormBody = {
      name: form.name.trim(),
      status: form.status,
      target_segment: form.target_segment,
    };
    if (form.offer_description && form.offer_description.trim()) body.offer_description = form.offer_description.trim();
    if (form.discount_percent !== undefined && !Number.isNaN(Number(form.discount_percent))) {
      body.discount_percent = Number(form.discount_percent);
    }
    if (form.start_date) body.start_date = form.start_date;
    if (form.end_date) body.end_date = form.end_date;
    if (form.notes && form.notes.trim()) body.notes = form.notes.trim();
    setError('');
    mutation.mutate(body);
  }

  const title = mode === 'create' ? 'New Win-back Campaign' : `Edit Campaign: ${initial?.name ?? ''}`;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Campaign name *</label>
          <input style={inputStyle} type="text" value={form.name} autoFocus required
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />

          <label style={labelStyle}>Status</label>
          <select style={inputStyle} value={form.status}
            onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <label style={labelStyle}>Target segment</label>
          <select style={inputStyle} value={form.target_segment}
            onChange={e => setForm(p => ({ ...p, target_segment: e.target.value }))}>
            {SEGMENTS.map(s => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}
          </select>

          <label style={labelStyle}>Offer description</label>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={form.offer_description ?? ''}
            onChange={e => setForm(p => ({ ...p, offer_description: e.target.value }))} />

          <label style={labelStyle}>Discount percent (optional)</label>
          <input style={inputStyle} type="number" min={0} max={100} value={form.discount_percent ?? ''}
            onChange={e => setForm(p => ({ ...p, discount_percent: e.target.value ? Number(e.target.value) : undefined }))} />

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Start date</label>
              <input style={inputStyle} type="date" value={form.start_date ?? ''}
                onChange={e => setForm(p => ({ ...p, start_date: e.target.value || undefined }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>End date</label>
              <input style={inputStyle} type="date" value={form.end_date ?? ''}
                onChange={e => setForm(p => ({ ...p, end_date: e.target.value || undefined }))} />
            </div>
          </div>

          <label style={labelStyle}>Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 48, resize: 'vertical' }} value={form.notes ?? ''}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />

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
// Delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteConfirm({ campaign, onClose, onDeleted }: { campaign: WinbackCampaign; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/winback-campaigns/{id}', { params: { path: { id: campaign.id } } });
      if (error) throw new Error(extractApiError(error, 'Failed to delete campaign'));
    },
    onSuccess: () => { onDeleted(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Delete failed'),
  });

  return (
    <div style={overlay} role="alertdialog" aria-modal="true">
      <div style={{ ...modalBox, width: 400 }}>
        <p style={{ margin: '0 0 1rem' }}>Delete campaign <strong>{campaign.name}</strong>? This cannot be undone.</p>
        {error && <div style={errorBox}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn} disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} style={dangerBtn} disabled={mutation.isPending}>
            {mutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Targets preview dialog
// ---------------------------------------------------------------------------

function TargetsModal({ campaign, onClose }: { campaign: WinbackCampaign; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['winback-targets', campaign.id],
    queryFn: async () => {
      const res = await api.GET('/winback-campaigns/{id}/targets', { params: { path: { id: campaign.id } } });
      if (res.error) throw new Error('Failed to load targets');
      return res.data as unknown as { data: WinbackTarget[]; meta: { count: number; segment: string } };
    },
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Campaign targets">
      <div style={{ ...modalBox, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Targets — {campaign.name}</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Cancelled-customer cohort matching segment
          {' '}<strong>{SEGMENT_LABELS[campaign.target_segment ?? ''] ?? campaign.target_segment ?? '—'}</strong>.
        </p>
        {isLoading && <p>Loading…</p>}
        {error && <div style={errorBox}>{(error as Error).message}</div>}
        {data && (
          <>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem' }}>{data.meta.count} matching client(s).</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
                  <th style={{ padding: '6px' }}>Client</th>
                  <th style={{ padding: '6px' }}>Name</th>
                  <th style={{ padding: '6px' }}>Email</th>
                  <th style={{ padding: '6px' }}>Phone</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>No matching clients.</td></tr>
                )}
                {data.data.map(t => (
                  <tr key={t.client_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px', fontFamily: 'monospace' }}>#{t.client_id}</td>
                    <td style={{ padding: '6px' }}>{t.name}</td>
                    <td style={{ padding: '6px' }}>{t.email ?? '—'}</td>
                    <td style={{ padding: '6px' }}>{t.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" onClick={onClose} style={cancelBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WinbackCampaignList component
// ---------------------------------------------------------------------------

export function WinbackCampaignList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editCampaign, setEditCampaign] = useState<WinbackCampaign | null>(null);
  const [deleteCampaign, setDeleteCampaign] = useState<WinbackCampaign | null>(null);
  const [targetsCampaign, setTargetsCampaign] = useState<WinbackCampaign | null>(null);

  const canCreate = can(user?.role, 'winback.create');
  const canUpdate = can(user?.role, 'winback.update');
  const canDelete = can(user?.role, 'winback.delete');

  const campaignsQ = useQuery({ queryKey: ['winback-campaigns', page], queryFn: () => fetchCampaigns(page) });
  const campaigns = campaignsQ.data?.data ?? [];
  const meta = campaignsQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const refresh = () => qc.invalidateQueries({ queryKey: ['winback-campaigns'] });

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🎁 Win-back Campaigns</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        {canCreate && (
          <button type="button" style={{ ...styles.btnPrimary, marginLeft: 'auto' }}
            onClick={() => setShowCreate(true)}>+ New Campaign</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
        Re-engage cancelled customers with targeted retention offers. Preview the
        cancelled-customer cohort each campaign reaches before activating it.
      </p>

      <div style={styles.tableCard}>
        {campaignsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : campaignsQ.error ? (
          <p style={styles.msgError}>Failed to load win-back campaigns.</p>
        ) : campaigns.length === 0 ? (
          <p style={styles.msg}>No win-back campaigns yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['ID', 'Name', 'Segment', 'Discount', 'Window', 'Status', 'Actions'].map(
                    h => <th key={h} style={styles.th}>{h}</th>,
                  )}
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}>#{c.id}</td>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{c.name}</td>
                    <td style={styles.td}>{SEGMENT_LABELS[c.target_segment ?? ''] ?? c.target_segment ?? '—'}</td>
                    <td style={styles.td}>{c.discount_percent != null ? `${c.discount_percent}%` : '—'}</td>
                    <td style={styles.td}>
                      {c.start_date || c.end_date
                        ? `${c.start_date ?? '…'} → ${c.end_date ?? '…'}`
                        : '—'}
                    </td>
                    <td style={styles.td}><StatusBadge status={c.status} /></td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                      <button type="button"
                        style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                        onClick={() => setTargetsCampaign(c)}>Targets</button>
                      {canUpdate && (
                        <button type="button"
                          style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                          onClick={() => setEditCampaign(c)}>Edit</button>
                      )}
                      {canDelete && (
                        <button type="button"
                          style={{ ...dangerBtn, padding: '4px 10px' }}
                          onClick={() => setDeleteCampaign(c)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '1rem' }}>
          <button type="button" style={cancelBtn} disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Page {page} of {totalPages}</span>
          <button type="button" style={cancelBtn} disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {showCreate && (
        <CampaignFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
      {editCampaign && (
        <CampaignFormModal mode="edit" initial={editCampaign} onClose={() => setEditCampaign(null)} onSaved={refresh} />
      )}
      {deleteCampaign && (
        <DeleteConfirm campaign={deleteCampaign} onClose={() => setDeleteCampaign(null)} onDeleted={refresh} />
      )}
      {targetsCampaign && (
        <TargetsModal campaign={targetsCampaign} onClose={() => setTargetsCampaign(null)} />
      )}
    </div>
  );
}
