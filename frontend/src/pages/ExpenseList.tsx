// =============================================================================
// FireISP 5.0 — Expense Management
// =============================================================================
// Standalone page at /expenses. Lists operational expenses with:
//   • Status filter
//   • Paginated table (date, category, amount, status)
//   • "New Expense" create modal, per-row Edit and Delete (soft-delete).
// All mutations go through the typed `api` client + React Query.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useOrgCurrency } from '@/auth/useOrgCurrency';
import {
  styles,
  modalStyles,
  RequiredMark,
  fmtMoney,
  fmtDate,
  capitalize,
} from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Expense {
  id: number;
  category: string;
  description: string | null;
  amount: string | number | null;
  currency: string | null;
  receipt_url: string | null;
  expense_date: string | null;
  notes: string | null;
  status: string;
}

interface ExpensesResponse {
  data: Expense[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface ExpenseBody {
  category: string;
  description?: string;
  amount: number;
  currency?: string;
  receipt_url?: string;
  expense_date?: string;
  notes?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const STATUSES = ['pending', 'approved', 'rejected'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];
const TODAY = new Date().toISOString().split('T')[0];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchExpenses(page: number, statusFilter: string): Promise<ExpensesResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/expenses', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load expenses');
  return res.data as unknown as ExpensesResponse;
}

async function createExpense(body: ExpenseBody): Promise<void> {
  const res = await api.POST('/expenses', { body: body as never });
  if (res.error) throw new Error('Failed to create expense');
}

async function updateExpense(id: number, body: Partial<ExpenseBody>): Promise<void> {
  const res = await api.PUT('/expenses/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (res.error) throw new Error('Failed to update expense');
}

async function deleteExpense(id: number): Promise<void> {
  const res = await api.DELETE('/expenses/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete expense');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending:  { bg: '#fef3c7', color: '#92400e' },
    approved: { bg: '#d1fae5', color: '#065f46' },
    rejected: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Expense form modal (create + edit)
// ---------------------------------------------------------------------------

interface ExpenseModalProps {
  expense: Expense | null;
  onClose: () => void;
  onSaved: () => void;
}

function ExpenseModal({ expense, onClose, onSaved }: ExpenseModalProps) {
  const isEdit = expense !== null;
  const [form, setForm] = useState({
    category: expense?.category ?? '',
    description: expense?.description ?? '',
    amount: expense?.amount != null ? String(expense.amount) : '',
    currency: expense?.currency ?? 'MXN',
    receipt_url: expense?.receipt_url ?? '',
    expense_date: expense?.expense_date ? expense.expense_date.split('T')[0] : TODAY,
    notes: expense?.notes ?? '',
    status: expense?.status ?? 'pending',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: ExpenseBody = {
        category: form.category.trim(),
        amount: Number(form.amount),
        currency: form.currency || undefined,
        status: form.status,
      };
      if (form.description) body.description = form.description;
      if (form.receipt_url) body.receipt_url = form.receipt_url;
      if (form.expense_date) body.expense_date = form.expense_date;
      if (form.notes) body.notes = form.notes;
      return isEdit ? updateExpense(expense.id, body) : createExpense(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save expense. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category.trim() || !form.amount) {
      setError('Category and amount are required.');
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
        aria-label={isEdit ? `Edit expense ${expense.id}` : 'New expense'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Expense #${expense.id}` : '💸 New Expense'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Category <RequiredMark />
            <input style={modalStyles.input} type="text" maxLength={100} value={form.category} onChange={e => setField('category', e.target.value)} placeholder="e.g. fuel, equipment, labor" required />
          </label>

          <label style={modalStyles.label}>
            Description
            <input style={modalStyles.input} type="text" maxLength={5000} value={form.description} onChange={e => setField('description', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Amount <RequiredMark />
            <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.amount} onChange={e => setField('amount', e.target.value)} required />
          </label>

          <label style={modalStyles.label}>
            Currency
            <input style={modalStyles.input} type="text" maxLength={3} value={form.currency} onChange={e => setField('currency', e.target.value.toUpperCase())} placeholder="e.g. MXN" />
          </label>

          <label style={modalStyles.label}>
            Receipt URL
            <input style={modalStyles.input} type="text" maxLength={500} value={form.receipt_url} onChange={e => setField('receipt_url', e.target.value)} placeholder="https://…" />
          </label>

          <label style={modalStyles.label}>
            Expense Date
            <input style={modalStyles.input} type="date" value={form.expense_date} onChange={e => setField('expense_date', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Notes
            <input style={modalStyles.input} type="text" maxLength={5000} value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Status
            <select style={modalStyles.select} value={form.status} onChange={e => setField('status', e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Expense'}
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
      <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()} role="alertdialog" aria-label="Confirm action">
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
// ExpenseList component
// ---------------------------------------------------------------------------

export function ExpenseList() {
  const queryClient = useQueryClient();
  const orgCurrency = useOrgCurrency();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const expensesQ = useQuery({
    queryKey: ['expenses', page, statusFilter],
    queryFn: () => fetchExpenses(page, statusFilter),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteExpense(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const expenses = expensesQ.data?.data ?? [];
  const meta = expensesQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>💸 Expenses</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Expense
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select style={styles.filterSelect} value={statusFilter} onChange={e => handleFilterChange(e.target.value)}>
          {STATUS_FILTER_OPTIONS.map(s => <option key={s} value={s}>{s ? capitalize(s) : 'All'}</option>)}
        </select>
        {statusFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>Clear filter</button>
        )}
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>Action failed. Please try again.</p>
      )}

      <div style={styles.tableCard}>
        {expensesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : expensesQ.error ? (
          <p style={styles.msgError}>Failed to load expenses.</p>
        ) : expenses.length === 0 ? (
          <p style={styles.msg}>No expenses found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Date', 'Category', 'Amount', 'Status', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(x => (
                    <tr key={x.id} style={styles.tr}>
                      <td style={styles.td}>#{x.id}</td>
                      <td style={styles.td}>{fmtDate(x.expense_date)}</td>
                      <td style={{ ...styles.td, fontWeight: 500, textTransform: 'capitalize' }}>{x.category}</td>
                      <td style={styles.td}>{fmtMoney(x.amount, x.currency ?? orgCurrency)}</td>
                      <td style={styles.td}><StatusBadge status={x.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditExpense(x)} title="Edit this expense">✏️ Edit</button>
                        <button style={{ ...styles.actionBtn, color: '#991b1b' }} onClick={() => setDeleteId(x.id)} title="Delete this expense">🗑 Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
                <span style={styles.pageInfo}>Page {page} of {meta.totalPages}</span>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))} disabled={page === meta.totalPages}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>

      {showNew && (
        <ExpenseModal expense={null} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}

      {editExpense && (
        <ExpenseModal expense={editExpense} onClose={() => setEditExpense(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this expense? It will be soft-deleted and removed from the list."
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
