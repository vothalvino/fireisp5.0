// =============================================================================
// FireISP 5.0 — Per-persona nav resolution ("Faro" nav)
// =============================================================================
// Locks the resolved sidebar for each role to the permission audit performed
// for the redesign (role_permissions seeds in migrations 119/194/197/199/365/
// 377/393). If a change here surprises you, re-run the audit before updating
// the expectation — a row a role can see must never 403.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  SECTIONS,
  canSeeHub,
  defaultExpandedSection,
  sectionForPath,
  visibleHubCards,
  visibleRailItems,
  visibleSectionCount,
  type NavUser,
  type SectionId,
} from '@/nav/routes';

function resolve(role: string, locale: 'MX' | 'global' = 'MX') {
  const user: NavUser = { role, organization_locale: locale };
  const out: Record<string, { items: string[]; hub: boolean; count: number }> = {};
  for (const s of SECTIONS) {
    if (s.kind === 'link') continue;
    const items = visibleRailItems(user, s.id).map(r => r.path);
    const hub = canSeeHub(user, s);
    if (items.length === 0 && !hub) continue;
    out[s.id] = { items, hub, count: visibleSectionCount(user, s.id) };
  }
  return out;
}

describe('admin', () => {
  const nav = resolve('admin');
  it('sees all eight grouped sections', () => {
    expect(Object.keys(nav).sort()).toEqual(
      ['admin', 'billing', 'clients', 'compliance', 'fieldops', 'inventory', 'network', 'support'].sort(),
    );
  });
  it('sees the three hub links', () => {
    expect(nav.billing.hub).toBe(true);
    expect(nav.network.hub).toBe(true);
    expect(nav.admin.hub).toBe(true);
  });
  it('compliance collapses to the one non-MX item for non-Mexico orgs', () => {
    const global = resolve('admin', 'global');
    expect(global.compliance.items).toEqual(['/regulatory-compliance']);
    expect(global.billing.items).not.toContain('/cfdi');
  });
  it('opens Clients by default', () => {
    expect(defaultExpandedSection('admin')).toBe('clients');
  });
});

describe('technician', () => {
  const nav = resolve('technician');
  it('sees exactly clients, support, fieldops, network, inventory', () => {
    expect(Object.keys(nav).sort()).toEqual(['clients', 'fieldops', 'inventory', 'network', 'support'].sort());
  });
  it('never sees pages the technician role 403s on (leads/surveys — audit)', () => {
    const all = Object.values(nav).flatMap(s => s.items);
    expect(all).not.toContain('/leads');
    expect(all).not.toContain('/satisfaction-surveys');
    expect(all).not.toContain('/quotes');
  });
  it('gets tickets (all categories except billing) and the NOC dashboard — mig 394 grants', () => {
    expect(nav.support.items).toEqual([
      '/tickets',
      '/escalations',
      '/follow-up-reminders',
      '/communication-campaigns',
    ]);
    expect(nav.network.items).toContain('/noc-dashboard');
  });
  it('gets the full field kit', () => {
    expect(nav.fieldops.items).toEqual([
      '/work-orders',
      '/maintenance-windows',
      '/sites',
      '/coverage-zones',
      '/service-areas',
    ]);
    expect(nav.inventory.items).toHaveLength(6);
    expect(nav.network.items).toContain('/devices');
    expect(nav.network.hub).toBe(true);
    // the network long tail (previously URL-only pages included) is one click away
    expect(nav.network.count).toBeGreaterThan(40);
  });
  it('sees no billing, compliance or admin', () => {
    expect(nav.billing).toBeUndefined();
    expect(nav.compliance).toBeUndefined();
    expect(nav.admin).toBeUndefined();
  });
});

