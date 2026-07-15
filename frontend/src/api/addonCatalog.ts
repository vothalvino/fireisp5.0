// =============================================================================
// FireISP 5.0 — Product/add-on catalog fetch (Inventory Phase 2)
// =============================================================================
// Shared by InvoiceDetail.tsx and QuoteDetail.tsx's "Add Item" product
// pickers. GET /plans/addons/catalog returns plan_addons rows; entries with
// inventory_item_id set are physical-stock-backed products and carry
// quantity_on_hand (SUM of stock across the org's warehouses — see
// Plan.getAddons, migration 390).
//
// Uses the raw authed fetch (same pattern as GenerateInvoiceModal.tsx's
// fetchAddonCatalog) rather than the typed openapi-fetch client — the spec
// documents this path generically ({type:'object'} response, matching this
// codebase's OpenAPI generation pattern), so there is no typed response
// shape to gain from the generated client here.
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
