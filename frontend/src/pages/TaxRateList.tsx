// =============================================================================
// FireISP 5.0 — Tax Rate Management
// =============================================================================
// Standalone page at /tax-rates. Lists tax rates with a status filter, paginated
// table, and "New Tax Rate" create modal plus per-row Edit and Delete
// (soft-delete). All mutations go through the typed `api` client + React Query,
// invalidating the ['tax-rates'] query so the list refreshes.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaxRate {
  id: number;
  name: string;
  rate: number | string;
  description: string | null;
  is_default: number | boolean;
  status: string;
}

interface TaxRateResponse {
  data: TaxRate[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface TaxRateBody {
  name: string;
  rate: number;
  description?: string;
  is_default?: boolean;
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

async function fetchTaxRates(page: number, statusFilter: string): Promise<TaxRateResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/tax-rates', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load tax rates');
  return res.data as unknown as TaxRateResponse;
}

async function createTaxRate(body: TaxRateBody): Promise<void> {
  const res = await api.POST('/tax-rates', { body: body as never });
  if (res.error) throw new Error('Failed to create tax rate');
}

async function updateTaxRate(id: number, body: Partial<TaxRateBody>): Promise<void> {
  const res = await api.PUT('/tax-rates/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update tax rate');
}

async function deleteTaxRate(id: number): Promise<void> {
  const res = await api.DELETE('/tax-rates/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete tax rate');
}

// ---------------------------------------------------------------------------
// Badge
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

function formatRate(rate: number | string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Tax rate form modal (create + edit)
// ---------------------------------------------------------------------------

interface TaxRateModalProps {
  taxRate: TaxRate | null;
  onClose: () => void;
  onSaved: () => void;
}

function TaxRateModal({ taxRate, onClose, onSaved }: TaxRateModalProps) {
  const isEdit = taxRate !== null;
  const [form, setForm] = useState({
    name: taxRate?.name ?? '',
    rate: taxRate?.rate != null ? String(taxRate.rate) : '',
    description: taxRate?.description ?? '',
    is_default: taxRate ? Boolean(taxRate.is_default) : false,
    status: taxRate?.status ?? 'active',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: TaxRateBody = {
        name: form.name.trim(),
        rate: Number(form.rate),
        is_default: form.is_default,
        status: form.status,
      };
      if (form.description.trim()) body.description = form.description.trim();
      return isEdit ? updateTaxRate(taxRate.id, body) : createTaxRate(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save tax rate. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    const rate = Number(form.rate);
    if (form.rate === '' || Number.isNaN(rate) || rate < 0 || rate > 1) {
      setError('Rate must be a decimal between 0 and 1 (e.g. 0.16 for 16%).');
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
        aria-label={isEdit ? `Edit tax rate ${taxRate.name}` : 'New tax rate'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Tax Rate #${taxRate.id}` : '🧮 New Tax Rate'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={100}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder='e.g. "IVA 16%", "Exempt"'
              required
            />
          </label>

          <label style={modalStyles.label}>
            Rate (decimal, e.g. 0.16 = 16%) <RequiredMark />
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              max={1}
              step="0.0001"
              value={form.rate}
              onChange={e => setField('rate', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            Description
            <input
              style={modalStyles.input}
              type="text"
              maxLength={5000}
              value={form.description}
              onChange={e => setField('description', e.target.value)}
              placeholder="Optional explanation or legal reference"
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

          <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={e => setField('is_default', e.target.checked)}
            />
            Default rate (applied to new invoices/quotes when none is selected)
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Tax Rate'}
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
// TaxRateList component
// ---------------------------------------------------------------------------

export function TaxRateList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editTaxRate, setEditTaxRate] = useState<TaxRate | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const taxRatesQ = useQuery({
    queryKey: ['tax-rates', page, statusFilter],
    queryFn: () => fetchTaxRates(page, statusFilter),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTaxRate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tax-rates'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const taxRates = taxRatesQ.data?.data ?? [];
  const meta = taxRatesQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🧮 Tax Rates</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Tax Rate
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
        {taxRatesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : taxRatesQ.error ? (
          <p style={styles.msgError}>Failed to load tax rates.</p>
        ) : taxRates.length === 0 ? (
          <p style={styles.msg}>No tax rates found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Rate', 'Description', 'Default', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {taxRates.map(t => (
                    <tr key={t.id} style={styles.tr}>
                      <td style={styles.td}>#{t.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{t.name}</td>
                      <td style={styles.td}>{formatRate(t.rate)}</td>
                      <td style={{ ...styles.td, maxWidth: 320, overflowWrap: 'anywhere' }}>{t.description ?? '—'}</td>
                      <td style={styles.td}>{t.is_default ? '⭐' : '—'}</td>
                      <td style={styles.td}><StatusBadge status={t.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditTaxRate(t)} title="Edit this tax rate">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(t.id)}
                          title="Delete this tax rate"
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
        <TaxRateModal taxRate={null} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editTaxRate && (
        <TaxRateModal taxRate={editTaxRate} onClose={() => setEditTaxRate(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this tax rate? It will be soft-deleted and removed from the list."
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
