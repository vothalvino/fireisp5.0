// =============================================================================
// FireISP 5.0 — Invoice Detail
// =============================================================================
// Shows a single invoice at /invoices/:id with:
//   • Invoice metadata (number, dates, status, amounts)
//   • Line items table
//   • Actions: Send Email, Download PDF, Record Payment
//   • Applied payments list
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore, authedFetch } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';
import { fetchAddonCatalog, fetchSellableInventoryItems, buildProductPickerEntries } from '@/api/addonCatalog';
import { RecordPaymentModal } from '@/components/RecordPaymentModal';

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
  tax_rate: string | null;
  discount_amount: string | null;
  total: string;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  paid_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface InvoiceItem {
  id: number;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_rate: string | null;
  inventory_item_id?: number | null;
}

interface Payment {
  id: number;
  payment_id: number;
  invoice_id: number;
  amount: string;
  payment_amount: string;
  payment_method: string;
  payment_date: string | null;
}

interface Client {
  id: number;
  name: string;
  email: string | null;
}

interface CfdiDoc {
  id: number;
  uuid: string | null;
  sat_status: 'draft' | 'vigente' | 'cancelado' | 'cancel_pending' | null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

async function fetchInvoice(id: string): Promise<Invoice> {
  const res = await api.GET('/invoices/{id}', { params: { path: { id: Number(id) } } });
  if (res.error) throw new Error('Invoice not found');
  return (res.data as unknown as { data: Invoice }).data ?? (res.data as unknown as Invoice);
}

async function fetchItems(id: string): Promise<InvoiceItem[]> {
  const res = await api.GET('/invoices/{id}/items' as never, { params: { path: { id: Number(id) } } } as never);
  if ((res as { error?: unknown }).error) return [];
  return ((res as { data: { data: InvoiceItem[] } }).data?.data) ?? [];
}

async function fetchAppliedPayments(id: string): Promise<Payment[]> {
  const res = await api.GET('/invoices/{id}/payments' as never, { params: { path: { id: Number(id) } } } as never);
  if ((res as { error?: unknown }).error) return [];
  return ((res as { data: { data: Payment[] } }).data?.data) ?? [];
}

async function fetchClient(id: number): Promise<Client> {
  const res = await api.GET('/clients/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Client not found');
  return (res.data as unknown as { data: Client }).data ?? (res.data as unknown as Client);
}

// CFDIs stamped for this invoice. A stamped CFDI is registered at SAT the
// moment it is timbrado, so while one is vigente (or its cancellation is still
// pending at SAT) the invoice must be CANCELLED through SAT with a motivo —
// an internal void would leave the CFDI fiscally valid with the government.
// Best-effort: roles without cfdi_documents.view (or an error) just see the
// plain Void button, and the backend's 422 INVOICE_STAMPED guard stays
// authoritative.
async function fetchInvoiceCfdis(invoiceId: number): Promise<CfdiDoc[]> {
  const res = await authedFetch(`${API_BASE}/cfdi-documents?invoice_id=${invoiceId}&limit=100`);
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({})) as { data?: CfdiDoc[] };
  return body.data ?? [];
}

