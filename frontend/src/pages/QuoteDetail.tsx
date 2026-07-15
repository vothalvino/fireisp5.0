// =============================================================================
// FireISP 5.0 — Quote Detail
// =============================================================================
// Shows a single quote at /quotes/:id, mirroring InvoiceDetail's structure:
//   • Quote metadata (number, client, valid_until, status, amounts)
//   • Line items table with an "Add Item" form (POST /quotes/{id}/items) —
//     each add recomputes subtotal/tax/total from the items and persists them
//     via PUT /quotes/{id}, the same subtotal/tax-rate math billingService
//     uses when generating invoices (tax_rate is a 0–1 FRACTION, no *100 bug).
//   • Approve / Reject (any editor with quotes.update — no dedicated
//     approval permission) and Convert to Invoice (only once accepted)
//   • Download PDF (the backend has supported this since §8; this page is
//     the first UI entry point for it)
// =============================================================================

import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';
import { styles as crudStyles, modalStyles, RequiredMark } from './crudStyles';
import { fetchAddonCatalog, addonPrice, addonQuantityOnHand } from '@/api/addonCatalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Quote {
  id: number;
  client_id: number;
  contract_id: number | null;
  quote_number: string | null;
  issue_date: string | null;
  valid_until: string | null;
  subtotal: string;
  tax_rate: string | null;
  tax_amount: string;
  total: string;
  currency: string;
  notes: string | null;
  status: string;
  created_at: string;
}

interface QuoteItem {
  id: number;
  quote_id: number;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate_id: number | null;
  // quote_items.total is a GENERATED column (quantity * unit_price) — there is
  // no writable `amount` column on this table (unlike invoice_items).
  total: string;
  inventory_item_id?: number | null;
}

interface Client {
  id: number;
  name: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

async function fetchQuote(id: string): Promise<Quote> {
  const res = await api.GET('/quotes/{id}', { params: { path: { id: Number(id) } } });
  if (res.error) throw new Error('Quote not found');
  return (res.data as unknown as { data: Quote }).data ?? (res.data as unknown as Quote);
}

async function fetchItems(id: string): Promise<QuoteItem[]> {
  const res = await api.GET('/quotes/{id}/items' as never, { params: { path: { id: Number(id) } } } as never);
  if ((res as { error?: unknown }).error) return [];
  return ((res as { data: { data: QuoteItem[] } }).data?.data) ?? [];
}

async function fetchClient(id: number): Promise<Client> {
  const res = await api.GET('/clients/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Client not found');
  return (res.data as unknown as { data: Client }).data ?? (res.data as unknown as Client);
}

interface AddItemBody {
  description: string;
  quantity: number;
  unit_price: number;
  // Required by the createQuoteItem validation schema for backward
  // compatibility, but never persisted (see Quote.addItem) — the DB computes
  // `total` itself. Sent as quantity * unit_price so validation is satisfied.
  amount: number;
  // Optional link to a catalog product backed by physical stock (migration
  // 390) — carried through unchanged to invoice_items on conversion; quotes
  // themselves never draw down stock.
  inventory_item_id?: number;
}

async function addQuoteItem(quoteId: number, body: AddItemBody): Promise<QuoteItem> {
  const res = await api.POST('/quotes/{id}/items' as never, {
    params: { path: { id: quoteId } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error: unknown }).error, 'Failed to add item'));
  }
  return (res as { data: { data: QuoteItem } }).data.data;
}

interface UpdateQuoteBody {
  quote_number?: string;
  valid_until?: string;
  currency?: string;
  tax_rate?: number;
  subtotal?: number;
  tax_amount?: number;
  total?: number;
  notes?: string;
}

