// =============================================================================
// FireISP 5.0 — Generate Quote Modal (shared)
// =============================================================================
// Flexible multi-item quote builder — a clone of GenerateInvoiceModal.tsx
// (same client/contract/product-catalog pickers, same three item types),
// submitting to POST /quotes/generate instead of POST /invoices/generate.
// This is "create a quote like an invoice": pick a client, add line items,
// submit everything at once — no per-item round trip needed at creation
// time (POST /quotes/:id/items still exists for adding MORE items later
// from QuoteDetail).
//
// Line-item types (identical semantics to the invoice version):
//   • contract — quote a contract's plan at its current price (contract
//     picker; this is the ONLY type that asks for a contract). Unlike
//     invoice generation, this never touches billing_periods — a quote is
//     just an estimate and may never be accepted.
//   • product  — quote a catalog product, chosen from the plan add-on
//     catalog (auto-fills the price; editable). No contract needed.
//   • custom   — a free-text one-off charge (description + qty + price)
//
// Pass `lockedClientId` to pre-select + lock the client (e.g. when opened
// from a client's page). Otherwise a client selector is shown. The modal
// fetches its own clients / contracts / product catalog so callers just
// render it. `onGenerated` receives the created quote so the caller can
// navigate to its detail page.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  overlay, modalBox, errorBox, labelStyle, inputStyle, submitBtn, cancelBtn,
  extractApiError,
} from '@/components/ClientFormModal';
import { fetchAddonCatalog, fetchSellableInventoryItems, buildProductPickerEntries } from '@/api/addonCatalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Client { id: number; name: string; }
interface Contract { id: number; client_id: number; }

type ItemType = 'contract' | 'product' | 'custom';

interface QuoteLineItem {
  localId: string;
  type: ItemType;
  contractId: string;      // contract type
  productAddonId: string;  // product type (catalog selection)
  description: string;     // product (auto-filled from the catalog) / custom (free text)
  quantity: string;
  unitPrice: string;
}

interface FlexItem {
  type: ItemType;
  contract_id?: number;
  description?: string;
  quantity?: number;
  unit_price?: number;
}

/** Minimal shape of the created quote — just enough for the caller to navigate. */
export interface GeneratedQuote {
  id: number;
  quote_number?: string | null;
}

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  contract: 'Contract charge',
  product:  'Product',
  custom:   'Custom item',
};