// Same call CfdiList.tsx makes: POST /cfdi/cancel submits the cancellation to
// SAT via the org's PAC. Once SAT accepts, the backend marks the invoice
// 'cancelled' automatically (cfdiService → billingService.cancelInvoiceForSat).
// Returns the SAT outcome: 'cancelado' (accepted) or 'cancel_pending'
// (awaiting SAT). A 'rejected' outcome arrives as HTTP 200 — the request
// succeeded but SAT refused — so it must be surfaced as an error, not success.
async function cancelCfdiAtSat(cfdiDocumentId: number, reason: string, replacementUuid?: string): Promise<string> {
  const body: Record<string, unknown> = { cfdi_document_id: cfdiDocumentId, reason };
  if (replacementUuid) body.replacement_uuid = replacementUuid;
  const res = await authedFetch(`${API_BASE}/cfdi/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const resBody = await res.json().catch(() => ({})) as { data?: { status?: string }; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(resBody.error?.message ?? 'Failed to cancel CFDI');
  }
  const satStatus = resBody.data?.status ?? 'cancel_pending';
  if (satStatus === 'rejected') {
    throw new Error('SAT rejected the cancellation — the CFDI remains vigente.');
  }
  return satStatus;
}

async function sendInvoiceEmail(invoiceId: number): Promise<{ to: string }> {
  const res = await authedFetch(`${API_BASE}/invoices/${invoiceId}/send-email`, {
    method: 'POST',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Failed to send email');
  return body as { to: string };
}

interface UpdateInvoiceBody {
  invoice_number?: string;
  currency?: string;
  due_date?: string;
  status?: string;
  subtotal?: number;
  tax_amount?: number;
  total?: number;
}

async function updateInvoice(id: number, body: UpdateInvoiceBody): Promise<void> {
  const { error } = await api.PUT('/invoices/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to update invoice'));
}

interface AddInvoiceItemBody {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  inventory_item_id?: number;
}

async function addInvoiceItem(invoiceId: number, body: AddInvoiceItemBody): Promise<InvoiceItem> {
  const res = await api.POST('/invoices/{id}/items' as never, {
    params: { path: { id: invoiceId } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error: unknown }).error, 'Failed to add item'));
  }
  return (res as { data: { data: InvoiceItem } }).data.data;
}

// Mirrors billingService's rounding convention (Math.round(x*100)/100) and
// treats tax_rate as a 0-1 FRACTION (DECIMAL(5,4) on invoices — same
// convention as quotes; see QuoteDetail.tsx's identical helper) — never
// multiply by an extra 100 here.
function computeInvoiceTotals(items: InvoiceItem[], taxRate: number) {
  const rawSubtotal = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const subtotal = Math.round(rawSubtotal * 100) / 100;
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  return { subtotal, taxAmount, total };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
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
      background: s.bg, color: s.color, padding: '3px 10px',
      borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

// SAT status of the invoice's CFDI: vigente = registered and fiscally valid at
// SAT; cancel_pending = cancellation submitted, awaiting SAT; cancelado = SAT
// accepted the cancellation.
function CfdiSatBadge({ satStatus }: { satStatus: CfdiDoc['sat_status'] }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    vigente:        { bg: '#d1fae5', color: '#065f46', label: 'Vigente' },
    cancel_pending: { bg: '#fef3c7', color: '#92400e', label: 'Cancel pending' },
    cancelado:      { bg: '#fee2e2', color: '#991b1b', label: 'Cancelado' },
    draft:          { bg: '#f3f4f6', color: '#6b7280', label: 'Draft' },
  };
  const s = map[satStatus ?? ''] ?? { bg: '#f3f4f6', color: '#374151', label: satStatus ?? '—' };
  return (
    <span style={{
      background: s.bg, color: s.color, padding: '3px 10px',
      borderRadius: 12, fontSize: '0.78rem', fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add Line Item form — the invoice's first-ever add-item UI (previously
// invoice_items could only be created via POST /invoices/generate). Mirrors
// QuoteDetail.tsx's AddItemForm: an inline card, not a modal, with an
// optional product-catalog picker on top of the always-available free-text
// fields (picking a product just autofills description/unit price and tags
// the line with inventory_item_id — the fields stay editable either way).
// invoice_items has no PUT/DELETE route (mirrors quote_items), so items can
// be added but not edited/removed once saved.
// ---------------------------------------------------------------------------

interface AddInvoiceItemFormProps {
  onAdd: (form: { description: string; quantity: string; unit_price: string; inventory_item_id?: number }) => void;
  pending: boolean;
  error: string;
}

function AddInvoiceItemForm({ onAdd, pending, error }: AddInvoiceItemFormProps) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [formError, setFormError] = useState('');

  // The picker is a UNION of the curated addon catalog and active inventory
  // items not already linked by one of those addons (see
  // buildProductPickerEntries) — an inventory item is sellable on invoices
  // directly, no addon detour required.
  const { data: catalog = [] } = useQuery({ queryKey: ['addon-catalog'], queryFn: fetchAddonCatalog });
  const { data: sellableItems = [] } = useQuery({ queryKey: ['sellable-inventory-items'], queryFn: fetchSellableInventoryItems });
  const entries = buildProductPickerEntries(catalog, sellableItems);
  // inventory_item_id-linked lines must carry a WHOLE-number quantity — the
  // backend 422s otherwise (migration 390: DECIMAL(10,2) line qty vs INT
  // stock/ledger). Free-text lines keep the usual step=0.01.
  const selectedEntry = entries.find(e => e.value === productId);
  const isInventoryLinked = !!selectedEntry?.inventory_item_id;

  function selectProduct(id: string) {
    setProductId(id);
    setFormError('');
    const entry = entries.find(e => e.value === id);
    if (entry) {
      setDescription(entry.label);
      setUnitPrice(entry.price);
      if (entry.inventory_item_id && !Number.isInteger(parseFloat(quantity))) {
        setQuantity('1');
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const selected = entries.find(e => e.value === productId);
    if (selected?.inventory_item_id && !Number.isInteger(parseFloat(quantity))) {
      setFormError(t('invoiceDetail.addItem.integerQuantityRequired'));
      return;
    }
    onAdd({
      description,
      quantity,
      unit_price: unitPrice,
      ...(selected?.inventory_item_id ? { inventory_item_id: selected.inventory_item_id } : {}),
    });
    // Reset for the next line item immediately (mirrors QuoteDetail.tsx).
    setProductId('');
    setDescription('');
    setQuantity('1');
    setUnitPrice('');
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
      {entries.length > 0 && (
        <div style={{ flex: '1 1 220px' }}>
          <label style={labelStyle} htmlFor="invoice-item-product">{t('productPicker.label')}</label>
          <select id="invoice-item-product" style={inputStyle} value={productId} onChange={e => selectProduct(e.target.value)}>
            <option value="">{t('productPicker.customOption')}</option>
            {entries.map(e => (
              <option
                key={e.value}
                value={e.value}
                style={e.quantityOnHand !== null && e.quantityOnHand <= 0 ? { color: '#dc2626' } : undefined}
              >
                {e.label} — {e.price}
                {e.quantityOnHand !== null ? ` (${t('productPicker.onHand', { count: e.quantityOnHand })})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ flex: '2 1 200px' }}>
        <label style={labelStyle} htmlFor="invoice-item-description">{t('invoiceDetail.addItem.description')}</label>
        <input id="invoice-item-description" style={inputStyle} type="text" maxLength={500} required value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div style={{ flex: '1 1 90px' }}>
        <label style={labelStyle} htmlFor="invoice-item-quantity">{t('invoiceDetail.addItem.quantity')}</label>
        <input
          id="invoice-item-quantity" style={inputStyle} type="number"
          min={isInventoryLinked ? '1' : '0.01'}
          step={isInventoryLinked ? '1' : '0.01'}
          required value={quantity} onChange={e => setQuantity(e.target.value)}
        />
      </div>
      <div style={{ flex: '1 1 120px' }}>
        <label style={labelStyle} htmlFor="invoice-item-unit-price">{t('invoiceDetail.addItem.unitPrice')}</label>
        <input id="invoice-item-unit-price" style={inputStyle} type="number" min="0" step="0.01" required value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
      </div>
      <button type="submit" style={submitBtn} disabled={pending}>
        {pending ? t('invoiceDetail.addItem.adding') : t('invoiceDetail.addItem.add')}
      </button>
      {(formError || error) && <p style={{ ...errorBox, flexBasis: '100%' }}>{formError || error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit Invoice Modal
// ---------------------------------------------------------------------------

// 'cancelled' is deliberately absent: it means "CFDI cancelled at SAT" and is
// set only by the SAT cancellation flow (the backend 422s a manual set).
// 'void' stays listed because selecting it routes through the void flow.
const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'overdue', 'void'];

interface EditInvoiceModalProps {
  invoice: Invoice;
  onClose: () => void;
  onSaved: () => void;
}

function EditInvoiceModal({ invoice, onClose, onSaved }: EditInvoiceModalProps) {
  const [form, setForm] = useState({
    invoice_number: invoice.invoice_number ?? '',
    currency: invoice.currency || 'MXN',
    due_date: invoice.due_date ? invoice.due_date.split('T')[0] : '',
    status: invoice.status,
    subtotal: invoice.subtotal ?? '',
    tax_amount: invoice.tax_amount ?? '',
    total: invoice.total ?? '',
  });
  const [error, setError] = useState('');

  function setField(name: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: UpdateInvoiceBody = { status: form.status };
      if (form.invoice_number.trim()) body.invoice_number = form.invoice_number.trim();
      if (form.currency.trim()) body.currency = form.currency.trim();
      if (form.due_date) body.due_date = form.due_date;
      if (form.subtotal !== '') body.subtotal = parseFloat(form.subtotal);
      if (form.tax_amount !== '') body.tax_amount = parseFloat(form.tax_amount);
      if (form.total !== '') body.total = parseFloat(form.total);
      return updateInvoice(invoice.id, body);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    mutation.mutate();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Edit Invoice">
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>Edit Invoice</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Invoice Number</label>
          <input style={inputStyle} value={form.invoice_number} onChange={e => setField('invoice_number', e.target.value)} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={e => setField('status', e.target.value)}>
                {INVOICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Currency</label>
              <input style={inputStyle} maxLength={3} value={form.currency} onChange={e => setField('currency', e.target.value.toUpperCase())} />
            </div>
          </div>

          <label style={labelStyle}>Due Date</label>
          <input type="date" style={inputStyle} value={form.due_date} onChange={e => setField('due_date', e.target.value)} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Subtotal</label>
              <input type="number" step="0.01" min="0" style={inputStyle} value={form.subtotal} onChange={e => setField('subtotal', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Tax</label>
              <input type="number" step="0.01" min="0" style={inputStyle} value={form.tax_amount} onChange={e => setField('tax_amount', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Total</label>
              <input type="number" step="0.01" min="0" style={inputStyle} value={form.total} onChange={e => setField('total', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn} disabled={mutation.isPending}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancel CFDI at SAT modal
// ---------------------------------------------------------------------------

// SAT cancellation reasons (motivo) — same catalog as CfdiList.tsx's modal.
const SAT_CANCEL_REASONS = [
  { code: '01', label: '01 — Comprobante emitido con errores con relación' },
  { code: '02', label: '02 — Comprobante emitido con errores sin relación' },
  { code: '03', label: '03 — No se llevó a cabo la operación' },
  { code: '04', label: '04 — Operación nominativa relacionada en CFDI global' },
];

interface CancelCfdiModalProps {
  cfdi: CfdiDoc;
  invoiceNumber: string;
  onClose: () => void;
  // Receives the SAT outcome: 'cancelado' (accepted now) or 'cancel_pending'.
  onCancelled: (satStatus: string) => void;
}

function CancelCfdiModal({ cfdi, invoiceNumber, onClose, onCancelled }: CancelCfdiModalProps) {
  const [reason, setReason] = useState('02');
  const [replacementUuid, setReplacementUuid] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUuid = replacementUuid.trim();
    if (reason === '01' && !trimmedUuid) {
      setError('Motivo 01 requires a replacement UUID (folio de sustitución).');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const satStatus = await cancelCfdiAtSat(cfdi.id, reason, reason === '01' ? trimmedUuid : undefined);
      onCancelled(satStatus);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel CFDI');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Cancel CFDI at SAT">
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Cancel CFDI at SAT</h3>
        <p style={{ margin: '0 0 0.75rem', color: '#6b7280', fontSize: '0.8rem' }}>
          Invoice {invoiceNumber} — UUID: <span style={{ fontFamily: 'monospace' }}>{cfdi.uuid ?? `#${cfdi.id}`}</span>
        </p>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#374151' }}>
          This CFDI is registered with SAT, so it stays fiscally valid until SAT
          accepts a cancellation. Once accepted, the invoice is marked cancelled
          automatically and any applied payments are released as client credit.
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle} htmlFor="cfdi-cancel-reason">Cancellation reason (SAT)</label>
          <select id="cfdi-cancel-reason" style={inputStyle} value={reason} onChange={e => setReason(e.target.value)} required>
            {SAT_CANCEL_REASONS.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>

          {reason === '01' && (
            <>
              <label style={labelStyle} htmlFor="cfdi-cancel-replacement-uuid">Replacement UUID (required for reason 01)</label>
              <input
                id="cfdi-cancel-replacement-uuid"
                style={inputStyle}
                type="text"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={replacementUuid}
                onChange={e => setReplacementUuid(e.target.value)}
                required
              />
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn} disabled={submitting}>Dismiss</button>
            <button type="submit" style={actionBtn('#b91c1c')} disabled={submitting}>
              {submitting ? 'Cancelling…' : 'Cancel CFDI'}
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

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showCancelCfdi, setShowCancelCfdi] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [addItemError, setAddItemError] = useState('');

  const invoiceQ = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => fetchInvoice(id!),
    enabled: !!id,
  });

  const itemsQ = useQuery({
    queryKey: ['invoice-items', id],
    queryFn: () => fetchItems(id!),
    enabled: !!id,
  });

  const paymentsQ = useQuery({
    queryKey: ['invoice-payments', id],
    queryFn: () => fetchAppliedPayments(id!),
    enabled: !!id,
  });

  const clientQ = useQuery({
    queryKey: ['client', invoiceQ.data?.client_id],
    queryFn: () => fetchClient(invoiceQ.data!.client_id),
    enabled: !!invoiceQ.data?.client_id,
  });

  const cfdiQ = useQuery({
    queryKey: ['invoice-cfdi', id],
    queryFn: () => fetchInvoiceCfdis(Number(id)),
    enabled: !!id,
  });
  // The CFDI that still binds this invoice at SAT (vigente, or with a SAT
  // cancellation in flight). While one exists, Void is replaced by Cancel-at-SAT.
  const liveCfdi = (cfdiQ.data ?? []).find(d => d.sat_status === 'vigente' || d.sat_status === 'cancel_pending') ?? null;
  // For the metadata card: prefer the live CFDI, else show a cancelled one so a
  // SAT-cancelled invoice still displays its fiscal history.
  const displayCfdi = liveCfdi ?? (cfdiQ.data ?? []).find(d => d.sat_status === 'cancelado') ?? null;

  const sendEmailMutation = useMutation({
    mutationFn: () => sendInvoiceEmail(Number(id)),
    onSuccess: (result) => {
      showToast(`Invoice emailed to ${result.to}`);
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (err: Error) => showToast(`Error: ${err.message}`),
  });

  const addItemMutation = useMutation({
    mutationFn: async (form: { description: string; quantity: string; unit_price: string; inventory_item_id?: number }) => {
      const quantity = parseFloat(form.quantity);
      const unitPrice = parseFloat(form.unit_price);
      const amount = Math.round(quantity * unitPrice * 100) / 100;
      await addInvoiceItem(Number(id), {
        description: form.description.trim(),
        quantity,
        unit_price: unitPrice,
        amount,
        ...(form.inventory_item_id ? { inventory_item_id: form.inventory_item_id } : {}),
      });

      // Recompute subtotal/tax/total from the full item set (fraction
      // tax-rate math, same as billingService/QuoteDetail.tsx) and persist
      // it onto the invoice, so the header always reflects its line items.
      const freshItems = await fetchItems(id!);
      const taxRate = invoiceQ.data ? (parseFloat(invoiceQ.data.tax_rate ?? '0') || 0) : 0;
      const { subtotal, taxAmount, total } = computeInvoiceTotals(freshItems, taxRate);
      await updateInvoice(Number(id), { subtotal, tax_amount: taxAmount, total });
    },
    onSuccess: () => {
      setAddItemError('');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoice-items', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      showToast(t('invoiceDetail.toasts.itemAdded'));
    },
    onError: (err: Error) => setAddItemError(err.message),
  });

  const voidMutation = useMutation({
    mutationFn: () => updateInvoice(Number(id), { status: 'void' }),
    onSuccess: () => {
      showToast('Invoice voided');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err: Error) => showToast(`Error: ${err.message}`),
  });

  function handleVoid() {
    // Voiding never strips payments as a side effect: the backend refuses
    // (422 INVOICE_HAS_PAYMENTS) while allocations exist. Deallocating is a
    // deliberate separate step (payment page → Unapply), which turns each
    // payment into unallocated client credit ready to reallocate.
    if ((paymentsQ.data ?? []).length > 0) {
      showToast('This invoice has payment(s) applied. Unapply them first (open the payment and use Unapply) — each becomes client credit — then void.');
      return;
    }
    if (window.confirm('Void this invoice? This marks it as void and cannot be undone.')) {
      voidMutation.mutate();
    }
  }

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  }

  async function handleDownloadPdf() {
    const token = tokenStore.getAccess();
    const url = `${API_BASE}/pdf/invoices/${id}`;
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download PDF');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `invoice-${invoice?.invoice_number || id}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Download failed'}`);
    }
  }

  const invoice = invoiceQ.data;
  const client = clientQ.data;

  return (
    <div style={{ padding: '1.5rem', maxWidth: 860 }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.75rem' }}>
        <Link to="/invoices" style={{ color: '#6b7280', textDecoration: 'none' }}>🧾 Invoices</Link>
        {invoice && <> / {invoice.invoice_number || `#${invoice.id}`}</>}
      </div>

      {invoiceQ.isLoading && <p style={{ color: '#888' }}>Loading…</p>}
      {invoiceQ.isError && <p style={{ color: 'var(--accent)' }}>Invoice not found.</p>}

      {invoice && (
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>
                {invoice.invoice_number || `Invoice #${invoice.id}`}
              </h1>
              {client && (
                <div style={{ marginTop: 4, fontSize: '0.875rem', color: '#6b7280' }}>
                  Client:{' '}
                  <Link to={`/clients/${client.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    {client.name}
                  </Link>
                  {client.email && <span style={{ marginLeft: 8, color: '#9ca3af' }}>{client.email}</span>}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => sendEmailMutation.mutate()}
                disabled={sendEmailMutation.isPending}
                style={actionBtn('#2563eb')}
              >
                {sendEmailMutation.isPending ? 'Sending…' : '✉️ Send Email'}
              </button>
              <button onClick={handleDownloadPdf} style={actionBtn('#059669')}>
                ⬇ Download PDF
              </button>
              <button
                onClick={() => setShowEdit(true)}
                disabled={['void', 'cancelled'].includes(invoice.status)}
                style={actionBtn('#6b7280')}
                title={invoice.status === 'void' ? 'Voided invoices cannot be edited'
                  : invoice.status === 'cancelled' ? 'SAT-cancelled invoices cannot be edited'
                  : undefined}
              >
                ✏️ Edit
              </button>
              <button
                onClick={() => setShowPayment(true)}
                // Only payable statuses — a draft/cancelled invoice never
                // appears in the payment modal's checklist, so opening it from
                // one just records unallocatable credit.
                disabled={!['issued', 'sent', 'overdue'].includes(invoice.status)}
                title={!['issued', 'sent', 'overdue'].includes(invoice.status) ? 'Only issued, sent, or overdue invoices can receive payments' : undefined}
                style={actionBtn('var(--accent)')}
              >
                💳 Record Payment
              </button>
              {liveCfdi ? (
                // Stamped invoice: the CFDI is registered at SAT, so an internal
                // void would leave it fiscally valid. The only way out is a SAT
                // cancellation with a motivo (backend enforces this with 422
                // INVOICE_STAMPED as well).
                <button
                  onClick={() => setShowCancelCfdi(true)}
                  disabled={liveCfdi.sat_status === 'cancel_pending'}
                  style={actionBtn('#b91c1c')}
                  title={liveCfdi.sat_status === 'cancel_pending'
                    ? 'A SAT cancellation is already pending for this invoice\'s CFDI'
                    : 'This invoice has a stamped CFDI registered at SAT — it must be cancelled through SAT with a motivo, not voided'}
                >
                  {liveCfdi.sat_status === 'cancel_pending' ? '⏳ SAT cancel pending' : '✕ Cancel CFDI (SAT)'}
                </button>
              ) : (
                <button
                  onClick={handleVoid}
                  disabled={['void', 'cancelled'].includes(invoice.status) || voidMutation.isPending}
                  style={actionBtn('#b91c1c')}
                  title={(paymentsQ.data ?? []).length > 0 ? 'Unapply the applied payment(s) first — each becomes client credit — then void' : undefined}
                >
                  {voidMutation.isPending ? 'Voiding…' : '🚫 Void'}
                </button>
              )}
            </div>
          </div>

          {/* Toast */}
          {toastMsg && (
            <div style={{
              background: 'var(--sidebar-bg)', color: '#fff', padding: '10px 16px',
              borderRadius: 6, marginBottom: '1rem', fontSize: '0.85rem',
            }}>
              {toastMsg}
            </div>
          )}

          {/* Invoice metadata card */}
          <div style={card}>
            <div style={metaGrid}>
              <MetaRow label="Status" value={<StatusBadge status={invoice.status} />} />
              {displayCfdi && (
                <MetaRow
                  label="CFDI (SAT)"
                  value={
                    <span title={displayCfdi.uuid ?? undefined}>
                      <CfdiSatBadge satStatus={displayCfdi.sat_status} />
                      {displayCfdi.uuid && (
                        <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                          {displayCfdi.uuid.slice(0, 13)}…
                        </span>
                      )}
                    </span>
                  }
                />
              )}
              <MetaRow label="Total" value={<strong style={{ fontSize: '1.05rem' }}>{fmtAmount(invoice.total, invoice.currency)}</strong>} />
              <MetaRow label="Subtotal" value={fmtAmount(invoice.subtotal, invoice.currency)} />
              <MetaRow label="Tax" value={fmtAmount(invoice.tax_amount, invoice.currency)} />
              {invoice.discount_amount && parseFloat(invoice.discount_amount) !== 0 && (
                <MetaRow label="Discount" value={fmtAmount(invoice.discount_amount, invoice.currency)} />
              )}
              <MetaRow label="Currency" value={invoice.currency} />
              <MetaRow label="Due Date" value={fmt(invoice.due_date)} />
              <MetaRow label="Paid At" value={fmt(invoice.paid_at)} />
              {invoice.period_start && <MetaRow label="Period" value={`${fmt(invoice.period_start)} – ${fmt(invoice.period_end)}`} />}
              <MetaRow label="Created" value={fmt(invoice.created_at)} />
              {invoice.contract_id && <MetaRow label="Contract" value={`#${invoice.contract_id}`} />}
            </div>
            {invoice.notes && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: '#6b7280', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
                <strong>Notes:</strong> {invoice.notes}
              </p>
            )}
          </div>

          {/* Line Items */}
          <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1rem' }}>Line Items</h3>
          <div style={card}>
            {itemsQ.isLoading && <p style={{ color: '#888', margin: 0 }}>Loading items…</p>}
            {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 && (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '0.85rem' }}>No line items.</p>
            )}
            {(itemsQ.data ?? []).length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                    {['Description', 'Qty', 'Unit Price', 'Tax %', 'Amount'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(itemsQ.data ?? []).map(item => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                      <td style={{ padding: '8px 10px' }}>{item.description}</td>
                      <td style={{ padding: '8px 10px' }}>{item.quantity}</td>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(item.unit_price, invoice.currency)}</td>
                      <td style={{ padding: '8px 10px', color: '#9ca3af' }}>{item.tax_rate ? `${item.tax_rate}%` : '—'}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(item.amount, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Add-item form: invoice_items has no PUT/DELETE route (mirrors
                quote_items), so items can be added but not edited/removed
                once saved. Hidden once the invoice is terminal — a voided or
                SAT-cancelled invoice cannot gain line items. */}
            {!['void', 'cancelled'].includes(invoice.status) && (
              <AddInvoiceItemForm
                onAdd={(form) => addItemMutation.mutate(form)}
                pending={addItemMutation.isPending}
                error={addItemError}
              />
            )}
          </div>

          {/* Applied Payments */}
          <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1rem' }}>Applied Payments</h3>
          <div style={card}>
            {paymentsQ.isLoading && <p style={{ color: '#888', margin: 0 }}>Loading payments…</p>}
            {!paymentsQ.isLoading && (paymentsQ.data ?? []).length === 0 && (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '0.85rem' }}>No payments applied yet.</p>
            )}
            {(paymentsQ.data ?? []).length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                    {['Payment #', 'Method', 'Amount Applied', 'Payment Date'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(paymentsQ.data ?? []).map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                      <td style={{ padding: '8px 10px', color: 'var(--accent)', fontWeight: 600 }}>#{p.payment_id}</td>
                      <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>{(p.payment_method || '').replace('_', ' ')}</td>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(p.amount, invoice.currency)}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280' }}>{fmt(p.payment_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Edit Invoice Modal */}
          {showEdit && (
            <EditInvoiceModal
              invoice={invoice}
              onClose={() => setShowEdit(false)}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['invoice', id] });
                qc.invalidateQueries({ queryKey: ['invoices'] });
                showToast('Invoice updated');
              }}
            />
          )}

          {/* Cancel CFDI at SAT Modal */}
          {showCancelCfdi && liveCfdi && (
            <CancelCfdiModal
              cfdi={liveCfdi}
              invoiceNumber={invoice.invoice_number || `#${invoice.id}`}
              onClose={() => setShowCancelCfdi(false)}
              onCancelled={(satStatus) => {
                qc.invalidateQueries({ queryKey: ['invoice', id] });
                qc.invalidateQueries({ queryKey: ['invoices'] });
                qc.invalidateQueries({ queryKey: ['invoice-cfdi', id] });
                // A paid invoice's allocations are released on acceptance —
                // the Applied Payments card must not show them as still applied.
                qc.invalidateQueries({ queryKey: ['invoice-payments', id] });
                showToast(satStatus === 'cancelado'
                  ? 'CFDI cancelled at SAT — invoice marked cancelled'
                  : 'CFDI cancellation submitted to SAT — awaiting acceptance');
              }}
            />
          )}

          {/* Record Payment Modal — this invoice starts checked in the
              checklist; the client's other open invoices are still listed,
              unchecked (see RecordPaymentModal's header comment). */}
          {showPayment && (
            <RecordPaymentModal
              lockedClientId={invoice.client_id}
              lockedClientName={clientQ.data?.name}
              lockedInvoiceId={invoice.id}
              onClose={() => setShowPayment(false)}
              onRecorded={() => {
                qc.invalidateQueries({ queryKey: ['invoice', id] });
                qc.invalidateQueries({ queryKey: ['invoice-payments', id] });
                qc.invalidateQueries({ queryKey: ['invoices'] });
                showToast('Payment recorded successfully');
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'contents' }}>
      <dt style={{ color: '#6b7280', fontWeight: 600, fontSize: '0.8rem', padding: '5px 0' }}>{label}</dt>
      <dd style={{ margin: 0, padding: '5px 0', fontSize: '0.875rem', color: '#111827' }}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 8, padding: '1rem',
  boxShadow: '0 0 0 1px var(--border)', marginBottom: '0.25rem',
};
const metaGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'auto 1fr',
  columnGap: '1.5rem', rowGap: 0,
};
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 440, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
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

function actionBtn(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none',
    padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
    fontWeight: 600, fontSize: '0.8rem',
  };
}
