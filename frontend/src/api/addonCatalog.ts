// =============================================================================
// FireISP 5.0 — Product/add-on catalog fetch (Inventory Phase 2 + follow-up)
// =============================================================================
// Shared by InvoiceDetail.tsx / QuoteDetail.tsx's "Add Item" product pickers
// AND GenerateInvoiceModal.tsx / GenerateQuoteModal.tsx's product line type.
//
// The product picker is a UNION of two sources (Inventory follow-up — the
// user's original ask was "inventory... appears on the products so that we
// can add it to invoices or quotes", but a raw inventory item was previously
// only sellable after someone ALSO manually created a curated plan_addons
// row linked to it — nobody would guess that step):
//   • `plan_addons` (GET /plans/addons/catalog) — curated catalog entries,
//     which MAY be backed by an inventory_items row (inventory_item_id set).
//     Entries with inventory_item_id carry `quantity_on_hand` (SUM of stock
//     across the org's warehouses — see Plan.getAddons, migration 390).
//   • `inventory_items` directly (GET /inventory/items?status=active) — any
//     active item NOT already linked by a curated addon (the curated entry
//     wins on overlap; see buildProductPickerEntries' de-dupe).
//
// Picking either kind sends `inventory_item_id` on the line exactly the same
// way (a linked addon and a raw item are indistinguishable to the backend
// once selected) — the line price stays editable either way, and serialized
// items (serial_required) sell by quantity here just like everything else;
// serial assignment is the install flow's job, not the picker's.
// =============================================================================

import { authedFetch } from '@/api/client';

export interface AddonCatalogEntry {
  id: number;
  name: string;
  addon_type?: string;
  price: string | number;
  inventory_item_id: number | null;
  quantity_on_hand: number | string | null;
}

export async function fetchAddonCatalog(): Promise<AddonCatalogEntry[]> {
  const res = await authedFetch('/api/v1/plans/addons/catalog');
  if (!res.ok) throw new Error('Failed to load product catalog');
  const json = await res.json() as { data: AddonCatalogEntry[] };
  return json.data ?? [];
}

export function addonPrice(a: AddonCatalogEntry): string {
  const n = typeof a.price === 'number' ? a.price : parseFloat(a.price || '0');
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

export function addonQuantityOnHand(a: AddonCatalogEntry): number {
  const n = typeof a.quantity_on_hand === 'number' ? a.quantity_on_hand : parseFloat(String(a.quantity_on_hand ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Raw inventory items — GET /inventory/items?status=active
// ---------------------------------------------------------------------------

export interface InventoryItemCatalogEntry {
  id: number;
  name: string;
  sku: string | null;
  sale_price: string | number | null;
  unit_cost: string | number | null;
  quantity_on_hand: number | string | null;
}

// The backend caps this list at 100 rows per page, so a single large-limit
// request silently truncates — an org with >100 active SKUs would lose its
// newest (highest-id) products from the picker, exactly the ones being sold.
// Page through meta.totalPages instead, with a sanity bound.
const SELLABLE_PAGE_LIMIT = 100;
const SELLABLE_MAX_PAGES = 20; // 2000 items — beyond this a dropdown is the wrong UI anyway

export async function fetchSellableInventoryItems(): Promise<InventoryItemCatalogEntry[]> {
  const all: InventoryItemCatalogEntry[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await authedFetch(`/api/v1/inventory/items?status=active&limit=${SELLABLE_PAGE_LIMIT}&page=${page}`);
    if (!res.ok) throw new Error('Failed to load inventory items');
    const json = await res.json() as { data: InventoryItemCatalogEntry[]; meta?: { totalPages?: number } };
    all.push(...(json.data ?? []));
    totalPages = json.meta?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages && page <= SELLABLE_MAX_PAGES);
  return all;
}

function toNumberOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** `sale_price ?? unit_cost ?? 0` formatted as a 2-decimal string, ready for the unit_price input. */
export function inventoryItemPrice(i: InventoryItemCatalogEntry): string {
  const n = toNumberOrNull(i.sale_price) ?? toNumberOrNull(i.unit_cost) ?? 0;
  return n.toFixed(2);
}

export function inventoryItemQuantityOnHand(i: InventoryItemCatalogEntry): number {
  return toNumberOrNull(i.quantity_on_hand) ?? 0;
}

// ---------------------------------------------------------------------------
// Merged picker entries — the actual UNION the <select> renders
// ---------------------------------------------------------------------------

export interface ProductPickerEntry {
  /**
   * Unique <option value>. Addon entries keep a BARE numeric id string
   * (unprefixed) for backward compatibility with existing selection/test
   * behavior; raw-item entries use an `item-<id>` prefix so the two id
   * spaces (plan_addons.id vs inventory_items.id) can never collide.
   */
  value: string;
  label: string;
  /** Formatted 2-decimal price string, ready for the unit_price input. */
  price: string;
  inventory_item_id: number | null;
  /** null = not inventory-linked (a plain curated addon with no stock to show). */
  quantityOnHand: number | null;
}

/**
 * Union the addon catalog with sellable inventory items, hiding any item
 * already linked by an ACTIVE addon (the curated addon entry wins — showing
 * both would let staff pick the "same" product two different ways with two
 * different labels).
 */
export function buildProductPickerEntries(
  catalog: AddonCatalogEntry[],
  items: InventoryItemCatalogEntry[],
): ProductPickerEntry[] {
  const linkedItemIds = new Set(
    catalog.filter(a => a.inventory_item_id != null).map(a => a.inventory_item_id as number),
  );

  const addonEntries: ProductPickerEntry[] = catalog.map(a => ({
    value: String(a.id),
    label: a.name,
    price: addonPrice(a),
    inventory_item_id: a.inventory_item_id ?? null,
    quantityOnHand: a.inventory_item_id ? addonQuantityOnHand(a) : null,
  }));

  const itemEntries: ProductPickerEntry[] = items
    .filter(i => !linkedItemIds.has(i.id))
    .map(i => ({
      value: `item-${i.id}`,
      label: i.sku ? `${i.name} (${i.sku})` : i.name,
      price: inventoryItemPrice(i),
      inventory_item_id: i.id,
      quantityOnHand: inventoryItemQuantityOnHand(i),
    }));

  return [...addonEntries, ...itemEntries];
}
