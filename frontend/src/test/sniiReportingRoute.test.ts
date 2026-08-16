// =============================================================================
// FireISP 5.0 — SNII App/nav/i18n integration contract
// =============================================================================
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canSee, ROUTES, visibleRailItems } from '@/nav/routes';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';
import ptBR from '@/i18n/locales/pt-BR.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
const route = ROUTES.find(item => item.path === '/snii-infrastructure');

describe('SNII App and navigation registration', () => {
  it('registers one App route backed by the SNII preparation page', () => {
    expect(appSource).toContain(
      "import { SniiInfrastructureReportingPage } from '@/pages/SniiInfrastructureReportingPage';",
    );
    expect(appSource.match(/<Route path="snii-infrastructure" element={<SniiInfrastructureReportingPage \/>} \/>/g))
      .toHaveLength(1);
  });

  it('keeps the nav entry MX-only and permission-bound', () => {
    expect(route).toMatchObject({
      labelKey: 'nav.sniiInfrastructure',
      section: 'compliance',
      guard: 'any',
      sub: 'ift',
      rail: true,
      requiredLocale: 'MX',
      requiredAnyPermissions: ['snii_reporting.view'],
    });
  });

  it('shows the nav row only to an MX principal with the view permission', () => {
    expect(route).toBeDefined();
    const permittedMx = {
      role: 'support',
      organization_locale: 'MX',
      permissions: ['snii_reporting.view'],
    };
    expect(canSee(permittedMx, route!)).toBe(true);
    expect(visibleRailItems(permittedMx, 'compliance').map(item => item.path))
      .toContain('/snii-infrastructure');

    expect(canSee({ ...permittedMx, permissions: [] }, route!)).toBe(false);
    expect(canSee({ ...permittedMx, organization_locale: 'global' }, route!)).toBe(false);
    expect(visibleRailItems({ ...permittedMx, permissions: [] }, 'compliance').map(item => item.path))
      .not.toContain('/snii-infrastructure');
    expect(visibleRailItems({ ...permittedMx, organization_locale: 'global' }, 'compliance').map(item => item.path))
      .not.toContain('/snii-infrastructure');
  });
});

describe('SNII locale contract', () => {
  const locales = [
    ['en', en],
    ['es', es],
    ['pt-BR', ptBR],
  ] as const;

  it.each(locales)('has the complete safety-critical wording in %s', (_name, locale) => {
    expect(locale.nav.sniiInfrastructure).toBeTruthy();
    expect(locale.sniiReporting.title).toBeTruthy();
    expect(locale.sniiReporting.preparationOnly).toBeTruthy();
    expect(locale.sniiReporting.mxOnly).toBeTruthy();
    expect(locale.sniiReporting.subtitle).toBeTruthy();
    expect(locale.sniiReporting.inventory.boundary).toBeTruthy();
    expect(locale.sniiReporting.packages.truthBoundary).toBeTruthy();
    expect(locale.sniiReporting.packages.truthHelp).toBeTruthy();
    expect(locale.sniiReporting.errors.checksumMissing).toBeTruthy();
    expect(locale.sniiReporting.errors.checksumMismatch).toBeTruthy();
    expect(locale.sniiReporting.downloadVerified).toContain('{{hash}}');
  });

  it('preserves the explicit English preparation, filing and CPE boundaries', () => {
    expect(en.sniiReporting.subtitle).toMatch(/does not submit to the CRT or certify legal compliance/i);
    expect(en.sniiReporting.inventory.boundary).toMatch(/Customer CPE, ONUs, drops, dummy assets/);
    expect(en.sniiReporting.inventory.boundary).toMatch(/never auto-included/);
    expect(en.sniiReporting.packages.truthBoundary).toBe('Generation is not filing');
    expect(en.sniiReporting.packages.truthHelp).toMatch(/separate states/);
    expect(en.sniiReporting.packages.truthHelp).toMatch(/authorized representative verifies and files them/);
    expect(en.sniiReporting.packages.truthHelp).toMatch(/operator-recorded evidence/);
    expect(en.sniiReporting.packages.truthHelp).toMatch(/not verification by FireISP or the authority/);
  });

  it('does not silently fall back to English for the Spanish or Portuguese safety copy', () => {
    for (const locale of [es, ptBR]) {
      expect(locale.nav.sniiInfrastructure).not.toBe(en.nav.sniiInfrastructure);
      expect(locale.sniiReporting.preparationOnly).not.toBe(en.sniiReporting.preparationOnly);
      expect(locale.sniiReporting.mxOnly).not.toBe(en.sniiReporting.mxOnly);
      expect(locale.sniiReporting.subtitle).not.toBe(en.sniiReporting.subtitle);
      expect(locale.sniiReporting.inventory.boundary).not.toBe(en.sniiReporting.inventory.boundary);
      expect(locale.sniiReporting.packages.truthBoundary).not.toBe(en.sniiReporting.packages.truthBoundary);
      expect(locale.sniiReporting.errors.checksumMismatch).not.toBe(en.sniiReporting.errors.checksumMismatch);
    }
  });
});
