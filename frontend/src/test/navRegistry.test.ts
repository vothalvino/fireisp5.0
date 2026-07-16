// =============================================================================
// FireISP 5.0 — Nav registry invariants ("Faro" nav)
// =============================================================================
// Kills the URL-only-page bug class forever:
//   • every staff path routed in App.tsx has exactly one home in the registry
//   • every registry entry is actually routed (no dead nav rows)
//   • every entry is reachable — sidebar rail and/or hub card
//   • the registry `guard` mirrors the PrivateRoute wrapper in App.tsx, so
//     canSee() can never show a row that would render <NotAllowed/>
//   • every i18n key the nav consumes exists in all three locales
// =============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUB_CARDS, ROUTES, SECTIONS, WORKSPACES, type Guard } from '@/nav/routes';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';
import ptBR from '@/i18n/locales/pt-BR.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');

// Public/portal paths and the fallbacks are not staff nav destinations.
const IGNORED = new Set(['login', 'forgot-password', 'reset-password', 'verify-email', '404', '*']);

/** Parse App.tsx into (path → guard) using the PrivateRoute wrapper structure. */
function routedPaths(): Map<string, Guard> {
  const result = new Map<string, Guard>();
  let guard: Guard | 'portal' | null = null;
  for (const line of appSrc.split('\n')) {
    const wrapper = line.match(/<Route element={<(PrivateRoute|PortalRoute)(?:\s+requiredRole="(\w+)")?\s*\/>}>/);
    if (wrapper) {
      guard = wrapper[1] === 'PortalRoute' ? 'portal' : ((wrapper[2] as Guard) ?? 'any');
      continue;
    }
    const m = line.match(/<Route path="([^"]+)"/);
    if (!m) continue;
    const p = m[1];
    if (guard === 'portal' || p.startsWith('portal')) continue;
    if (IGNORED.has(p) || p.includes(':')) continue;
    if (guard === null) continue; // public routes before the wrappers
    result.set(`/${p}`, guard);
  }
  return result;
}

const HUB_PATHS: Record<string, string> = { '/billing': 'billing', '/network': 'network', '/admin': 'admin' };

describe('nav registry ↔ App.tsx invariants', () => {
  const routed = routedPaths();

  it('parses a plausible number of staff routes from App.tsx', () => {
    expect(routed.size).toBeGreaterThan(100);
  });

  it('has no duplicate paths in the registry', () => {
    const seen = new Set<string>();
    for (const r of ROUTES) {
      expect(seen.has(r.path), `duplicate registry entry for ${r.path}`).toBe(false);
      seen.add(r.path);
    }
  });

  it('every staff path routed in App.tsx has exactly one nav home', () => {
    for (const [p] of routed) {
      if (HUB_PATHS[p]) continue; // hub landing pages are section headers, not items
      const matches = ROUTES.filter(r => r.path === p);
      expect(matches.length, `route ${p} must appear exactly once in the nav registry`).toBe(1);
    }
  });

  it('every registry entry is actually routed in App.tsx', () => {
    for (const r of ROUTES) {
      expect(routed.has(r.path), `registry entry ${r.path} is not routed in App.tsx`).toBe(true);
    }
  });

  it('registry guards mirror the App.tsx PrivateRoute wrappers', () => {
    for (const r of ROUTES) {
      expect(routed.get(r.path), `guard mismatch for ${r.path}`).toBe(r.guard);
    }
  });

  it('hub landing pages are routed with the guard their section declares', () => {
    for (const [p, sectionId] of Object.entries(HUB_PATHS)) {
      const section = SECTIONS.find(s => s.id === sectionId);
      expect(section?.kind).toBe('hub');
      expect(section?.hubPath).toBe(p);
      expect(routed.get(p), `hub ${p} guard must match SECTIONS.hubGuard`).toBe(section?.hubGuard);
    }
  });

  it('every registry entry is reachable (rail row and/or hub card)', () => {
    for (const r of ROUTES) {
      expect(
        Boolean(r.rail || r.card),
        `${r.path} is neither a rail row nor on a hub card — unreachable`,
      ).toBe(true);
    }
  });

  it('every card id is declared in HUB_CARDS for its section', () => {
    for (const r of ROUTES) {
      if (!r.card) continue;
      expect(
        HUB_CARDS[r.section] ?? [],
        `${r.path} uses card "${r.card}" missing from HUB_CARDS.${r.section}`,
      ).toContain(r.card);
    }
  });
});

describe('nav registry i18n coverage', () => {
  type Dict = Record<string, unknown>;
  function lookup(dict: Dict, dotted: string): unknown {
    return dotted.split('.').reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k as keyof Dict], dict);
  }

  const locales: [string, Dict][] = [
    ['en', en as Dict],
    ['es', es as Dict],
    ['pt-BR', ptBR as Dict],
  ];

  it('every nav i18n key exists in all three locales', () => {
    const keys = new Set<string>();
    for (const s of SECTIONS) keys.add(s.labelKey);
    for (const r of ROUTES) {
      keys.add(r.labelKey);
      if (r.sub) keys.add(`nav.subsections.${r.sub}`);
      if (r.card) keys.add(`nav.cards.${r.card}`);
    }
    keys.add('nav.viewAll');
    keys.add('nav.hubs.empty');
    keys.add('nav.toggleSection');
    for (const w of WORKSPACES) keys.add(w.labelKey);
    for (const k of ['title', 'placeholder', 'searchButton', 'noResults', 'hint']) keys.add(`nav.palette.${k}`);
    keys.add('nav.workspaces.label');
    for (const hub of Object.values(SECTIONS).filter(s => s.kind === 'hub')) {
      keys.add(`nav.hubs.${hub.id}.title`);
      keys.add(`nav.hubs.${hub.id}.hint`);
    }
    for (const [name, dict] of locales) {
      for (const key of keys) {
        expect(typeof lookup(dict, key), `${name} is missing ${key}`).toBe('string');
      }
    }
  });
});
