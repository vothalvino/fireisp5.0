// =============================================================================
// FireISP 5.0 — SLA Definition Management
// =============================================================================
// Standalone page at /sla-definitions. Lists service-level agreements with a
// status filter, paginated table, and "New SLA" create modal plus per-row Edit
// and Delete (soft-delete). All mutations go through the typed `api` client +
// React Query, invalidating the ['sla-definitions'] query so the list refreshes.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlaDefinition {
  id: number;
  plan_id: number;
  name: string;
  uptime_pct: number | string;
  max_response_minutes: number | null;
  max_resolution_minutes: number | null;
  measurement_period: string;
  compensation_type: string;
  compensation_value: number | string | null;
  exclude_maintenance: number | boolean;
  priority: string;
  status: string;
}

interface SlaResponse {
  data: SlaDefinition[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface PlanOption {
  id: number;
  name: string;
}

interface SlaBody {
  plan_id: number;
  name: string;
  uptime_pct?: number;
  max_response_minutes?: number;
  max_resolution_minutes?: number;
  measurement_period?: string;
  compensation_type?: string;
  compensation_value?: number;
  exclude_maintenance?: boolean;
  priority?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const PERIODS = ['monthly', 'quarterly', 'annual'];
const COMPENSATION_TYPES = ['none', 'credit_percentage', 'credit_fixed', 'service_extension'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['active', 'inactive'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchSlas(page: number, statusFilter: string): Promise<SlaResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/sla-definitions', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load SLA definitions');
  return res.data as unknown as SlaResponse;
}

async function fetchPlanOptions(): Promise<PlanOption[]> {
  const res = await api.GET('/plans', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load plans');
  return (res.data as unknown as { data: PlanOption[] }).data;
}

async function createSla(body: SlaBody): Promise<void> {
  const res = await api.POST('/sla-definitions', { body: body as never });
  if (res.error) throw new Error('Failed to create SLA definition');
}

async function updateSla(id: number, body: Partial<SlaBody>): Promise<void> {
  const res = await api.PUT('/sla-definitions/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update SLA definition');
}

async function deleteSla(id: number): Promise<void> {
  const res = await api.DELETE('/sla-definitions/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete SLA definition');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#f3f4f6', color: '#374151' },
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
// SLA form modal (create + edit)
// ---------------------------------------------------------------------------

interface SlaModalProps {
  sla: SlaDefinition | null;
  plans: PlanOption[];
  onClose: () => void;
  onSaved: () => void;
}

function SlaModal({ sla, plans, onClose, onSaved }: SlaModalProps) {
  const isEdit = sla !== null;
  const [form, setForm] = useState({
    plan_id: sla?.plan_id != null ? String(sla.plan_id) : '',
    name: sla?.name ?? '',
    uptime_pct: sla?.uptime_pct != null ? String(sla.uptime_pct) : '99.00',
    max_response_minutes: sla?.max_response_minutes != null ? String(sla.max_response_minutes) : '',
    max_resolution_minutes: sla?.max_resolution_minutes != null ? String(sla.max_resolution_minutes) : '',
    measurement_period: sla?.measurement_period ?? 'monthly',
    compensation_type: sla?.compensation_type ?? 'none',
    compensation_value: sla?.compensation_value != null ? String(sla.compensation_value) : '',
    exclude_maintenance: sla ? Boolean(sla.exclude_maintenance) : true,
    priority: sla?.priority ?? 'medium',
    status: sla?.status ?? 'active',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: SlaBody = {
        plan_id: Number(form.plan_id),
        name: form.name.trim(),
        measurement_period: form.measurement_period,
        compensation_type: form.compensation_type,
        exclude_maintenance: form.exclude_maintenance,
        priority: form.priority,
        status: form.status,
      };
      if (form.uptime_pct) body.uptime_pct = Number(form.uptime_pct);
      if (form.max_response_minutes) body.max_response_minutes = Number(form.max_response_minutes);
      if (form.max_resolution_minutes) body.max_resolution_minutes = Number(form.max_resolution_minutes);
      if (form.compensation_value) body.compensation_value = Number(form.compensation_value);
      return isEdit ? updateSla(sla.id, body) : createSla(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save SLA definition. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!form.plan_id) {
      setError('Plan is required.');
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
        aria-label={isEdit ? `Edit SLA ${sla.name}` : 'New SLA'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit SLA #${sla.id}` : '📐 New SLA'}</h2>
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
              placeholder='e.g. "Gold SLA", "Enterprise 99.99%"'
              required
            />
          </label>

          <label style={modalStyles.label}>
            Plan <RequiredMark />
            <select
              style={modalStyles.select}
              value={form.plan_id}
              onChange={e => setField('plan_id', e.target.value)}
              required
            >
              <option value="">— Select a plan —</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Guaranteed uptime (%)
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.uptime_pct}
              onChange={e => setField('uptime_pct', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Max response (minutes)
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              value={form.max_response_minutes}
              onChange={e => setField('max_response_minutes', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Max resolution (minutes)
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              value={form.max_resolution_minutes}
              onChange={e => setField('max_resolution_minutes', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Measurement period
            <select
              style={modalStyles.select}
              value={form.measurement_period}
              onChange={e => setField('measurement_period', e.target.value)}
            >
              {PERIODS.map(p => <option key={p} value={p}>{capitalize(p)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Compensation type
            <select
              style={modalStyles.select}
              value={form.compensation_type}
              onChange={e => setField('compensation_type', e.target.value)}
            >
              {COMPENSATION_TYPES.map(c => (
                <option key={c} value={c}>{capitalize(c.replace(/_/g, ' '))}</option>
              ))}
            </select>
          </label>

          <label style={modalStyles.label}>
            Compensation value
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              step="0.01"
              value={form.compensation_value}
              onChange={e => setField('compensation_value', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Priority
            <select
              style={modalStyles.select}
              value={form.priority}
              onChange={e => setField('priority', e.target.value)}
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{capitalize(p)}</option>)}
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

          <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.exclude_maintenance}
              onChange={e => setField('exclude_maintenance', e.target.checked)}
            />
            Exclude planned maintenance from uptime
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create SLA'}
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
// SlaDefinitionList component
// ---------------------------------------------------------------------------

export function SlaDefinitionList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editSla, setEditSla] = useState<SlaDefinition | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const slasQ = useQuery({
    queryKey: ['sla-definitions', page, statusFilter],
    queryFn: () => fetchSlas(page, statusFilter),
  });

  const plansQ = useQuery({
    queryKey: ['plans', 'options'],
    queryFn: fetchPlanOptions,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSla(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sla-definitions'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['sla-definitions'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const slas = slasQ.data?.data ?? [];
  const meta = slasQ.data?.meta;
  const plans = plansQ.data ?? [];
  const planName = (id: number) => plans.find(p => p.id === id)?.name ?? `#${id}`;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📐 SLA Definitions</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New SLA
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
        {slasQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : slasQ.error ? (
          <p style={styles.msgError}>Failed to load SLA definitions.</p>
        ) : slas.length === 0 ? (
          <p style={styles.msg}>No SLA definitions found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Plan', 'Uptime %', 'Priority', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {slas.map(s => (
                    <tr key={s.id} style={styles.tr}>
                      <td style={styles.td}>#{s.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{s.name}</td>
                      <td style={styles.td}>{planName(s.plan_id)}</td>
                      <td style={styles.td}>{s.uptime_pct}%</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{s.priority}</td>
                      <td style={styles.td}><StatusBadge status={s.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditSla(s)} title="Edit this SLA">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(s.id)}
                          title="Delete this SLA"
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
        <SlaModal sla={null} plans={plans} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editSla && (
        <SlaModal sla={editSla} plans={plans} onClose={() => setEditSla(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this SLA definition? It will be soft-deleted and removed from the list."
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
