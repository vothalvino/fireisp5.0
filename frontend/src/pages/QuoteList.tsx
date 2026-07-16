// =============================================================================
// FireISP 5.0 — Quote Management
// =============================================================================
// Standalone page at /quotes. Lists sales quotes with:
//   • Status filter
//   • Paginated table (number, client, total, valid-until, status), each row
//     linking to /quotes/:id (QuoteDetail) — mirrors InvoiceList.
//   • "New Quote" opens GenerateQuoteModal — a clone of GenerateInvoiceModal
//     (client + contract/product/custom line items, submitted all at once to
//     POST /quotes/generate) — then navigates straight to QuoteDetail. This
//     is the real "create a quote like an invoice" flow; quote_number is
//     auto-assigned (migration 389's organization_quote_sequences), same as
//     invoice_number.
//   • Delete (soft-delete).
// Editing quote metadata, approving/rejecting, adding more line items, and
// converting to an invoice all live on QuoteDetail now — not here — mirroring
// how InvoiceList has no per-row Edit/actions beyond bulk-void; those live on
// InvoiceDetail.
// All mutations go through the typed `api` client + React Query.
// =============================================================================

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { GenerateQuoteModal, type GeneratedQuote } from '@/components/GenerateQuoteModal';
import {
  styles,
  modalStyles,
  fmtMoney,
  fmtDate,
  capitalize,
} from './crudStyles';
import { Pagination } from '@/components/Pagination';
import { useOrgCurrency } from '@/auth/useOrgCurrency';

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchQuotes(page: number, pageSize: number, statusFilter: string): Promise<QuotesResponse> {
  const query: Record<string, string | number> = { page, limit: pageSize };
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

async function deleteQuote(id: number): Promise<void> {
  const res = await api.DELETE('/quotes/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete quote');
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

type Confirmable = { type: 'delete'; id: number };

export function QuoteList() {
  const queryClient = useQueryClient();
  const orgCurrency = useOrgCurrency();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [confirm, setConfirm] = useState<Confirmable | null>(null);

  const quotesQ = useQuery({
    queryKey: ['quotes', page, pageSize, statusFilter],
    queryFn: () => fetchQuotes(page, pageSize, statusFilter),
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

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  function handleConfirm() {
    if (!confirm) return;
    deleteMutation.mutate(confirm.id);
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

      {deleteMutation.isError && (
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
                  {quotes.map(q => (
                    <tr key={q.id} style={styles.tr}>
                      <td style={styles.td}>#{q.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>
                        <Link to={`/quotes/${q.id}`} style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 600 }}>
                          {q.quote_number || `#${q.id}`}
                        </Link>
                      </td>
                      <td style={styles.td}>
                        <Link to={`/clients/${q.client_id}`} style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 500 }}>
                          {clientName(q.client_id)}
                        </Link>
                      </td>
                      <td style={styles.td}>{fmtMoney(q.total, q.currency ?? orgCurrency)}</td>
                      <td style={styles.td}>{fmtDate(q.valid_until)}</td>
                      <td style={styles.td}><StatusBadge status={q.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={{ ...styles.actionBtn, color: '#991b1b' }} onClick={() => setConfirm({ type: 'delete', id: q.id })} title="Delete this quote">🗑 Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={meta?.totalPages ?? 1}
              total={meta?.total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </>
        )}
      </div>

      {showNew && (
        <GenerateQuoteModal
          onClose={() => setShowNew(false)}
          onGenerated={(quote: GeneratedQuote) => {
            queryClient.invalidateQueries({ queryKey: ['quotes'] });
            navigate(`/quotes/${quote.id}`);
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          message="Delete this quote? It will be soft-deleted and removed from the list."
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
