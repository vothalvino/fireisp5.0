// =============================================================================
// FireISP 5.0 — Quote Management
// =============================================================================
// Standalone page at /quotes. Lists sales quotes with:
//   • Status filter
//   • Paginated table (number, client, total, valid-until, status)
//   • "New Quote" create modal, per-row Edit, Delete (soft-delete) and
//     Convert-to-Invoice for non-cancelled quotes.
// All mutations go through the typed `api` client + React Query.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
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

interface Quote {
  id: number;
  client_id: number;
  quote_number: string | null;
  valid_until: string | null;
  subtotal: string | number | null;
  tax_rate: string | number | null;
  tax_amount: string | number | null;
  total: string | number | null;
  currency: string | null;
  notes: string | null;
  status: string;
}

interface QuotesResponse {
  data: Quote[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Client {
  id: number;
  name: string;
}

interface QuoteBody {
  client_id: number;
  quote_number?: string;
  valid_until?: string;
  subtotal?: number;
  tax_rate?: number;
  tax_amount?: number;
  total?: number;
  notes?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchQuotes(page: number, statusFilter: string): Promise<QuotesResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/quotes', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load quotes');
  return res.data as unknown as QuotesResponse;
}

async function fetchClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

async function createQuote(body: QuoteBody): Promise<void> {
  const res = await api.POST('/quotes', { body: body as never });
  if (res.error) throw new Error('Failed to create quote');
}

async function updateQuote(id: number, body: Partial<QuoteBody>): Promise<void> {
  const res = await api.PUT('/quotes/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (res.error) throw new Error('Failed to update quote');
}

async function deleteQuote(id: number): Promise<void> {
  const res = await api.DELETE('/quotes/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete quote');
}

async function convertQuote(id: number): Promise<void> {
  const res = await api.POST('/quotes/{id}/convert-to-invoice', {
    params: { path: { id } },
    body: {} as never,
  });
  if (res.error) throw new Error('Failed to convert quote');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:    { bg: '#f3f4f6', color: '#374151' },
    sent:     { bg: '#dbeafe', color: '#1e40af' },
    accepted: { bg: '#d1fae5', color: '#065f46' },
    rejected: { bg: '#fee2e2', color: '#991b1b' },
    expired:  { bg: '#fef3c7', color: '#92400e' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Quote form modal (create + edit)
// ---------------------------------------------------------------------------

interface QuoteModalProps {
  quote: Quote | null;
  clients: Client[];
  onClose: () => void;
  onSaved: () => void;
}

function QuoteModal({ quote, clients, onClose, onSaved }: QuoteModalProps) {
  const isEdit = quote !== null;
  const [form, setForm] = useState({
    client_id: quote?.client_id != null ? String(quote.client_id) : '',
    quote_number: quote?.quote_number ?? '',
    valid_until: quote?.valid_until ? quote.valid_until.split('T')[0] : '',
    subtotal: quote?.subtotal != null ? String(quote.subtotal) : '',
    tax_rate: quote?.tax_rate != null ? String(quote.tax_rate) : '',
    tax_amount: quote?.tax_amount != null ? String(quote.tax_amount) : '',
    total: quote?.total != null ? String(quote.total) : '',
    notes: quote?.notes ?? '',
    status: quote?.status ?? 'draft',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: QuoteBody = {
        client_id: Number(form.client_id),
        status: form.status,
      };
      if (form.quote_number) body.quote_number = form.quote_number;
      if (form.valid_until) body.valid_until = form.valid_until;
      if (form.subtotal) body.subtotal = Number(form.subtotal);
      if (form.tax_rate) body.tax_rate = Number(form.tax_rate);
      if (form.tax_amount) body.tax_amount = Number(form.tax_amount);
      if (form.total) body.total = Number(form.total);
      if (form.notes) body.notes = form.notes;
      return isEdit ? updateQuote(quote.id, body) : createQuote(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save quote. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) {
      setError('Client is required.');
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
        aria-label={isEdit ? `Edit quote ${quote.quote_number ?? quote.id}` : 'New quote'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Quote #${quote.id}` : '🧮 New Quote'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Client <RequiredMark />
            <select
              style={modalStyles.select}
              value={form.client_id}
              onChange={e => setField('client_id', e.target.value)}
              required
              disabled={isEdit}
            >
              <option value="">— select client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Quote Number
            <input style={modalStyles.input} type="text" maxLength={50} value={form.quote_number} onChange={e => setField('quote_number', e.target.value)} placeholder="auto-generated if blank" />
          </label>

          <label style={modalStyles.label}>
            Valid Until
            <input style={modalStyles.input} type="date" value={form.valid_until} onChange={e => setField('valid_until', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Subtotal
            <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.subtotal} onChange={e => setField('subtotal', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Tax Rate (0–1, e.g. 0.16)
            <input style={modalStyles.input} type="number" min={0} max={1} step="0.0001" value={form.tax_rate} onChange={e => setField('tax_rate', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Tax Amount
            <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.tax_amount} onChange={e => setField('tax_amount', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Total
            <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.total} onChange={e => setField('total', e.target.value)} />
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
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Quote'}
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
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()} role="alertdialog" aria-label="Confirm action">
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>No, go back</button>
          <button onClick={onConfirm} style={styles.btnPrimary}>{confirmLabel ?? 'Yes, confirm'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuoteList component
// ---------------------------------------------------------------------------

type Confirmable =
  | { type: 'delete'; id: number }
  | { type: 'convert'; id: number };

export function QuoteList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editQuote, setEditQuote] = useState<Quote | null>(null);
  const [confirm, setConfirm] = useState<Confirmable | null>(null);

  const quotesQ = useQuery({
    queryKey: ['quotes', page, statusFilter],
    queryFn: () => fetchQuotes(page, statusFilter),
  });

  const clientsQ = useQuery({
    queryKey: ['clients-lookup'],
    queryFn: fetchClients,
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteQuote(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quotes'] }),
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) => convertQuote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['quotes'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  function handleConfirm() {
    if (!confirm) return;
    if (confirm.type === 'delete') deleteMutation.mutate(confirm.id);
    else convertMutation.mutate(confirm.id);
    setConfirm(null);
  }

  const quotes = quotesQ.data?.data ?? [];
  const meta = quotesQ.data?.meta;
  const clients = clientsQ.data ?? [];
  const clientName = (id: number) => clients.find(c => c.id === id)?.name ?? `#${id}`;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🧮 Quotes</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Quote
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

      {(deleteMutation.isError || convertMutation.isError) && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>Action failed. Please try again.</p>
      )}

      <div style={styles.tableCard}>
        {quotesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : quotesQ.error ? (
          <p style={styles.msgError}>Failed to load quotes.</p>
        ) : quotes.length === 0 ? (
          <p style={styles.msg}>No quotes found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Number', 'Client', 'Total', 'Valid Until', 'Status', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {quotes.map(q => {
                    const canConvert = q.status !== 'rejected' && q.status !== 'expired';
                    return (
                      <tr key={q.id} style={styles.tr}>
                        <td style={styles.td}>#{q.id}</td>
                        <td style={{ ...styles.td, fontWeight: 500 }}>{q.quote_number || '—'}</td>
                        <td style={styles.td}>
                          <Link to={`/clients/${q.client_id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 500 }}>
                            {clientName(q.client_id)}
                          </Link>
                        </td>
                        <td style={styles.td}>{fmtMoney(q.total, q.currency ?? 'USD')}</td>
                        <td style={styles.td}>{fmtDate(q.valid_until)}</td>
                        <td style={styles.td}><StatusBadge status={q.status} /></td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          <button style={styles.actionBtn} onClick={() => setEditQuote(q)} title="Edit this quote">✏️ Edit</button>
                          {canConvert && (
                            <button style={{ ...styles.actionBtn, color: '#065f46' }} onClick={() => setConfirm({ type: 'convert', id: q.id })} title="Convert to invoice">
                              ➜ Invoice
                            </button>
                          )}
                          <button style={{ ...styles.actionBtn, color: '#991b1b' }} onClick={() => setConfirm({ type: 'delete', id: q.id })} title="Delete this quote">🗑 Delete</button>
                        </td>
                      </tr>
                    );
                  })}
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
        <QuoteModal quote={null} clients={clients} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}

      {editQuote && (
        <QuoteModal quote={editQuote} clients={clients} onClose={() => setEditQuote(null)} onSaved={invalidate} />
      )}

      {confirm && (
        <ConfirmDialog
          message={
            confirm.type === 'delete'
              ? 'Delete this quote? It will be soft-deleted and removed from the list.'
              : 'Convert this quote to an invoice? The quote will be marked as accepted.'
          }
          confirmLabel={confirm.type === 'convert' ? 'Convert' : undefined}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