describe('billing', () => {
  const nav = resolve('billing');
  it('sees exactly clients, billing, support, network(my tunnels), compliance', () => {
    expect(Object.keys(nav).sort()).toEqual(['billing', 'clients', 'compliance', 'network', 'support'].sort());
  });
  it('keeps every daily billing verb on the rail', () => {
    expect(nav.billing.items).toEqual([
      '/invoices',
      '/payments',
      '/cfdi',
      '/credit-notes',
      '/cash-reconciliation',
      '/plans',
      '/billing-disputes',
      '/reports',
    ]);
    expect(nav.billing.hub).toBe(true);
    expect(nav.billing.count).toBe(23); // full billing family incl. demoted config pages
  });
  it('gets retention + quotes in Clients', () => {
    expect(nav.clients.items).toContain('/quotes');
    expect(nav.clients.items).toContain('/churn-analytics');
  });
  it('gets escalations (mig 394) but still no tickets (no tickets.view — audit)', () => {
    expect(nav.support.items).toEqual([
      '/escalations',
      '/follow-up-reminders',
      '/communication-campaigns',
      '/satisfaction-surveys',
    ]);
  });
  it('network is only the personal tunnels row, without a View-all', () => {
    expect(nav.network.items).toEqual(['/wg-tunnels']);
    expect(nav.network.hub).toBe(false);
  });
});

describe('support', () => {
  const nav = resolve('support');
  it('sees exactly clients, support, network', () => {
    expect(Object.keys(nav).sort()).toEqual(['clients', 'network', 'support'].sort());
  });
  it('owns the full support kit', () => {
    expect(nav.support.items).toEqual([
      '/tickets',
      '/escalations',
      '/follow-up-reminders',
      '/communication-campaigns',
      '/satisfaction-surveys',
    ]);
  });
  it('gets the "is it down?" network subset — not the device map (no devices.view — audit)', () => {
    expect(nav.network.items).toEqual(['/network-health', '/outages', '/wg-tunnels']);
    expect(nav.network.hub).toBe(false);
  });
});

describe('readonly', () => {
  const nav = resolve('readonly');
  it('sees every any-auth page, organized (never a guard-blocked row)', () => {
    expect(Object.keys(nav).sort()).toEqual(['billing', 'clients', 'network', 'support'].sort());
    expect(nav.billing.items).toEqual(['/invoices', '/payments']);
    expect(nav.support.items).toHaveLength(5);
    expect(nav.network.items).toEqual(['/devices', '/network-health', '/outages', '/wg-tunnels']);
  });
  it('never sees hub links (their routes are guard-blocked for readonly)', () => {
    for (const s of Object.values(nav)) expect(s.hub).toBe(false);
  });
  it('never sees items behind technician/billing/admin route guards', () => {
    const all = Object.values(nav).flatMap(s => s.items);
    expect(all).not.toContain('/cfdi');
    expect(all).not.toContain('/work-orders');
    expect(all).not.toContain('/users');
  });
});

describe('shared behaviour', () => {
  it('no route appears twice in any persona rail', () => {
    for (const role of ['admin', 'technician', 'billing', 'support', 'readonly']) {
      const all = Object.values(resolve(role)).flatMap(s => s.items);
      expect(new Set(all).size, `${role} rail has duplicates`).toBe(all.length);
    }
  });
  it('active trail resolves detail pages to their owning section', () => {
    expect(sectionForPath('/clients/35')).toBe('clients');
    expect(sectionForPath('/admin/user-tunnels')).toBe('admin');
    expect(sectionForPath('/network')).toBe('network');
    expect(sectionForPath('/onu-management')).toBe('network');
    expect(sectionForPath('/')).toBe('dashboard');
  });
  it('the View-all count equals what the hub page actually renders', () => {
    for (const role of ['admin', 'technician', 'billing']) {
      const user: NavUser = { role, organization_locale: 'MX' };
      for (const s of SECTIONS.filter(x => x.kind === 'hub')) {
        if (!canSeeHub(user, s)) continue;
        const cardTotal = visibleHubCards(user, s.id).reduce((n, c) => n + c.items.length, 0);
        expect(visibleSectionCount(user, s.id), `${role} ${s.id} View-all count vs hub content`).toBe(cardTotal);
      }
    }
  });
  it('every persona has a sensible default-open section', () => {
    const ids: (SectionId | null)[] = ['admin', 'technician', 'billing', 'support', 'readonly'].map(
      defaultExpandedSection,
    );
    expect(ids).toEqual(['clients', 'fieldops', 'billing', 'support', null]);
  });
});