async function updateQuote(id: number, body: UpdateQuoteBody): Promise<void> {
  const { error } = await api.PUT('/quotes/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (error) throw new Error(extractApiError(error, 'Failed to update quote'));
}

async function approveQuote(id: number): Promise<Quote> {
  const { data, error: e } = await api.POST('/quotes/{id}/approve', { params: { path: { id } }, body: {} as never });
  if (e) throw new Error(extractApiError(e, 'Failed to approve quote'));
  return (data as unknown as { data: Quote }).data;
}

async function rejectQuote(id: number): Promise<Quote> {
  const { data, error: e } = await api.POST('/quotes/{id}/reject', { params: { path: { id } }, body: {} as never });
  if (e) throw new Error(extractApiError(e, 'Failed to reject quote'));
  return (data as unknown as { data: Quote }).data;
}

async function convertQuoteToInvoice(id: number): Promise<{ id: number }> {
  const { data, error: e } = await api.POST('/quotes/{id}/convert-to-invoice', { params: { path: { id } }, body: {} as never });
  if (e) throw new Error(extractApiError(e, 'Failed to convert quote to invoice'));
  return (data as unknown as { data: { id: number } }).data;
}

// ---------------------------------------------------------------------------
// Totals — mirrors billingService's rounding convention (Math.round(x*100)/100)
// and treats tax_rate as a 0–1 FRACTION, matching createQuote's validation
// schema (min 0, max 1) — never multiply by an extra 100 here.
// ---------------------------------------------------------------------------

function computeTotals(items: QuoteItem[], taxRate: number) {
  const rawSubtotal = items.reduce((sum, item) => sum + Number(item.total ?? 0), 0);
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

function fmtAmount(amount: string | number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(num);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:    { bg: '#f3f4f6', color: '#6b7280' },
    sent:     { bg: '#dbeafe', color: '#1e40af' },
    accepted: { bg: '#d1fae5', color: '#065f46' },
    rejected: { bg: '#fee2e2', color: '#991b1b' },
    expired:  { bg: '#fef3c7', color: '#92400e' },
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

// ---------------------------------------------------------------------------
// Add Line Item form (inline card, not a modal — the primary "build the
// quote" interaction, mirroring how GenerateInvoiceModal builds an item list
// before submit, except here each item is added directly to the persisted
// quote since quotes have no bulk "generate" endpoint).
// ---------------------------------------------------------------------------

interface AddItemFormProps {
  onAdd: (form: { description: string; quantity: string; unit_price: string; inventory_item_id?: number }) => void;
  pending: boolean;
  error: string;
}

function AddItemForm({ onAdd, pending, error }: AddItemFormProps) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');

  // Optional product-catalog picker — autofills description/unit price and
  // tags the line with inventory_item_id; free-text lines keep working
  // exactly as before (the fields stay editable either way).
  const { data: catalog = [] } = useQuery({ queryKey: ['addon-catalog'], queryFn: fetchAddonCatalog });

  function selectProduct(id: string) {
    setProductId(id);
    const addon = catalog.find(a => String(a.id) === id);
    if (addon) {
      setDescription(addon.name);
      setUnitPrice(addonPrice(addon));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const selected = catalog.find(a => String(a.id) === productId);
    onAdd({
      description,
      quantity,
      unit_price: unitPrice,
      ...(selected?.inventory_item_id ? { inventory_item_id: selected.inventory_item_id } : {}),
    });
    // Reset for the next line item immediately — quotes commonly need
    // several items added back-to-back (e.g. equipment + install fee +
    // first-month service), so the form shouldn't make the user re-clear
    // fields between adds. If the add fails, addItemError still surfaces
    // below the (now-empty) form.
    setProductId('');
    setDescription('');
    setQuantity('1');
    setUnitPrice('');
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
      {catalog.length > 0 && (
        <div style={{ flex: '1 1 220px' }}>
          <label style={labelStyle} htmlFor="quote-item-product">{t('productPicker.label')}</label>
          <select id="quote-item-product" style={inputStyle} value={productId} onChange={e => selectProduct(e.target.value)}>
            <option value="">{t('productPicker.customOption')}</option>
            {catalog.map(a => (
              <option
                key={a.id}
                value={String(a.id)}
                style={a.inventory_item_id && addonQuantityOnHand(a) <= 0 ? { color: '#dc2626' } : undefined}
              >
                {a.name} — {addonPrice(a)}
                {a.inventory_item_id ? ` (${t('productPicker.onHand', { count: addonQuantityOnHand(a) })})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ flex: '2 1 200px' }}>
        <label style={labelStyle} htmlFor="quote-item-description">{t('quoteDetail.form.description')} <RequiredMark /></label>
        <input id="quote-item-description" style={inputStyle} type="text" maxLength={255} required value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div style={{ flex: '1 1 90px' }}>
        <label style={labelStyle} htmlFor="quote-item-quantity">{t('quoteDetail.form.quantity')} <RequiredMark /></label>
        <input id="quote-item-quantity" style={inputStyle} type="number" min="0.01" step="0.01" required value={quantity} onChange={e => setQuantity(e.target.value)} />
      </div>
      <div style={{ flex: '1 1 120px' }}>
        <label style={labelStyle} htmlFor="quote-item-unit-price">{t('quoteDetail.form.unitPrice')} <RequiredMark /></label>
        <input id="quote-item-unit-price" style={inputStyle} type="number" min="0" step="0.01" required value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
      </div>
      <button type="submit" style={submitBtn} disabled={pending}>
        {pending ? t('quoteDetail.actions.adding') : t('quoteDetail.actions.add')}
      </button>
      {error && <p style={{ ...errorText, flexBasis: '100%' }}>{error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit Quote Modal — metadata + a manual totals override (mirrors
// InvoiceDetail's EditInvoiceModal escape hatch). Status is intentionally NOT
// editable here — Approve/Reject below are the only door for status changes,
// so there is exactly one place that can move a quote between states.
// ---------------------------------------------------------------------------

interface EditQuoteModalProps {
  quote: Quote;
  onClose: () => void;
  onSaved: () => void;
}

function EditQuoteModal({ quote, onClose, onSaved }: EditQuoteModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    quote_number: quote.quote_number ?? '',
    valid_until: quote.valid_until ? quote.valid_until.split('T')[0] : '',
    currency: quote.currency || 'MXN',
    tax_rate: quote.tax_rate ?? '',
    subtotal: quote.subtotal ?? '',
    tax_amount: quote.tax_amount ?? '',
    total: quote.total ?? '',
    notes: quote.notes ?? '',
  });
  const [error, setError] = useState('');

  function setField(name: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: UpdateQuoteBody = {};
      if (form.quote_number.trim()) body.quote_number = form.quote_number.trim();
      if (form.valid_until) body.valid_until = form.valid_until;
      if (form.currency.trim()) body.currency = form.currency.trim();
      if (form.tax_rate !== '') body.tax_rate = Number(form.tax_rate);
      if (form.subtotal !== '') body.subtotal = Number(form.subtotal);
      if (form.tax_amount !== '') body.tax_amount = Number(form.tax_amount);
      if (form.total !== '') body.total = Number(form.total);
      body.notes = form.notes;
      return updateQuote(quote.id, body);
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
    <div style={modalStyles.backdrop} role="dialog" aria-modal="true" aria-label={t('quoteDetail.editTitle')}>
      <div style={modalStyles.panel}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{t('quoteDetail.editTitle')}</h3>
          <button type="button" style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <p style={modalStyles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            {t('quoteDetail.editFields.quoteNumber')}
            <input style={modalStyles.input} value={form.quote_number} onChange={e => setField('quote_number', e.target.value)} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <label style={modalStyles.label}>
              {t('quoteDetail.editFields.validUntil')}
              <input style={modalStyles.input} type="date" value={form.valid_until} onChange={e => setField('valid_until', e.target.value)} />
            </label>
            <label style={modalStyles.label}>
              {t('quoteDetail.editFields.currency')}
              <input style={modalStyles.input} maxLength={3} value={form.currency} onChange={e => setField('currency', e.target.value.toUpperCase())} />
            </label>
          </div>

          <label style={modalStyles.label}>
            {t('quoteDetail.editFields.taxRate')}
            <input style={modalStyles.input} type="number" min={0} max={1} step="0.0001" value={form.tax_rate} onChange={e => setField('tax_rate', e.target.value)} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' }}>
            <label style={modalStyles.label}>
              {t('quoteDetail.editFields.subtotal')}
              <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.subtotal} onChange={e => setField('subtotal', e.target.value)} />
            </label>
            <label style={modalStyles.label}>
              {t('quoteDetail.editFields.taxAmount')}
              <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.tax_amount} onChange={e => setField('tax_amount', e.target.value)} />
            </label>
            <label style={modalStyles.label}>
              {t('quoteDetail.editFields.total')}
              <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.total} onChange={e => setField('total', e.target.value)} />
            </label>
          </div>

          <label style={modalStyles.label}>
            {t('quoteDetail.editFields.notes')}
            <textarea style={{ ...modalStyles.input, minHeight: 70, resize: 'vertical' as const }} maxLength={5000} value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </label>

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={crudStyles.btnSecondary} disabled={mutation.isPending}>
              {t('quoteDetail.actions.cancel')}
            </button>
            <button type="submit" style={crudStyles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? t('quoteDetail.actions.saving') : t('quoteDetail.actions.save')}
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

export function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [addItemError, setAddItemError] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  const quoteQ = useQuery({
    queryKey: ['quote', id],
    queryFn: () => fetchQuote(id!),
    enabled: !!id,
  });

  const itemsQ = useQuery({
    queryKey: ['quote-items', id],
    queryFn: () => fetchItems(id!),
    enabled: !!id,
  });

  const clientQ = useQuery({
    queryKey: ['client', quoteQ.data?.client_id],
    queryFn: () => fetchClient(quoteQ.data!.client_id),
    enabled: !!quoteQ.data?.client_id,
  });

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  }

  const quote = quoteQ.data;

  const addItemMutation = useMutation({
    mutationFn: async (form: { description: string; quantity: string; unit_price: string; inventory_item_id?: number }) => {
      const quantity = parseFloat(form.quantity);
      const unitPrice = parseFloat(form.unit_price);
      const amount = Math.round(quantity * unitPrice * 100) / 100;
      await addQuoteItem(Number(id), {
        description: form.description.trim(),
        quantity,
        unit_price: unitPrice,
        amount,
        ...(form.inventory_item_id ? { inventory_item_id: form.inventory_item_id } : {}),
      });

      // Recompute subtotal/tax/total from the full item set — the same
      // (fraction) tax-rate math billingService uses when generating
      // invoices — and persist it onto the quote, so the header always
      // reflects the sum of its line items.
      const freshItems = await fetchItems(id!);
      const taxRate = quote ? (parseFloat(quote.tax_rate ?? '0') || 0) : 0;
      const { subtotal, taxAmount, total } = computeTotals(freshItems, taxRate);
      await updateQuote(Number(id), { subtotal, tax_amount: taxAmount, total });
    },
    onSuccess: () => {
      setAddItemError('');
      qc.invalidateQueries({ queryKey: ['quote', id] });
      qc.invalidateQueries({ queryKey: ['quote-items', id] });
      qc.invalidateQueries({ queryKey: ['quotes'] });
      showToast(t('quoteDetail.toasts.itemAdded'));
    },
    onError: (err: Error) => setAddItemError(err.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveQuote(Number(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quote', id] });
      qc.invalidateQueries({ queryKey: ['quotes'] });
      showToast(t('quoteDetail.toasts.approved'));
    },
    onError: (err: Error) => showToast(`${t('quoteDetail.toasts.errorPrefix')}: ${err.message}`),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectQuote(Number(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quote', id] });
      qc.invalidateQueries({ queryKey: ['quotes'] });
      showToast(t('quoteDetail.toasts.rejected'));
    },
    onError: (err: Error) => showToast(`${t('quoteDetail.toasts.errorPrefix')}: ${err.message}`),
  });

  const convertMutation = useMutation({
    mutationFn: () => convertQuoteToInvoice(Number(id)),
    onSuccess: (invoice) => {
      qc.invalidateQueries({ queryKey: ['quote', id] });
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      showToast(t('quoteDetail.toasts.converted'));
      navigate(`/invoices/${invoice.id}`);
    },
    onError: (err: Error) => showToast(`${t('quoteDetail.toasts.errorPrefix')}: ${err.message}`),
  });

  async function handleDownloadPdf() {
    const token = tokenStore.getAccess();
    const url = `${API_BASE}/pdf/quotes/${id}`;
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download PDF');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `quote-${quote?.quote_number || id}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch (err) {
      showToast(`${t('quoteDetail.toasts.errorPrefix')}: ${err instanceof Error ? err.message : 'Download failed'}`);
    }
  }

  const client = clientQ.data;
  const items = itemsQ.data ?? [];
  const canConvert = quote?.status === 'accepted';

  return (
    <div style={{ padding: '1.5rem', maxWidth: 860 }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.75rem' }}>
        <Link to="/quotes" style={{ color: '#6b7280', textDecoration: 'none' }}>🧮 {t('quoteDetail.breadcrumb')}</Link>
        {quote && <> / {quote.quote_number || `#${quote.id}`}</>}
      </div>

      {quoteQ.isLoading && <p style={{ color: '#888' }}>{t('quoteDetail.loading')}</p>}
      {quoteQ.isError && <p style={{ color: 'var(--accent)' }}>{t('quoteDetail.notFound')}</p>}

      {quote && (
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>
                {quote.quote_number || `Quote #${quote.id}`}
              </h1>
              {client && (
                <div style={{ marginTop: 4, fontSize: '0.875rem', color: '#6b7280' }}>
                  {t('quoteDetail.clientLabel')}{' '}
                  <Link to={`/clients/${client.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    {client.name}
                  </Link>
                  {client.email && <span style={{ marginLeft: 8, color: '#9ca3af' }}>{client.email}</span>}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={handleDownloadPdf} style={actionBtn('#059669')}>
                ⬇ {t('quoteDetail.actions.downloadPdf')}
              </button>
              <button onClick={() => setShowEdit(true)} style={actionBtn('#6b7280')}>
                ✏️ {t('quoteDetail.actions.edit')}
              </button>
              <button
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending || quote.status === 'rejected'}
                style={actionBtn('#b91c1c')}
                title={quote.status === 'rejected' ? undefined : t('quoteDetail.actions.reject')}
              >
                {rejectMutation.isPending ? t('quoteDetail.actions.rejecting') : `✖ ${t('quoteDetail.actions.reject')}`}
              </button>
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || quote.status === 'accepted'}
                style={actionBtn('#059669')}
                title={quote.status === 'accepted' ? undefined : t('quoteDetail.actions.approve')}
              >
                {approveMutation.isPending ? t('quoteDetail.actions.approving') : `✔ ${t('quoteDetail.actions.approve')}`}
              </button>
              {canConvert && (
                <button
                  onClick={() => convertMutation.mutate()}
                  disabled={convertMutation.isPending}
                  style={actionBtn('var(--accent)')}
                >
                  {convertMutation.isPending ? t('quoteDetail.actions.converting') : `➜ ${t('quoteDetail.actions.convert')}`}
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

          {/* Quote metadata card */}
          <div style={card}>
            <div style={metaGrid}>
              <MetaRow label={t('quoteDetail.meta.status')} value={<StatusBadge status={quote.status} />} />
              <MetaRow label={t('quoteDetail.meta.total')} value={<strong style={{ fontSize: '1.05rem' }}>{fmtAmount(quote.total, quote.currency)}</strong>} />
              <MetaRow label={t('quoteDetail.meta.subtotal')} value={fmtAmount(quote.subtotal, quote.currency)} />
              <MetaRow label={t('quoteDetail.meta.tax')} value={fmtAmount(quote.tax_amount, quote.currency)} />
              <MetaRow label={t('quoteDetail.meta.currency')} value={quote.currency} />
              <MetaRow label={t('quoteDetail.meta.validUntil')} value={fmt(quote.valid_until)} />
              {quote.issue_date && <MetaRow label={t('quoteDetail.meta.issueDate')} value={fmt(quote.issue_date)} />}
              <MetaRow label={t('quoteDetail.meta.created')} value={fmt(quote.created_at)} />
              {quote.contract_id && <MetaRow label={t('quoteDetail.meta.contract')} value={`#${quote.contract_id}`} />}
            </div>
            {quote.notes && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: '#6b7280', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
                <strong>{t('quoteDetail.notesLabel')}</strong> {quote.notes}
              </p>
            )}
            {!canConvert && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: '#9ca3af', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
                {t('quoteDetail.convertGuard')}
              </p>
            )}
          </div>

          {/* Line Items */}
          <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1rem' }}>{t('quoteDetail.lineItems')}</h3>
          <div style={card}>
            {itemsQ.isLoading && <p style={{ color: '#888', margin: 0 }}>{t('quoteDetail.loadingItems')}</p>}
            {!itemsQ.isLoading && items.length === 0 && (
              <p style={{ color: '#9ca3af', margin: 0, fontSize: '0.85rem' }}>{t('quoteDetail.noItems')}</p>
            )}
            {items.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                    {[t('quoteDetail.table.description'), t('quoteDetail.table.qty'), t('quoteDetail.table.unitPrice'), t('quoteDetail.table.total')].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                      <td style={{ padding: '8px 10px' }}>{item.description}</td>
                      <td style={{ padding: '8px 10px' }}>{item.quantity}</td>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(item.unit_price, quote.currency)}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(item.total, quote.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Add-item form: quote_items has no PUT/DELETE route (mirrors
                invoice_items, which also has neither), so items can be added
                but not edited/removed once saved. */}
            <AddItemForm
              onAdd={(form) => addItemMutation.mutate(form)}
              pending={addItemMutation.isPending}
              error={addItemError}
            />
          </div>

          {/* Edit Quote Modal */}
          {showEdit && (
            <EditQuoteModal
              quote={quote}
              onClose={() => setShowEdit(false)}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['quote', id] });
                qc.invalidateQueries({ queryKey: ['quotes'] });
                showToast(t('quoteDetail.toasts.updated'));
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
// Shared styles (mirrors InvoiceDetail.tsx)
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 8, padding: '1rem',
  boxShadow: '0 0 0 1px var(--border)', marginBottom: '0.25rem',
};
const metaGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'auto 1fr',
  columnGap: '1.5rem', rowGap: 0,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem',
  color: 'var(--text-secondary)', marginBottom: 4,
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
const errorText: React.CSSProperties = {
  color: '#dc2626', fontSize: '0.8rem', margin: '4px 0 0',
};

function actionBtn(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none',
    padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
    fontWeight: 600, fontSize: '0.8rem',
  };
}
