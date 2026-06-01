// =============================================================================
// FireISP 5.0 — VLAN Management
// =============================================================================
// Standalone page at /vlans. Lists IEEE 802.1Q VLANs with a status filter,
// paginated table, and "New VLAN" create modal plus per-row Edit and Delete
// (soft-delete). All mutations go through the typed `api` client + React Query,
// invalidating the ['vlans'] query so the list refreshes automatically.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Vlan {
  id: number;
  vlan_id: number;
  name: string;
  description: string | null;
  site_id: number | null;
  status: string;
}

interface VlansResponse {
  data: Vlan[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface SiteOption {
  id: number;
  name: string;
}

interface VlanBody {
  vlan_id: number;
  name: string;
  description?: string;
  site_id?: number;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const STATUSES = ['active', 'reserved', 'deprecated'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchVlans(page: number, statusFilter: string): Promise<VlansResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/vlans', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load VLANs');
  return res.data as unknown as VlansResponse;
}

async function fetchSiteOptions(): Promise<SiteOption[]> {
  const res = await api.GET('/sites', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load sites');
  return (res.data as unknown as { data: SiteOption[] }).data;
}

async function createVlan(body: VlanBody): Promise<void> {
  const res = await api.POST('/vlans', { body: body as never });
  if (res.error) throw new Error('Failed to create VLAN');
}

async function updateVlan(id: number, body: Partial<VlanBody>): Promise<void> {
  const res = await api.PUT('/vlans/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update VLAN');
}

async function deleteVlan(id: number): Promise<void> {
  const res = await api.DELETE('/vlans/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete VLAN');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    reserved: { bg: '#dbeafe', color: '#1e40af' },
    deprecated: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// VLAN form modal (create + edit)
// ---------------------------------------------------------------------------

interface VlanModalProps {
  vlan: Vlan | null;
  sites: SiteOption[];
  onClose: () => void;
  onSaved: () => void;
}

function VlanModal({ vlan, sites, onClose, onSaved }: VlanModalProps) {
  const isEdit = vlan !== null;
  const [form, setForm] = useState({
    vlan_id: vlan?.vlan_id != null ? String(vlan.vlan_id) : '',
    name: vlan?.name ?? '',
    description: vlan?.description ?? '',
    site_id: vlan?.site_id != null ? String(vlan.site_id) : '',
    status: vlan?.status ?? 'active',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: VlanBody = {
        vlan_id: Number(form.vlan_id),
        name: form.name.trim(),
        status: form.status,
      };
      if (form.site_id) body.site_id = Number(form.site_id);
      if (form.description) body.description = form.description;
      return isEdit ? updateVlan(vlan.id, body) : createVlan(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save VLAN. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(form.vlan_id);
    if (!form.vlan_id || Number.isNaN(id) || id < 1 || id > 4094) {
      setError('VLAN ID must be between 1 and 4094.');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!form.site_id) {
      setError('Site is required.');
      return;
    }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit VLAN ${vlan.name}` : 'New VLAN'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit VLAN #${vlan.id}` : '🔌 New VLAN'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            VLAN ID (1–4094) <RequiredMark />
            <input
              style={modalStyles.input}
              type="number"
              min={1}
              max={4094}
              value={form.vlan_id}
              onChange={e => setField('vlan_id', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={255}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder='e.g. "Client-Data", "Management", "VoIP"'
              required
            />
          </label>

          <label style={modalStyles.label}>
            Site <RequiredMark />
            <select
              style={modalStyles.select}
              value={form.site_id}
              onChange={e => setField('site_id', e.target.value)}
              required
            >
              <option value="">— Select a site —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Status
            <select
              style={modalStyles.select}
              value={form.status}
              onChange={e => setField('status', e.target.value)}
            >
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Description
            <textarea
              style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
              maxLength={5000}
              value={form.description}
              onChange={e => setField('description', e.target.value)}
            />
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create VLAN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-label="Confirm action"
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>No, go back</button>
          <button onClick={onConfirm} style={styles.btnDanger}>Yes, confirm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VlanList component
// ---------------------------------------------------------------------------

export function VlanList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editVlan, setEditVlan] = useState<Vlan | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const vlansQ = useQuery({
    queryKey: ['vlans', page, statusFilter],
    queryFn: () => fetchVlans(page, statusFilter),
  });

  const sitesQ = useQuery({
    queryKey: ['sites', 'options'],
    queryFn: fetchSiteOptions,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteVlan(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vlans'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['vlans'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const vlans = vlansQ.data?.data ?? [];
  const meta = vlansQ.data?.meta;
  const sites = sitesQ.data ?? [];
  const siteName = (id: number | null) =>
    id == null ? '—' : sites.find(s => s.id === id)?.name ?? `#${id}`;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🔌 VLANs</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New VLAN
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map(s => (
            <option key={s} value={s}>{s ? capitalize(s) : 'All'}</option>
          ))}
        </select>
        {statusFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
      )}

      <div style={styles.tableCard}>
        {vlansQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : vlansQ.error ? (
          <p style={styles.msgError}>Failed to load VLANs.</p>
        ) : vlans.length === 0 ? (
          <p style={styles.msg}>No VLANs found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'VLAN ID', 'Name', 'Site', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {vlans.map(v => (
                    <tr key={v.id} style={styles.tr}>
                      <td style={styles.td}>#{v.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{v.vlan_id}</td>
                      <td style={styles.td}>{v.name}</td>
                      <td style={styles.td}>{siteName(v.site_id)}</td>
                      <td style={styles.td}><StatusBadge status={v.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditVlan(v)} title="Edit this VLAN">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(v.id)}
                          title="Delete this VLAN"
                        >
                          🗑 Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {meta.totalPages}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showNew && (
        <VlanModal vlan={null} sites={sites} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editVlan && (
        <VlanModal vlan={editVlan} sites={sites} onClose={() => setEditVlan(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this VLAN? It will be soft-deleted and removed from the list."
          onConfirm={() => {
            deleteMutation.mutate(deleteId);
            setDeleteId(null);
          }}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
