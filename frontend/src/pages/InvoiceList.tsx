// =============================================================================
// FireISP 5.0 — Invoice List
// =============================================================================
// Standalone page at /invoices. Shows all invoices across all clients with:
//   • Filtering by status
//   • Paginated table with invoice number, client, total, due date, status
//   • "Generate Invoice" button opens the shared GenerateInvoiceModal
//   • Click a row to navigate to /invoices/:id for full detail
// =============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';
import { readCsrfCookie } from '@/api/csrf';
import { useTableSort, SortableTh } from '@/components/SortableTh';
import { GenerateInvoiceModal } from '@/components/GenerateInvoiceModal';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Invoice {
  id: number;
  client_id: number;
  contract_id: number | null;
  invoice_number: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  currency: string;
  due_date: string | null;
  paid_at: string | null;
  status: string;
  created_at: string;
}

interface InvoicesResponse {
  data: Invoice[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Client {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchInvoiceClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

async function fetchInvoices(
  page: number,
  pageSize: number,
  statusFilter: string,
  orderBy: string,
  order: string,
): Promise<InvoicesResponse> {
  const query: Record<string, string | number> = { page, limit: pageSize, order_by: orderBy, order };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/invoices', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load invoices');
  return res.data as unknown as InvoicesResponse;
}

// POST /bulk/invoices/void — single request for the entire selection.
// Attaches X-CSRF-Token (defense-in-depth: covers the fallback code path where
// the access token has expired and auth falls back to the httpOnly cookie without
// a Bearer header, which the CSRF guard would otherwise block with 403).
interface BulkVoidResult {
  data: {
    success: number;
    failed: number;
    errors: Array<{ invoice_id: number; error: string }>;
  };
}

async function bulkVoidInvoices(ids: number[]): Promise<BulkVoidResult> {
  const token = tokenStore.getAccess();
  const csrfToken = readCsrfCookie();
  const res = await fetch('/api/v1/bulk/invoices/void', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: JSON.stringify({ invoice_ids: ids }),
  });
  if (!res.ok) {
    let msg = 'Failed to void invoices';
    try {
      const j = (await res.json()) as { error?: { message?: string } | string };
      msg = (typeof j.error === 'string' ? j.error : j.error?.message) ?? msg;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<BulkVoidResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtAmount(amount: string | null | undefined, currency: string): string {
  if (!amount) return '—';
  const num = parseFloat(amount);
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(num);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft: { bg: '#f3f4f6', color: '#6b7280' },
    pending: { bg: '#ede9fe', color: '#5b21b6' },
    sent: { bg: '#dbeafe', color: '#1e40af' },
    paid: { bg: '#d1fae5', color: '#065f46' },
    overdue: { bg: '#fee2e2', color: '#991b1b' },
    cancelled: { bg: '#fef3c7', color: '#92400e' },
    void: { bg: '#f3f4f6', color: '#374151' },
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

// Generate Invoice Modal lives in @/components/GenerateInvoiceModal (shared with
// the client page).

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

// Must match the invoices.status DB enum: 'pending' is not a value (was a no-op filter).
const STATUS_OPTIONS = ['', 'draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled', 'void'];

// Only terminal statuses are excluded from voiding:
//   'void'      — already void; re-voiding is a no-op, not useful to surface.
//   'cancelled' — terminal; operationally non-voidable.
// 'paid' IS voidable: the backend (billingService.voidInvoiceById) releases
// payment allocations and zeroes the ledger debit, leaving each payment as an
// unallocated client credit. The earlier comment claiming "backend rejects paid
// voids with 422" was wrong — that guard was removed when paid-void support was added.
function isVoidable(status: string): boolean {
  return status !== 'void' && status !== 'cancelled';
}

export function InvoiceList() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const sort = useTableSort('created_at', 'DESC');
  const qc = useQueryClient();

  // Re-sorting from a deeper page would show a confusing slice — reset to page 1
  // (and clear cross-page selection) whenever the sort changes.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [sort.sortBy, sort.sortDir]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', page, pageSize, statusFilter, sort.sortBy, sort.sortDir],
    queryFn: () => fetchInvoices(page, pageSize, statusFilter, sort.order_by, sort.order),
    placeholderData: (prev) => prev,
  });

  // Load all clients for the name display (no backend changes — client-side lookup).
  const { data: clients = [] } = useQuery({
    queryKey: ['invoice-clients'],
    queryFn: fetchInvoiceClients,
    staleTime: 60_000,
  });

  const clientMap = new Map(clients.map((c: Client) => [c.id, c.name]));

  // Only voidable rows participate in selection / select-all.
  const voidableIds = (data?.data ?? []).filter((i) => isVoidable(i.status)).map((i) => i.id);
  const allVisibleSelected = voidableIds.length > 0 && voidableIds.every((id) => selected.has(id));

  function toggleOne(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAllVisible() {
    setSelected((s) => {
      const n = new Set(s);
      if (voidableIds.every((id) => n.has(id))) voidableIds.forEach((id) => n.delete(id));
      else voidableIds.forEach((id) => n.add(id));
      return n;
    });
  }

  // Single bulk request — one round-trip for N invoices.
  // Partial failures (e.g. an invoice deleted between select and confirm) are
  // surfaced via the errors[] array in the response without aborting the batch.
  const voidMut = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      const result = await bulkVoidInvoices(ids);
      const { failed, errors } = result.data;
      if (failed > 0) {
        const detail = errors.map((e) => `#${e.invoice_id}: ${e.error}`).join('; ');
        throw new Error(`${failed} invoice(s) could not be voided: ${detail}`);
      }
    },
    onSuccess: () => {
      setSelected(new Set());
      setConfirmVoid(false);
      setVoidError(null);
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e: Error) => {
      setVoidError(e.message);
      setConfirmVoid(false);
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  function handleFilterChange(newStatus: string) {
    setStatusFilter(newStatus);
    setPage(1);
    setSelected(new Set());
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>🧾 {t('invoiceList.title')}</h1>
        <button onClick={() => setShowGenerate(true)} style={submitBtn}>
          {t('invoiceList.generateInvoice')}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => handleFilterChange(s)}
            style={{
              padding: '4px 12px',
              borderRadius: 20,
              border: '1px solid #d1d5db',
              background: statusFilter === s ? 'var(--accent)' : '#fff',
              color: statusFilter === s ? '#fff' : '#374151',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: '0.75rem',
            padding: '8px 12px',
            background: 'var(--bg-subtle)',
            borderRadius: 6,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{selected.size} selected</span>
          <button
            style={{ ...submitBtn, background: '#b91c1c' }}
            disabled={voidMut.isPending}
            onClick={() => {
              setVoidError(null);
              setConfirmVoid(true);
            }}
          >
            Void selected
          </button>
          <button style={cancelBtn} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      {voidError && (
        <p style={{ color: '#b91c1c', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{voidError}</p>
      )}

      {/* Table */}
      {isLoading && <p style={{ color: '#888' }}>{t('invoiceList.loading')}</p>}
      {isError && <p style={{ color: 'var(--accent)' }}>{t('invoiceList.error')}</p>}
      {data && (
        <>
          <div
            style={{ background: '#fff', borderRadius: 8, boxShadow: '0 0 0 1px var(--border)', overflow: 'hidden' }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 14px', width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Select all invoices on this page"
                    />
                  </th>
                  <SortableTh label={t('invoiceList.table.invoiceNumber')} col="invoice_number" sort={sort} />
                  <SortableTh label={t('invoiceList.table.client')} col="client_id" sort={sort} />
                  <th
                    style={{
                      padding: '10px 8px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: '#374151',
                      whiteSpace: 'nowrap',
                      width: 40,
                      fontSize: '0.875rem',
                    }}
                  >
                    {t('invoiceList.table.clientId')}
                  </th>
                  <SortableTh label={t('invoiceList.table.total')} col="total" sort={sort} />
                  <SortableTh label={t('invoiceList.table.dueDate')} col="due_date" sort={sort} />
                  <SortableTh label={t('invoiceList.table.status')} col="status" sort={sort} />
                  <SortableTh label={t('invoiceList.table.created')} col="created_at" sort={sort} />
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                      {t('invoiceList.noInvoices')}
                    </td>
                  </tr>
                )}
                {data.data.map((inv, idx) => (
                  <tr
                    key={inv.id}
                    style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(inv.id)}
                        onChange={() => toggleOne(inv.id)}
                        disabled={!isVoidable(inv.status)}
                        title={!isVoidable(inv.status) ? `${inv.status} invoices cannot be voided` : undefined}
                        aria-label={`Select invoice ${inv.invoice_number || inv.id}`}
                      />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Link
                        to={`/invoices/${inv.id}`}
                        style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
                      >
                        {inv.invoice_number || `#${inv.id}`}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {inv.client_id ? (
                        <Link to={`/clients/${inv.client_id}`} style={{ color: '#374151', textDecoration: 'none' }}>
                          {clientMap.get(inv.client_id) ?? String(inv.client_id)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      style={{
                        padding: '10px 8px',
                        color: '#9ca3af',
                        fontSize: '0.8rem',
                        whiteSpace: 'nowrap',
                        width: 40,
                      }}
                    >
                      {inv.client_id ?? '—'}
                    </td>
                    <td style={{ padding: '10px 14px', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAmount(inv.total, inv.currency)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{fmt(inv.due_date)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <StatusBadge status={inv.status} />
                    </td>
                    <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: '0.8rem' }}>
                      {fmt(inv.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination
            page={page}
            totalPages={data?.meta?.totalPages ?? 1}
            total={data?.meta?.total}
            pageSize={pageSize}
            onPageChange={(p) => {
              setSelected(new Set());
              setPage(p);
            }}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
              setSelected(new Set());
            }}
          />
        </>
      )}

      {/* Generate Modal */}
      {showGenerate && (
        <GenerateInvoiceModal
          onClose={() => setShowGenerate(false)}
          onGenerated={() => qc.invalidateQueries({ queryKey: ['invoices'] })}
        />
      )}

      {confirmVoid && (
        <div style={overlay} role="dialog" aria-modal="true" aria-label="Confirm void invoices">
          <div style={modalBox}>
            <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>
              Void {selected.size} invoice{selected.size !== 1 ? 's' : ''}?
            </h2>
            <p style={{ fontSize: '0.9rem', color: '#374151' }}>
              The selected invoice{selected.size !== 1 ? 's' : ''} will be marked as void. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button
                type="button"
                style={cancelBtn}
                onClick={() => setConfirmVoid(false)}
                disabled={voidMut.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{ ...submitBtn, background: '#b91c1c' }}
                onClick={() => voidMut.mutate()}
                disabled={voidMut.isPending}
              >
                {voidMut.isPending ? 'Voiding…' : 'Void invoices'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};
const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)',
  borderRadius: 10,
  padding: '1.5rem',
  width: 420,
  maxWidth: '92vw',
  boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const submitBtn: React.CSSProperties = {
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  padding: '7px 18px',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.875rem',
};
const cancelBtn: React.CSSProperties = {
  background: 'var(--bg-card)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  padding: '7px 18px',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.875rem',
};
