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
import { useTableSort, SortableTh } from '@/components/SortableTh';
import { GenerateInvoiceModal } from '@/components/GenerateInvoiceModal';

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

const PAGE_SIZE = 25;

async function fetchInvoiceClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

async function fetchInvoices(page: number, statusFilter: string, orderBy: string, order: string): Promise<InvoicesResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE, order_by: orderBy, order };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/invoices', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load invoices');
  return res.data as unknown as InvoicesResponse;
}

// PATCH /invoices/:id isn't in the generated OpenAPI schema, so use raw fetch
// with the stored token (same pattern as ContractList.patchContractStatus).
async function voidInvoice(id: number): Promise<void> {
  const token = tokenStore.getAccess();
  const res = await fetch(`/api/v1/invoices/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ status: 'void' }),
  });
  if (!res.ok) {
    let msg = `Failed to void invoice #${id}`;
    try { const j = await res.json() as { error?: { message?: string } | string }; msg = (typeof j.error === 'string' ? j.error : j.error?.message) ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
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
    draft:     { bg: '#f3f4f6', color: '#6b7280' },
    pending:   { bg: '#ede9fe', color: '#5b21b6' },
    sent:      { bg: '#dbeafe', color: '#1e40af' },
    paid:      { bg: '#d1fae5', color: '#065f46' },
    overdue:   { bg: '#fee2e2', color: '#991b1b' },
    cancelled: { bg: '#fef3c7', color: '#92400e' },
    void:      { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

// Generate Invoice Modal lives in @/components/GenerateInvoiceModal (shared with
// the client page).

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = ['', 'draft', 'issued', 'pending', 'sent', 'paid', 'overdue', 'cancelled', 'void'];

// A paid invoice has been settled and an already-void one is a no-op, so neither
// can be voided (the backend rejects paid voids with 422).
function isVoidable(status: string): boolean {
  return status !== 'paid' && status !== 'void';
}

export function InvoiceList() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const sort = useTableSort('created_at', 'DESC');
  const qc = useQueryClient();

  // Re-sorting from a deeper page would show a confusing slice — reset to page 1
  // (and clear cross-page selection) whenever the sort changes.
  useEffect(() => { setPage(1); setSelected(new Set()); }, [sort.sortBy, sort.sortDir]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', page, statusFilter, sort.sortBy, sort.sortDir],
    queryFn: () => fetchInvoices(page, statusFilter, sort.order_by, sort.order),
    placeholderData: prev => prev,
  });

  // Load all clients for the name display (no backend changes — client-side lookup).
  const { data: clients = [] } = useQuery({
    queryKey: ['invoice-clients'],
    queryFn: fetchInvoiceClients,
    staleTime: 60_000,
  });

  const clientMap = new Map(clients.map((c: Client) => [c.id, c.name]));

  // Only voidable rows participate in selection / select-all.
  const voidableIds = (data?.data ?? []).filter(i => isVoidable(i.status)).map(i => i.id);
  const allVisibleSelected = voidableIds.length > 0 && voidableIds.every(id => selected.has(id));

  function toggleOne(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllVisible() {
    setSelected(s => {
      const n = new Set(s);
      if (voidableIds.every(id => n.has(id))) voidableIds.forEach(id => n.delete(id));
      else voidableIds.forEach(id => n.add(id));
      return n;
    });
  }
  function changePage(next: number) { setSelected(new Set()); setPage(next); }

  const voidMut = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      const results = await Promise.allSettled(ids.map(voidInvoice));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) throw new Error(`${failed} of ${ids.length} invoice(s) could not be voided.`);
    },
    onSuccess: () => { setSelected(new Set()); setConfirmVoid(false); setVoidError(null); qc.invalidateQueries({ queryKey: ['invoices'] }); },
    onError: (e: Error) => { setVoidError(e.message); setConfirmVoid(false); qc.invalidateQueries({ queryKey: ['invoices'] }); },
  });

  function handleFilterChange(newStatus: string) {
    setStatusFilter(newStatus);
    setPage(1);
    setSelected(new Set());
  }

  const totalPages = data?.meta?.totalPages ?? 1;
  const total = data?.meta?.total ?? 0;

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
        {STATUS_OPTIONS.map(s => (
          <button
            key={s || 'all'}
            onClick={() => handleFilterChange(s)}
            style={{
              padding: '4px 12px', borderRadius: 20, border: '1px solid #d1d5db',
              background: statusFilter === s ? 'var(--accent)' : '#fff',
              color: statusFilter === s ? '#fff' : '#374151',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
            }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.75rem', padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{selected.size} selected</span>
          <button
            style={{ ...submitBtn, background: '#b91c1c' }}
            disabled={voidMut.isPending}
            onClick={() => { setVoidError(null); setConfirmVoid(true); }}
          >
            Void selected
          </button>
          <button style={cancelBtn} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {voidError && <p style={{ color: '#b91c1c', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{voidError}</p>}

      {/* Table */}
      {isLoading && <p style={{ color: '#888' }}>{t('invoiceList.loading')}</p>}
      {isError && <p style={{ color: 'var(--accent)' }}>{t('invoiceList.error')}</p>}
      {data && (
        <>
          <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 0 0 1px var(--border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 14px', width: 36 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all invoices on this page" />
                  </th>
                  <SortableTh label={t('invoiceList.table.invoiceNumber')} col="invoice_number" sort={sort} />
                  <SortableTh label={t('invoiceList.table.client')} col="client_id" sort={sort} />
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', width: 40, fontSize: '0.875rem' }}>
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
                      {inv.client_id
                        ? <Link to={`/clients/${inv.client_id}`} style={{ color: '#374151', textDecoration: 'none' }}>
                            {clientMap.get(inv.client_id) ?? String(inv.client_id)}
                          </Link>
                        : '—'}
                    </td>
                    <td style={{ padding: '10px 8px', color: '#9ca3af', fontSize: '0.8rem', whiteSpace: 'nowrap', width: 40 }}>
                      {inv.client_id ?? '—'}
                    </td>
                    <td style={{ padding: '10px 14px', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAmount(inv.total, inv.currency)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{fmt(inv.due_date)}</td>
                    <td style={{ padding: '10px 14px' }}><StatusBadge status={inv.status} /></td>
                    <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: '0.8rem' }}>{fmt(inv.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.8rem', color: '#6b7280' }}>
            <span>{total} invoice{total !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={pageBtn} disabled={page <= 1} onClick={() => changePage(page - 1)}>← Prev</button>
              <span style={{ padding: '4px 8px' }}>Page {page} / {totalPages}</span>
              <button style={pageBtn} disabled={page >= totalPages} onClick={() => changePage(page + 1)}>Next →</button>
            </div>
          </div>
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
              <button type="button" style={cancelBtn} onClick={() => setConfirmVoid(false)} disabled={voidMut.isPending}>Cancel</button>
              <button type="button" style={{ ...submitBtn, background: '#b91c1c' }} onClick={() => voidMut.mutate()} disabled={voidMut.isPending}>
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
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 420, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const submitBtn: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const cancelBtn: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const pageBtn: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid var(--border-strong)', borderRadius: 4,
  background: 'var(--bg-card)', cursor: 'pointer', fontSize: '0.8rem',
};