let _itemCounter = 0;
function makeItem(type: ItemType): QuoteLineItem {
  return { localId: `item-${++_itemCounter}`, type, contractId: '', productAddonId: '', description: '', quantity: '1', unitPrice: '' };
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

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

async function generateFlexibleQuote(clientId: number, items: FlexItem[]): Promise<GeneratedQuote> {
  const { data, error: e } = await api.POST('/quotes/generate', {
    body: { client_id: clientId, items } as never,
  });
  if (e) throw new Error(extractApiError(e, 'Failed to generate quote'));
  return (data as unknown as { data: GeneratedQuote }).data;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GenerateQuoteModalProps {
  /** Pre-select + lock the client (e.g. opened from the client's page). */
  lockedClientId?: number;
  /** Display name for the locked client (the clients list isn't fetched when locked). */
  lockedClientName?: string;
  onClose: () => void;
  onGenerated: (quote: GeneratedQuote) => void;
}

export function GenerateQuoteModal({ lockedClientId, lockedClientName, onClose, onGenerated }: GenerateQuoteModalProps) {
  const [clientId, setClientId] = useState(lockedClientId ? String(lockedClientId) : '');
  // Start with no line — the user picks the type (product / contract charge /
  // custom) via the buttons, so we never force an empty `required` product line
  // (which would block submit, especially when the catalog is empty).
  const [items, setItems] = useState<QuoteLineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Self-fetch data. Client list only needed when the client isn't locked.
  const { data: clients = [], isError: clientsError } = useQuery({ queryKey: ['clients-slim'], queryFn: fetchClients, enabled: !lockedClientId });
  const { data: contracts = [] } = useQuery({ queryKey: ['contracts-slim'], queryFn: fetchContracts });
  const { data: addonCatalog = [], isError: addonsError } = useQuery({ queryKey: ['addon-catalog'], queryFn: fetchAddonCatalog });
  const { data: sellableItems = [] } = useQuery({ queryKey: ['sellable-inventory-items'], queryFn: fetchSellableInventoryItems });
  // Product picker: UNION of the curated addon catalog and active inventory
  // items not already linked by one of those addons (Inventory follow-up —
  // an item is sellable directly, no addon detour required). Note: unlike
  // InvoiceDetail/QuoteDetail's picker, this modal's `type: 'product'` line
  // does NOT carry inventory_item_id through to POST /quotes/generate
  // (pre-existing gap, out of this follow-up's scope — see addonCatalog.ts);
  // this only extends the SAME pre-existing "prefill only" behavior to more
  // entries, it does not add a new one.
  const addons = buildProductPickerEntries(addonCatalog, sellableItems);
  const loadError = (!lockedClientId && clientsError) || addonsError;

  const clientContracts = contracts.filter(c => String(c.client_id) === clientId);

  function addItem(type: ItemType) { setItems(prev => [...prev, makeItem(type)]); }
  function removeItem(localId: string) { setItems(prev => prev.filter(i => i.localId !== localId)); }
  function updateItem(localId: string, patch: Partial<QuoteLineItem>) {
    setItems(prev => prev.map(i => i.localId === localId ? { ...i, ...patch } : i));
  }
  function selectAddon(localId: string, addonId: string) {
    const addon = addons.find(a => a.value === addonId);
    updateItem(localId, {
      productAddonId: addonId,
      description: addon ? addon.label : '',
      unitPrice: addon ? addon.price : '',
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) { setError('Please select a client.'); return; }
    if (items.length === 0) { setError('Please add at least one item.'); return; }

    for (const item of items) {
      if (item.type === 'contract' && !item.contractId) {
        setError('Please select a contract for each contract-charge item.'); return;
      }
      if (item.type === 'product' && !item.productAddonId) {
        setError('Please select a product for each product item.'); return;
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
      const quote = await generateFlexibleQuote(Number(clientId), flexItems);
      onGenerated(quote);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate quote');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Generate Quote">
      <div style={{ ...modalBox, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>Generate Quote</h3>
        {error && <div style={errorBox}>{error}</div>}
        {loadError && (
          <div style={errorBox}>Some data failed to load (check your permissions or try reopening).</div>
        )}
        <form onSubmit={handleSubmit}>
          {/* Client selector — hidden/locked when opened from a client's page */}
          <label style={labelStyle}>Client</label>
          {lockedClientId ? (
            <select style={{ ...inputStyle, background: 'var(--bg-body)', color: 'var(--text-muted)' }} value={clientId} disabled>
              <option value={clientId}>
                {clients.find(c => String(c.id) === clientId)?.name ?? lockedClientName ?? `Client #${clientId}`}
              </option>
            </select>
          ) : (
            <select
              style={inputStyle}
              value={clientId}
              onChange={e => { setClientId(e.target.value); setItems([]); }}
              required
            >
              <option value="">— select client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}

          {/* Line items */}
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Quote Items</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['contract', 'product', 'custom'] as ItemType[]).map(type => (
                  <button key={type} type="button" onClick={() => addItem(type)} style={addItemBtn} title={`Add ${ITEM_TYPE_LABELS[type]}`}>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)' }}>
                    {idx + 1}. {ITEM_TYPE_LABELS[item.type]}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(item.localId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '1rem', lineHeight: 1 }}
                    aria-label="Remove item"
                  >×</button>
                </div>

                {item.type === 'contract' && (
                  /* Contract charge: the only type that asks for a contract */
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
                      {clientContracts.map(c => <option key={c.id} value={c.id}>Contract #{c.id}</option>)}
                    </select>
                  </>
                )}

                {item.type === 'product' && (
                  /* Product: choose from the add-on catalog; price auto-fills (editable) */
                  <>
                    <label style={{ ...labelStyle, marginTop: 0 }}>Product</label>
                    <select
                      style={inputStyle}
                      value={item.productAddonId}
                      onChange={e => selectAddon(item.localId, e.target.value)}
                      required
                    >
                      <option value="">
                        {addons.length
                          ? '— select product —'
                          : addonsError ? '— failed to load products —' : '— no products in catalog —'}
                      </option>
                      {addons.map(a => (
                        <option key={a.value} value={a.value}>{a.label} ({a.price})</option>
                      ))}
                    </select>
                    {addons.length === 0 && !addonsError && (
                      <p style={{ fontSize: '0.74rem', color: '#9ca3af', margin: '4px 0 0' }}>
                        Add products under Plans → Add-ons, or use a Custom item.
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>Quantity</label>
                        <input style={inputStyle} type="number" min="0.01" step="any" value={item.quantity}
                          onChange={e => updateItem(item.localId, { quantity: e.target.value })} />
                      </div>
                      <div style={{ flex: 2 }}>
                        <label style={labelStyle}>Unit Price</label>
                        <input style={inputStyle} type="number" min="0.01" step="0.01" placeholder="0.00" value={item.unitPrice}
                          onChange={e => updateItem(item.localId, { unitPrice: e.target.value })} required />
                      </div>
                    </div>
                  </>
                )}

                {item.type === 'custom' && (
                  /* Custom: free-text one-off charge */
                  <>
                    <label style={{ ...labelStyle, marginTop: 0 }}>Description</label>
                    <input style={inputStyle} type="text" placeholder="e.g. Site survey" value={item.description}
                      onChange={e => updateItem(item.localId, { description: e.target.value })} required />
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>Quantity</label>
                        <input style={inputStyle} type="number" min="0.01" step="any" value={item.quantity}
                          onChange={e => updateItem(item.localId, { quantity: e.target.value })} />
                      </div>
                      <div style={{ flex: 2 }}>
                        <label style={labelStyle}>Unit Price</label>
                        <input style={inputStyle} type="number" min="0.01" step="0.01" placeholder="0.00" value={item.unitPrice}
                          onChange={e => updateItem(item.localId, { unitPrice: e.target.value })} required />
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

const addItemBtn: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent)',
  padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
  fontWeight: 600, fontSize: '0.72rem',
};
