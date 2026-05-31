// =============================================================================
// FireISP 5.0 — NAS Management
// =============================================================================
// Standalone page at /nas. Lists RADIUS NAS / network access servers with a
// status filter, paginated table, and "New NAS" create modal plus per-row Edit
// and Delete (soft-delete). All mutations go through the typed `api` client +
// React Query, invalidating the ['nas'] query so the list refreshes
// automatically.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Nas {
  id: number;
  name: string;
  ip_address: string;
  ipv6_address: string | null;
  type: string | null;
  ports: number | null;
  description: string | null;
  status: string;
}

interface NasResponse {
  data: Nas[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface NasBody {
  name: string;
  ip_address: string;
  ipv6_address?: string;
  secret?: string;
  type?: string;
  ports?: number;
  description?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchNas(page: number, statusFilter: string): Promise<NasResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/nas', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load NAS devices');
  return res.data as unknown as NasResponse;
}

async function createNas(body: NasBody): Promise<void> {
  const res = await api.POST('/nas', { body: body as never });
  if (res.error) throw new Error('Failed to create NAS');
}

async function updateNas(id: number, body: Partial<NasBody>): Promise<void> {
  const res = await api.PUT('/nas/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update NAS');
}

async function deleteNas(id: number): Promise<void> {
  const res = await api.DELETE('/nas/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete NAS');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
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
// NAS form modal (create + edit)
// ---------------------------------------------------------------------------

interface NasModalProps {
  nas: Nas | null;
  onClose: () => void;
  onSaved: () => void;
}

function NasModal({ nas, onClose, onSaved }: NasModalProps) {
  const isEdit = nas !== null;
  const [form, setForm] = useState({
    name: nas?.name ?? '',
    ip_address: nas?.ip_address ?? '',
    ipv6_address: nas?.ipv6_address ?? '',
    secret: '',
    type: nas?.type ?? '',
    ports: nas?.ports != null ? String(nas.ports) : '',
    description: nas?.description ?? '',
    status: nas?.status ?? 'active',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: NasBody = {
        name: form.name.trim(),
        ip_address: form.ip_address.trim(),
        status: form.status,
      };
      if (form.ipv6_address) body.ipv6_address = form.ipv6_address.trim();
      if (form.secret) body.secret = form.secret;
      if (form.type) body.type = form.type.trim();
      if (form.ports) body.ports = Number(form.ports);
      if (form.description) body.description = form.description;
      return isEdit ? updateNas(nas.id, body) : createNas(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save NAS. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.ip_address.trim()) {
      setError('Name and IP address are required.');
      return;
    }
    if (!isEdit && !form.secret) {
      setError('RADIUS shared secret is required.');
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
        aria-label={isEdit ? `Edit NAS ${nas.name}` : 'New NAS'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit NAS #${nas.id}` : '🖧 New NAS'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={255}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            IP Address (IPv4) <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.ip_address}
              onChange={e => setField('ip_address', e.target.value)}
              placeholder="e.g. 10.0.0.1"
              required
            />
          </label>

          <label style={modalStyles.label}>
            IPv6 Address
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.ipv6_address}
              onChange={e => setField('ipv6_address', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            RADIUS Shared Secret {!isEdit && <RequiredMark />}
            <input
              style={modalStyles.input}
              type="password"
              maxLength={255}
              value={form.secret}
              onChange={e => setField('secret', e.target.value)}
              placeholder={isEdit ? 'Leave blank to keep current secret' : ''}
              autoComplete="new-password"
            />
          </label>

          <label style={modalStyles.label}>
            Type
            <input
              style={modalStyles.input}
              type="text"
              maxLength={50}
              value={form.type}
              onChange={e => setField('type', e.target.value)}
              placeholder="e.g. mikrotik, cisco, ubiquiti"
            />
          </label>

          <label style={modalStyles.label}>
            Ports
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              value={form.ports}
              onChange={e => setField('ports', e.target.value)}
            />
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

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create NAS'}
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
// NasList component
// ---------------------------------------------------------------------------

export function NasList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editNas, setEditNas] = useState<Nas | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const nasQ = useQuery({
    queryKey: ['nas', page, statusFilter],
    queryFn: () => fetchNas(page, statusFilter),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteNas(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nas'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['nas'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const devices = nasQ.data?.data ?? [];
  const meta = nasQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🖧 NAS Devices</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New NAS
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
        {nasQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : nasQ.error ? (
          <p style={styles.msgError}>Failed to load NAS devices.</p>
        ) : devices.length === 0 ? (
          <p style={styles.msg}>No NAS devices found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'IP Address', 'Type', 'Ports', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {devices.map(n => (
                    <tr key={n.id} style={styles.tr}>
                      <td style={styles.td}>#{n.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{n.name}</td>
                      <td style={styles.td}>{n.ip_address}</td>
                      <td style={styles.td}>{n.type ?? '—'}</td>
                      <td style={styles.td}>{n.ports ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={n.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditNas(n)} title="Edit this NAS">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(n.id)}
                          title="Delete this NAS"
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

      {showNew && <NasModal nas={null} onClose={() => setShowNew(false)} onSaved={invalidate} />}
      {editNas && <NasModal nas={editNas} onClose={() => setEditNas(null)} onSaved={invalidate} />}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this NAS? It will be soft-deleted and removed from the list."
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
