// =============================================================================
// FireISP 5.0 — Plan Management
// =============================================================================
// Standalone page at /plans. Lists service plans with:
//   • Status filter
//   • Paginated table (name, speeds, price, cycle, status)
//   • "New Plan" create modal, per-row Edit and Delete (soft-delete)
// All mutations go through the typed `api` client + React Query, invalidating
// the ['plans'] query so the list refreshes automatically.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  styles,
  modalStyles,
  RequiredMark,
  fmtMoney,
  capitalize,
} from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Plan {
  id: number;
  name: string;
  description: string | null;
  download_speed_mbps: number | null;
  upload_speed_mbps: number | null;
  price: string | number | null;
  currency: string | null;
  billing_cycle: string | null;
  data_cap_gb: string | number | null;
  status: string;
}

interface PlansResponse {
  data: Plan[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface PlanBody {
  name: string;
  description?: string;
  download_speed_mbps: number;
  upload_speed_mbps: number;
  price: number;
  currency?: string;
  billing_cycle?: string;
  data_cap_gb?: number;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const BILLING_CYCLES = ['monthly', 'quarterly', 'semi_annual', 'annual'];
const STATUSES = ['active', 'inactive', 'archived'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchPlans(page: number, statusFilter: string): Promise<PlansResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/plans', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load plans');
  return res.data as unknown as PlansResponse;
}

async function createPlan(body: PlanBody): Promise<void> {
  const res = await api.POST('/plans', { body: body as never });
  if (res.error) throw new Error('Failed to create plan');
}

async function updatePlan(id: number, body: Partial<PlanBody>): Promise<void> {
  const res = await api.PUT('/plans/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (res.error) throw new Error('Failed to update plan');
}

async function deletePlan(id: number): Promise<void> {
  const res = await api.DELETE('/plans/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete plan');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:   { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
    archived: { bg: '#f3f4f6', color: '#6b7280' },
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
// Plan form modal (create + edit)
// ---------------------------------------------------------------------------

interface PlanModalProps {
  plan: Plan | null;
  onClose: () => void;
  onSaved: () => void;
}

function PlanModal({ plan, onClose, onSaved }: PlanModalProps) {
  const isEdit = plan !== null;
  const [form, setForm] = useState({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    download_speed_mbps: plan?.download_speed_mbps != null ? String(plan.download_speed_mbps) : '',
    upload_speed_mbps: plan?.upload_speed_mbps != null ? String(plan.upload_speed_mbps) : '',
    price: plan?.price != null ? String(plan.price) : '',
    currency: plan?.currency ?? 'MXN',
    billing_cycle: plan?.billing_cycle ?? 'monthly',
    data_cap_gb: plan?.data_cap_gb != null ? String(plan.data_cap_gb) : '',
    status: plan?.status ?? 'active',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: PlanBody = {
        name: form.name.trim(),
        download_speed_mbps: Number(form.download_speed_mbps),
        upload_speed_mbps: Number(form.upload_speed_mbps),
        price: Number(form.price),
        currency: form.currency || undefined,
        billing_cycle: form.billing_cycle,
        status: form.status,
      };
      if (form.description) body.description = form.description;
      if (form.data_cap_gb) body.data_cap_gb = Number(form.data_cap_gb);
      return isEdit ? updatePlan(plan.id, body) : createPlan(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save plan. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.download_speed_mbps || !form.upload_speed_mbps || !form.price) {
      setError('Name, download/upload speed, and price are required.');
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
        aria-label={isEdit ? `Edit plan ${plan.name}` : 'New plan'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Plan #${plan.id}` : '📶 New Plan'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={200}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            Description
            <input
              style={modalStyles.input}
              type="text"
              maxLength={1000}
              value={form.description}
              onChange={e => setField('description', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Download Speed (Mbps) <RequiredMark />
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              value={form.download_speed_mbps}
              onChange={e => setField('download_speed_mbps', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            Upload Speed (Mbps) <RequiredMark />
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              value={form.upload_speed_mbps}
              onChange={e => setField('upload_speed_mbps', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            Price <RequiredMark />
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={e => setField('price', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            Currency
            <input
              style={modalStyles.input}
              type="text"
              maxLength={3}
              value={form.currency}
              onChange={e => setField('currency', e.target.value.toUpperCase())}
              placeholder="e.g. MXN"
            />
          </label>

          <label style={modalStyles.label}>
            Billing Cycle
            <select
              style={modalStyles.select}
              value={form.billing_cycle}
              onChange={e => setField('billing_cycle', e.target.value)}
            >
              {BILLING_CYCLES.map(c => (
                <option key={c} value={c}>{capitalize(c.replace('_', '-'))}</option>
              ))}
            </select>
          </label>

          <label style={modalStyles.label}>
            Data Cap (GB, leave blank for unlimited)
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              step="0.01"
              value={form.data_cap_gb}
              onChange={e => setField('data_cap_gb', e.target.value)}
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
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Plan'}
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
// PlanList component
// ---------------------------------------------------------------------------

export function PlanList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const plansQ = useQuery({
    queryKey: ['plans', page, statusFilter],
    queryFn: () => fetchPlans(page, statusFilter),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePlan(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['plans'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const plans = plansQ.data?.data ?? [];
  const meta = plansQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📶 Plans</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Plan
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
        {plansQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : plansQ.error ? (
          <p style={styles.msgError}>Failed to load plans.</p>
        ) : plans.length === 0 ? (
          <p style={styles.msg}>No plans found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Down/Up (Mbps)', 'Price', 'Cycle', 'Data Cap', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {plans.map(p => (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>#{p.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{p.name}</td>
                      <td style={styles.td}>{p.download_speed_mbps ?? '—'} / {p.upload_speed_mbps ?? '—'}</td>
                      <td style={styles.td}>{fmtMoney(p.price, p.currency ?? 'USD')}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>
                        {p.billing_cycle ? p.billing_cycle.replace('_', '-') : '—'}
                      </td>
                      <td style={styles.td}>{p.data_cap_gb != null ? `${p.data_cap_gb} GB` : 'Unlimited'}</td>
                      <td style={styles.td}><StatusBadge status={p.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditPlan(p)} title="Edit this plan">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(p.id)}
                          title="Delete this plan"
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
        <PlanModal plan={null} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}

      {editPlan && (
        <PlanModal plan={editPlan} onClose={() => setEditPlan(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this plan? It will be soft-deleted and removed from the list."
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
