// =============================================================================
// FireISP 5.0 — Invoice List
// =============================================================================
// Standalone page at /invoices. Shows all invoices across all clients with:
//   • Filtering by status
//   • Paginated table with invoice number, client, total, due date, status
//   • "Generate Invoice" button opens an inline modal form
//   • Click a row to navigate to /invoices/:id for full detail
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '@/api/client';

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

interface Contract {
  id: number;
  client_id: number;
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const API_BASE = '/api/v1';

async function fetchInvoices(page: number, statusFilter: string): Promise<InvoicesResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/invoices', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load invoices');
  return res.data as unknown as InvoicesResponse;
}

async function fetchClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

async function fetchContracts(): Promise<Contract[]> {
  const res = await api.GET('/contracts', { params: { query: { limit: 1000 } as never } });
  if (res.error) throw new Error('Failed to load contracts');
  return (res.data as unknown as { data: Contract[] }).data;
}

async function generateInvoice(contractId: number): Promise<void> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/invoices/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ contract_id: contractId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Failed to generate invoice');
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

// ---------------------------------------------------------------------------
// Generate Invoice Modal
// ---------------------------------------------------------------------------

interface GenerateModalProps {
  clients: Client[];
  contracts: Contract[];
  onClose: () => void;
  onGenerated: () => void;
}

function GenerateInvoiceModal({ clients, contracts, onClose, onGenerated }: GenerateModalProps) {
  const [clientId, setClientId] = useState('');
  const [contractId, setContractId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const clientContracts = contracts.filter(c => String(c.client_id) === clientId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contractId) { setError('Please select a contract.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await generateInvoice(Number(contractId));
      onGenerated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoice');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>Generate Invoice</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Client</label>
          <select
            style={inputStyle}
            value={clientId}
            onChange={e => { setClientId(e.target.value); setContractId(''); }}
            required
          >
            <option value="">— select client —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <label style={labelStyle}>Contract</label>
          <select
            style={inputStyle}
            value={contractId}
            onChange={e => setContractId(e.target.value)}
            required
            disabled={!clientId}
          >
            <option value="">— select contract —</option>
            {clientContracts.map(c => <option key={c.id} value={c.id}>Contract #{c.id}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={submitting}>
              {submitting ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = ['', 'draft', 'pending', 'sent', 'paid', 'overdue', 'cancelled', 'void'];

export function InvoiceList() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', page, statusFilter],
    queryFn: () => fetchInvoices(page, statusFilter),
    placeholderData: prev => prev,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-slim'],
    queryFn: fetchClients,
    enabled: showGenerate,
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts-slim'],
    queryFn: fetchContracts,
    enabled: showGenerate,
  });

  function handleFilterChange(newStatus: string) {
    setStatusFilter(newStatus);
    setPage(1);
  }

  const totalPages = data?.meta?.totalPages ?? 1;
  const total = data?.meta?.total ?? 0;

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>🧾 Invoices</h1>
        <button onClick={() => setShowGenerate(true)} style={submitBtn}>
          + Generate Invoice
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
              background: statusFilter === s ? '#e25822' : '#fff',
              color: statusFilter === s ? '#fff' : '#374151',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
            }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading && <p style={{ color: '#888' }}>Loading…</p>}
      {isError && <p style={{ color: '#e25822' }}>Failed to load invoices.</p>}
      {data && (
        <>
          <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.08)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['Invoice #', 'Client ID', 'Total', 'Due Date', 'Status', 'Created'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                      No invoices found.
                    </td>
                  </tr>
                )}
                {data.data.map((inv, idx) => (
                  <tr
                    key={inv.id}
                    style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <Link
                        to={`/invoices/${inv.id}`}
                        style={{ color: '#e25822', fontWeight: 600, textDecoration: 'none' }}
                      >
                        {inv.invoice_number || `#${inv.id}`}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {inv.client_id
                        ? <Link to={`/clients/${inv.client_id}`} style={{ color: '#374151', textDecoration: 'none' }}>
                            Client {inv.client_id}
                          </Link>
                        : '—'}
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
              <button style={pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '4px 8px' }}>Page {page} / {totalPages}</span>
              <button style={pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </>
      )}

      {/* Generate Modal */}
      {showGenerate && (
        <GenerateInvoiceModal
          clients={clients}
          contracts={contracts}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => qc.invalidateQueries({ queryKey: ['invoices'] })}
        />
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
  background: '#fff', borderRadius: 10, padding: '1.5rem',
  width: 420, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const errorBox: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b', padding: '8px 12px',
  borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem',
  color: '#374151', marginBottom: 4, marginTop: 12,
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.875rem',
};
const submitBtn: React.CSSProperties = {
  background: '#e25822', color: '#fff', border: 'none',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const cancelBtn: React.CSSProperties = {
  background: '#fff', color: '#374151', border: '1px solid #d1d5db',
  padding: '7px 18px', borderRadius: 6, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.875rem',
};
const pageBtn: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: 4,
  background: '#fff', cursor: 'pointer', fontSize: '0.8rem',
};
