// =============================================================================
// FireISP 5.0 — Command-palette search tests ("Faro" nav power layer)
// =============================================================================
// The palette index must mirror sidebar visibility exactly (canSee), and the
// search must rank labels above keywords and ignore case/diacritics.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { buildPaletteIndex, resolveRecents, searchPalette } from '@/nav/search';
import type { NavUser } from '@/nav/routes';

const identityT = (key: string) => key;

function indexFor(role: string, locale: 'MX' | 'global' = 'MX') {
  const user: NavUser = { role, organization_locale: locale };
  return buildPaletteIndex(user, identityT);
}

describe('buildPaletteIndex — role/locale visibility mirrors the sidebar', () => {
  it('admin gets everything including the three hub pages', () => {
    const paths = indexFor('admin').map(e => e.path);
    expect(paths).toContain('/billing');
    expect(paths).toContain('/network');
    expect(paths).toContain('/admin');
    expect(paths).toContain('/users');
    expect(paths).toContain('/cfdi');
    expect(paths).toContain('/onu-management');
  });

  it('technician never gets pages that would 403 or NotAllowed', () => {
    const paths = indexFor('technician').map(e => e.path);
    expect(paths).toContain('/work-orders');
    expect(paths).toContain('/tickets'); // mig 394 grant
    expect(paths).toContain('/network'); // their hub
    expect(paths).not.toContain('/users');
    expect(paths).not.toContain('/cfdi');
    expect(paths).not.toContain('/leads');
    expect(paths).not.toContain('/billing'); // hub is billing-only
  });

  it('support gets its kit but no technician-guarded pages', () => {
    const paths = indexFor('support').map(e => e.path);
    expect(paths).toContain('/tickets');
    expect(paths).toContain('/outages');
    expect(paths).not.toContain('/vlans');
    expect(paths).not.toContain('/devices'); // no devices.view — audited
    expect(paths).not.toContain('/network'); // no hub access
  });

  it('non-MX orgs never see SAT/IFT pages', () => {
    const paths = indexFor('admin', 'global').map(e => e.path);
    expect(paths).not.toContain('/cfdi');
    expect(paths).not.toContain('/sat-catalogs');
    expect(paths).toContain('/regulatory-compliance');
  });
});

describe('searchPalette — ranking, keywords, diacritics', () => {
  const user: NavUser = { role: 'admin', organization_locale: 'MX' };
  const LABELS: Record<string, string> = {
    'nav.invoices': 'Facturas',
    'nav.cfdi': 'CFDI',
    'nav.taxRules': 'Reglas de Impuestos',
    'nav.taxRates': 'Tasas de Impuestos',
    'nav.cashReconciliation': 'Corte de Caja',
  };
  const t = (key: string) => LABELS[key] ?? key;
  const index = buildPaletteIndex(user, t);

  it('matches Spanish keywords ("iva" finds the tax pages)', () => {
    const paths = searchPalette(index, 'iva').map(e => e.path);
    expect(paths).toContain('/tax-rules');
    expect(paths).toContain('/tax-rates');
  });

  it('is diacritic- and case-insensitive', () => {
    const paths = searchPalette(index, 'FACTURAS').map(e => e.path);
    expect(paths[0]).toBe('/invoices');
    expect(searchPalette(index, 'facturas').map(e => e.path)[0]).toBe('/invoices');
  });

  it('ranks label prefixes above keyword matches', () => {
    const results = searchPalette(index, 'corte');
    expect(results[0].path).toBe('/cash-reconciliation'); // label "Corte de Caja"
  });

  it('returns nothing for an empty query (palette shows recents instead)', () => {
    expect(searchPalette(index, '   ')).toEqual([]);
  });

  it('caps results at the limit', () => {
    expect(searchPalette(index, 'a', 5).length).toBeLessThanOrEqual(5);
  });
});

describe('resolveRecents', () => {
  it('keeps only paths still visible to the current role, in order', () => {
    const techIndex = indexFor('technician');
    const recents = resolveRecents(techIndex, ['/users', '/work-orders', '/nope', '/tickets']);
    expect(recents.map(e => e.path)).toEqual(['/work-orders', '/tickets']);
  });
});
