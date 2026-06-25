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
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';

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
  plan_id: number;
}

// ---------------------------------------------------------------------------
// Invoice item types (for the flexible generate modal)
// ---------------------------------------------------------------------------

type ItemType = 'contract' | 'product' | 'custom';

interface InvoiceLineItem {
  localId: string;
  type: ItemType;
  // contract type
  contractId: string;
  // product / custom type
  description: string;
  quantity: string;
  unitPrice: string;
}

let _itemCounter = 0;
function makeItem(type: ItemType): InvoiceLineItem {
  const localId = `item-${++_itemCounter}`;
  return { localId, type, contractId: '', description: '', quantity: '1', unitPrice: '' };
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

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

interface FlexItem {
  type: ItemType;
  contract_id?: number;
  description?: string;
  quantity?: number;
  unit_price?: number;
}

async function generateFlexibleInvoice(clientId: number, items: FlexItem[]): Promise<void> {
  const { error } = await api.POST('/invoices/generate', {
    body: { client_id: clientId, items } as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to generate invoice'));
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

// ---------------------------------------------------------------------------
// Generate Invoice Modal — flexible multi-item invoice builder
// ---------------------------------------------------------------------------

interface GenerateModalProps {
  clients: Client[];
  contracts: Contract[];
  onClose: () => void;
  onGenerated: () => void;
}

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  contract: 'Contract charge',
  product:  'Product',
  custom:   'Custom item',
};

function GenerateInvoiceModal({ clients, contracts, onClose, onGenerated }: GenerateModalProps) {
  const [clientId, setClientId] = useState('');
  const [items, setItems] = useState<InvoiceLineItem[]>([makeItem('contract')]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const clientContracts = contracts.filter(c => String(c.client_id) === clientId);

  function addItem(type: ItemType) {
    setItems(prev => [...prev, makeItem(type)]);
  }

  function removeItem(localId: string) {
    setItems(prev => prev.filter(i => i.localId !== localId));
  }

  function updateItem(localId: string, patch: Partial<InvoiceLineItem>) {
    setItems(prev => prev.map(i => i.localId === localId ? { ...i, ...patch } : i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) { setError('Please select a client.'); return; }
    if (items.length === 0) { setError('Please add at least one item.'); return; }

    // Validate each item
    for (const item of items) {
      if (item.type === 'contract' && !item.contractId) {
        setError('Please select a contract for each contract-charge item.'); return;
      }
      if ((item.type === 'product' || item.type === 'custom') && !item.description.trim()) {
        setError('Please enter a description for each product/custom item.'); return;
      }
      if ((item.type === 'product' || item.type === 'custom') && (!item.unitPrice || parseFloat(item.unitPrice) <= 0)) {
        setError('Please enter a unit price greater than zero for each product/custom item.'); return;
      }
    }

    setSubmitting(true);
    setError('');
    try {
      const flexItems: FlexItem[] = items.map(item => {
        if (item.type === 'contract') {
          return { type: 'contract', contract_id: Number(item.contractId) };
        }
        return {
          type: item.type,
          description: item.description.trim(),
          quantity: parseFloat(item.quantity) || 1,
          unit_price: parseFloat(item.unitPrice) || 0,
        };
      });
      await generateFlexibleInvoice(Number(clientId), flexItems);
      onGenerated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoice');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Generate Invoice">
      <div style={{ ...modalBox, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>Generate Invoice</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          {/* Client selector */}
          <label style={labelStyle}>Client</label>
          <select
            style={inputStyle}
            value={clientId}
            onChange={e => { setClientId(e.target.value); setItems([makeItem('contract')]); }}
            required
          >
            <option value="">— select client —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Line items */}
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Invoice Items
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['contract', 'product', 'custom'] as ItemType[]).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addItem(type)}
                    style={{ ...addItemBtn }}
                    title={`Add ${ITEM_TYPE_LABELS[type]}`}
                  >
                    + {ITEM_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            {items.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: '#9ca3af', textAlign: 'center', padding: '0.75rem 0' }}>
                Use the buttons above to add items.
              </p>
            )}

            {items.map((item, idx) => (
              <div
                key={item.localId}
                style={{
                  border: '1px solid var(--border-strong)', borderRadius: 6,
                  padding: '0.6rem 0.75rem', marginBottom: 8, background: 'var(--bg-card)',
                }}
              >
                {/* Item header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)' }}>
                    {idx + 1}. {ITEM_TYPE_LABELS[item.type]}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(item.localId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '1rem', lineHeight: 1 }}
                    aria-label="Remove item"
                  >
                    ×
                  </button>
                </div>

                {item.type === 'contract' ? (
                  /* Contract charge: select a contract */
                  <>
                    <label style={{ ...labelStyle, marginTop: 0 }}>Contract</label>
                    <select
                      style={inputStyle}
                      value={item.contractId}
                      onChange={e => updateItem(item.localId, { contractId: e.target.value })}
                      disabled={!clientId}
                      required
                    >
                      <option value="">— select contract —</option>
                      {clientContracts.map(c => (
                        <option key={c.id} value={c.id}>Contract #{c.id}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  /* Product or Custom: description + qty + unit price */
                  <>
                    <label style={{ ...labelStyle, marginTop: 0 }}>Description</label>
                    <input
                      style={inputStyle}
                      type="text"
                      placeholder={item.type === 'product' ? 'e.g. Router Mikrotik hEX' : 'e.g. Installation fee'}
                      value={item.description}
                      onChange={e => updateItem(item.localId, { description: e.target.value })}
                      required
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>Quantity</label>
                        <input
                          style={inputStyle}
                          type="number"
                          min="0.01"
                          step="any"
                          value={item.quantity}
                          onChange={e => updateItem(item.localId, { quantity: e.target.value })}
                        />
                      </div>
                      <div style={{ flex: 2 }}>
                        <label style={labelStyle}>Unit Price</label>
                        <input
                          style={inputStyle}
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={item.unitPrice}
                          onChange={e => updateItem(item.localId, { unitPrice: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

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
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', page, statusFilter],
    queryFn: () => fetchInvoices(page, statusFilter),
    placeholderData: prev => prev,
  });

  const visibleIds = (data?.data ?? []).map(i => i.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  function toggleOne(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllVisible() {
    setSelected(s => {
      const n = new Set(s);
      if (visibleIds.every(id => n.has(id))) visibleIds.forEach(id => n.delete(id));
      else visibleIds.forEach(id => n.add(id));
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
                  {[
                    t('invoiceList.table.invoiceNumber'),
                    t('invoiceList.table.clientId'),
                    t('invoiceList.table.total'),
                    t('invoiceList.table.dueDate'),
                    t('invoiceList.table.status'),
                    t('invoiceList.table.created'),
                  ].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
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
          clients={clients}
          contracts={contracts}
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
const errorBox: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b', padding: '8px 12px',
  borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem',
  color: 'var(--text-secondary)', marginBottom: 4, marginTop: 12,
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  border: '1px solid var(--input-border)', borderRadius: 6, fontSize: '0.875rem',
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
const addItemBtn: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent)',
  padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.72rem',
};
