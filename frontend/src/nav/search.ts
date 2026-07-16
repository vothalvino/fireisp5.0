// =============================================================================
// FireISP 5.0 — Command-palette search over the nav registry ("Faro" nav)
// =============================================================================
// Pure functions (unit-tested in src/test/navSearch.test.ts). The palette
// indexes exactly what the user's role/locale can see — the same canSee()
// filtering as the sidebar and hub pages — plus the hub overview pages.
// Workspace presets do NOT filter the palette: it is the escape hatch.
// =============================================================================

import {
  ROUTES,
  SECTIONS,
  canSee,
  canSeeHub,
  type NavUser,
  type SectionId,
} from '@/nav/routes';

export interface PaletteEntry {
  path: string;
  /** Translated page label (resolved by the caller — keeps this module pure). */
  label: string;
  /** Translated owning-section label. */
  sectionLabel: string;
  section: SectionId;
  keywords: string;
}

/** Everything this user can reach, in registry order (hub overviews first-class). */
export function buildPaletteIndex(
  user: NavUser,
  t: (key: string) => string,
): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  for (const s of SECTIONS) {
    if (s.kind === 'hub' && canSeeHub(user, s) && s.hubPath) {
      entries.push({
        path: s.hubPath,
        label: t(`nav.hubs.${s.id}.title`),
        sectionLabel: t(s.labelKey),
        section: s.id,
        keywords: '',
      });
    }
  }
  for (const r of ROUTES) {
    const section = SECTIONS.find(s => s.id === r.section);
    if (!section || !canSee(user, r)) continue;
    entries.push({
      path: r.path,
      label: t(r.labelKey),
      sectionLabel: t(section.labelKey),
      section: r.section,
      keywords: (r.keywords ?? []).join(' '),
    });
  }
  return entries;
}

/** Case- and diacritic-insensitive normalization ("Facturación" → "facturacion"). */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Rank: label prefix > label substring > keyword/path/section substring.
 * Empty query returns [] (the palette shows recents instead).
 */
export function searchPalette(index: PaletteEntry[], query: string, limit = 8): PaletteEntry[] {
  const q = norm(query.trim());
  if (!q) return [];
  const scored: { entry: PaletteEntry; score: number }[] = [];
  for (const entry of index) {
    const label = norm(entry.label);
    let score: number | null = null;
    if (label.startsWith(q)) score = 0;
    else if (label.includes(q)) score = 1;
    else if (norm(`${entry.keywords} ${entry.path} ${entry.sectionLabel}`).includes(q)) score = 2;
    if (score !== null) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(s => s.entry);
}

/** Recent paths resolved against the current index (stale/invisible ones drop out). */
export function resolveRecents(index: PaletteEntry[], recentPaths: string[], limit = 5): PaletteEntry[] {
  const byPath = new Map(index.map(e => [e.path, e]));
  const out: PaletteEntry[] = [];
  for (const p of recentPaths) {
    const e = byPath.get(p);
    if (e) out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
