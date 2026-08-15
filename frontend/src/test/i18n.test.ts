// =============================================================================
// FireISP 5.0 — i18n message catalogue tests
// =============================================================================
// Verifies:
//   1. All three locale files parse as valid JSON.
//   2. Every key in en.json exists in es.json and pt-BR.json (no missing translations).
//   3. es.json and pt-BR.json have no orphaned keys absent from en.json.
//   4. Critical translated values match expected strings for each locale.
//   5. Interpolation placeholders ({{name}}, etc.) are present in all locales.
// =============================================================================

import { describe, it, expect } from 'vitest';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';
import ptBR from '@/i18n/locales/pt-BR.json';

// ---------------------------------------------------------------------------
// Helper — flatten nested objects to dot-separated keys
// ---------------------------------------------------------------------------

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(acc, flatten(value as Record<string, unknown>, full));
    } else {
      acc[full] = String(value);
    }
    return acc;
  }, {});
}

const enFlat   = flatten(en as unknown as Record<string, unknown>);
const esFlat   = flatten(es as unknown as Record<string, unknown>);
const ptBrFlat = flatten(ptBR as unknown as Record<string, unknown>);
const enKeys   = Object.keys(enFlat);

// ---------------------------------------------------------------------------
// 1. JSON validity (import above would throw on bad JSON)
// ---------------------------------------------------------------------------

describe('i18n — locale files are valid JSON', () => {
  it('en.json has keys', () => {
    expect(enKeys.length).toBeGreaterThan(50);
  });

  it('es.json has keys', () => {
    expect(Object.keys(esFlat).length).toBeGreaterThan(50);
  });

  it('pt-BR.json has keys', () => {
    expect(Object.keys(ptBrFlat).length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// 2. Coverage — every en.json key exists in es.json and pt-BR.json
// ---------------------------------------------------------------------------

describe('i18n — es.json covers all en.json keys', () => {
  const missingInEs = enKeys.filter(k => !(k in esFlat));

  it('has no missing keys', () => {
    expect(missingInEs).toEqual([]);
  });

  it('key count matches en.json', () => {
    expect(Object.keys(esFlat).length).toBeGreaterThanOrEqual(enKeys.length);
  });
});

describe('i18n — pt-BR.json covers all en.json keys', () => {
  const missingInPtBr = enKeys.filter(k => !(k in ptBrFlat));

  it('has no missing keys', () => {
    expect(missingInPtBr).toEqual([]);
  });

  it('key count matches en.json', () => {
    expect(Object.keys(ptBrFlat).length).toBeGreaterThanOrEqual(enKeys.length);
  });
});

// ---------------------------------------------------------------------------
// 3. No orphaned keys (es / pt-BR keys that don't exist in en)
// ---------------------------------------------------------------------------

describe('i18n — no orphaned keys in es.json', () => {
  const orphans = Object.keys(esFlat).filter(k => !(k in enFlat));
  it('has no orphaned keys', () => {
    expect(orphans).toEqual([]);
  });
});

describe('i18n — no orphaned keys in pt-BR.json', () => {
  const orphans = Object.keys(ptBrFlat).filter(k => !(k in enFlat));
  it('has no orphaned keys', () => {
    expect(orphans).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Critical translated values are correct
// ---------------------------------------------------------------------------

describe('i18n — critical EN values', () => {
  it('login.title is the brand string', () => {
    expect(enFlat['login.title']).toBe('🔥 FireISP 5.0');
  });
  it('common.signIn is "Sign In"', () => {
    expect(enFlat['common.signIn']).toBe('Sign In');
  });
  it('common.signOut is "Sign out"', () => {
    expect(enFlat['common.signOut']).toBe('Sign out');
  });
  it('nav.dashboard is emoji-free (icons are SVGs since the Faro nav)', () => {
    expect(enFlat['nav.dashboard']).toBe('Dashboard');
  });
});

describe('i18n — critical ES values', () => {
  it('common.signIn is not the English value', () => {
    expect(esFlat['common.signIn']).not.toBe(enFlat['common.signIn']);
  });
  it('dashboard.title is "Panel"', () => {
    expect(esFlat['dashboard.title']).toBe('Panel');
  });
  it('portalLogin.subtitle is translated', () => {
    expect(esFlat['portalLogin.subtitle']).not.toBe(enFlat['portalLogin.subtitle']);
  });
});

describe('i18n — critical pt-BR values', () => {
  it('common.signIn is not the English value', () => {
    expect(ptBrFlat['common.signIn']).not.toBe(enFlat['common.signIn']);
  });
  it('dashboard.title is "Painel"', () => {
    expect(ptBrFlat['dashboard.title']).toBe('Painel');
  });
  it('portalLogin.subtitle is translated', () => {
    expect(ptBrFlat['portalLogin.subtitle']).not.toBe(enFlat['portalLogin.subtitle']);
  });
});

describe('i18n — connection records are complete and localized', () => {
  const criticalKeys = [
    'connection_logs.title',
    'connection_logs.sessions.help',
    'connection_logs.attribution.restrictedHelp',
    'connection_logs.attribution.notPersonProof',
    'connection_logs.attribution.results.ambiguous.help',
    'connection_logs.attribution.export.download',
    'connection_logs.attribution.export.error',
    'connection_logs.attribution.export.checksumMismatch',
    'connection_logs.attribution.export.verificationUnavailable',
    'connection_logs.attribution.evidence.activeOpen',
    'connection_logs.columns.terminateCause',
    'connection_logs.terminateCauses.nasReboot',
    'connection_logs.readiness.sessionsGuidance',
    'connection_logs.readiness.attributionGuidance',
    'connection_logs.readiness.attributionRestricted',
    'connection_logs.readiness.health.reported',
    'regulatoryCompliance.accessDenied',
    'regulatoryCompliance.government.help',
    'regulatoryCompliance.government.workflowHelp',
    'regulatoryCompliance.government.startProcessing',
    'regulatoryCompliance.government.rejectReason',
    'regulatoryCompliance.government.releaseHelp',
    'regulatoryCompliance.government.releaseEvidenceHold',
  ];

  for (const key of criticalKeys) {
    it(`localizes ${key} in Spanish and Portuguese`, () => {
      expect(enFlat[key]).toBeTruthy();
      expect(esFlat[key]).toBeTruthy();
      expect(ptBrFlat[key]).toBeTruthy();
      expect(esFlat[key]).not.toBe(enFlat[key]);
      expect(ptBrFlat[key]).not.toBe(enFlat[key]);
    });
  }

  it('preserves duration and readiness interpolation placeholders', () => {
    for (const locale of [enFlat, esFlat, ptBrFlat]) {
      expect(locale['connection_logs.duration.daysHours']).toContain('{{days}}');
      expect(locale['connection_logs.duration.daysHours']).toContain('{{hours}}');
      expect(locale['connection_logs.readiness.coverageValue']).toContain('{{covered}}');
      expect(locale['connection_logs.readiness.coverageValue']).toContain('{{total}}');
      expect(locale['connection_logs.readiness.retentionValue']).toContain('{{months}}');
      expect(locale['connection_logs.attribution.results.ambiguous.help']).toContain('{{count}}');
      expect(locale['connection_logs.attribution.evidence.windowValue']).toContain('{{from}}');
      expect(locale['connection_logs.attribution.evidence.windowValue']).toContain('{{to}}');
      expect(locale['regulatoryCompliance.government.timezoneHelp']).toContain('{{timezone}}');
      expect(locale['regulatoryCompliance.government.releaseSuccess']).toContain('{{count}}');
      expect(locale['connection_logs.attribution.export.checksum']).toContain('{{checksum}}');
    }
  });
});

describe('i18n — DSAR export UI is complete and localized', () => {
  const localizedKeys = [
    'dsarTool.title',
    'dsarTool.intro',
    'dsarTool.form.ariaLabel',
    'dsarTool.form.assemble',
    'dsarTool.form.assembling',
    'dsarTool.form.downloadAria',
    'dsarTool.error',
    'dsarTool.values.yes',
    'dsarTool.values.notReported',
    'dsarTool.summary.ariaLabel',
    'dsarTool.summary.noEmail',
    'dsarTool.scope.ariaLabel',
    'dsarTool.scope.framing',
    'dsarTool.scope.externalSystemsReview',
    'dsarTool.cancellation.ariaLabel',
    'dsarTool.cancellation.framing',
    'dsarTool.cancellation.serverNoticeFallback',
    'dsarTool.table.ariaLabel',
    'dsarTool.table.caption',
    'dsarTool.table.present',
    'dsarTool.sections.connectionLogs',
    'dsarTool.sections.radiusAccountingEvents',
    'dsarTool.sections.radiusAccountingUsageDaily',
    'dsarTool.sections.cgnatAttributionBindings',
    'dsarTool.sections.cgnatAttributionEvents',
  ];

  for (const key of localizedKeys) {
    it(`localizes ${key} in Spanish and Portuguese`, () => {
      expect(enFlat[key]).toBeTruthy();
      expect(esFlat[key]).toBeTruthy();
      expect(ptBrFlat[key]).toBeTruthy();
      expect(esFlat[key]).not.toBe(enFlat[key]);
      expect(ptBrFlat[key]).not.toBe(enFlat[key]);
    });
  }

  it('frames scope and cancellation as bounded review steps in every locale', () => {
    for (const locale of [enFlat, esFlat, ptBrFlat]) {
      expect(locale['dsarTool.scope.framing']).toBeTruthy();
      expect(locale['dsarTool.cancellation.framing']).toBeTruthy();
      expect(locale['dsarTool.scope.framing']).not.toMatch(/every piece of personal data/i);
    }
  });
});

describe('i18n — PPPoE diagnostics operational messages', () => {
  const readinessDetailCodes = [
    'authentication_embedded_not_running',
    'authentication_recent_isolated',
    'authentication_recent_external',
    'authentication_recent_embedded',
    'authentication_waiting_isolated',
    'authentication_waiting_external',
    'authentication_waiting_embedded',
    'authentication_not_configured_isolated',
    'authentication_not_configured',
    'router_none_active',
    'router_all_maintenance',
    'router_none_covered',
    'router_ready_all',
    'router_partial_coverage',
    'router_waiting_no_events',
    'accounting_recent',
    'accounting_embedded_not_running',
    'accounting_waiting',
    'accounting_not_configured_isolated',
    'accounting_not_configured',
  ];

  for (const code of readinessDetailCodes) {
    const key = `pppoe_diagnostics.readiness.details.${code}`;
    it(`localizes readiness detail ${code} in Spanish and Portuguese`, () => {
      expect(enFlat[key]).toBeTruthy();
      expect(esFlat[key]).toBeTruthy();
      expect(ptBrFlat[key]).toBeTruthy();
      expect(esFlat[key]).not.toBe(enFlat[key]);
      expect(ptBrFlat[key]).not.toBe(enFlat[key]);
    });
  }

  it('localizes the MAC-move empty state in all supported locales', () => {
    expect(enFlat['mac_move_events.empty']).toBe('No MAC move events found.');
    expect(esFlat['mac_move_events.empty']).toBe('No se encontraron eventos de movimiento MAC.');
    expect(ptBrFlat['mac_move_events.empty']).toBe('Nenhum evento de mudança de MAC encontrado.');
  });

  it.each([1, 3])('uses count-neutral maintenance coverage wording for %i NAS', (count) => {
    expect(esFlat['pppoe_diagnostics.readiness.maintenance_count'].replace('{{count}}', String(count)))
      .toBe(`NAS excluidos: ${count}`);
    expect(ptBrFlat['pppoe_diagnostics.readiness.maintenance_count'].replace('{{count}}', String(count)))
      .toBe(`NAS excluídos: ${count}`);
    expect(esFlat['pppoe_diagnostics.readiness.details.router_all_maintenance'].replace('{{maintenanceNas}}', String(count)))
      .toContain(`modo de mantenimiento: ${count}`);
    expect(ptBrFlat['pppoe_diagnostics.readiness.details.router_all_maintenance'].replace('{{maintenanceNas}}', String(count)))
      .toContain(`modo de manutenção: ${count}`);
  });
});

describe('i18n — regulatory compliance titles follow the organization locale', () => {
  const locales: Array<[string, Record<string, string>]> = [
    ['en', enFlat],
    ['es', esFlat],
    ['pt-BR', ptBrFlat],
  ];

  for (const [locale, flat] of locales) {
    it(`${locale} has separate generic and Mexico-specific titles`, () => {
      expect(flat['regulatoryCompliance.title']).toBeTruthy();
      expect(flat['regulatoryCompliance.title']).not.toMatch(/M[eé]xico/i);
      expect(flat['regulatoryCompliance.titleMx']).toMatch(/M[eé]xico/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Interpolation placeholders are consistent across locales
// ---------------------------------------------------------------------------

// Keys known to contain interpolation placeholders — all locales must preserve them
const INTERPOLATED_KEYS: Array<{ key: string; placeholders: string[] }> = [
  { key: 'dashboard.welcome',                       placeholders: ['{{name}}'] },
  { key: 'dashboard.kpi.totalClients',              placeholders: ['{{total}}'] },
  { key: 'dashboard.kpi.activeContracts',           placeholders: ['{{count}}'] },
  { key: 'dashboard.kpi.outstanding',               placeholders: ['{{amount}}'] },
  { key: 'dashboard.kpi.totalTickets',              placeholders: ['{{total}}'] },
  { key: 'dashboard.kpi.deviceCountLatency',        placeholders: ['{{count}}', '{{latency}}'] },
  { key: 'dashboard.kpi.deviceCountNoSnapshot',     placeholders: ['{{count}}'] },
  { key: 'dashboard.overdueTable.daysFormat',       placeholders: ['{{days}}'] },
  { key: 'dashboard.overdueMore',                   placeholders: ['{{total}}'] },
  { key: 'drDrill.failed.headline',                 placeholders: ['{{date}}'] },
  { key: 'drDrill.failed.detailWithReason',         placeholders: ['{{reason}}'] },
  { key: 'drDrill.overdue.headline',                placeholders: ['{{days}}', '{{date}}'] },
  { key: 'portalDashboard.welcome',                 placeholders: ['{{name}}'] },
  { key: 'portalLayout.footer',                     placeholders: ['{{year}}'] },
  { key: 'clientList.pageInfo',                     placeholders: ['{{page}}', '{{total}}'] },
];

describe('i18n — interpolation placeholders are preserved in all locales', () => {
  const locales: Array<[string, Record<string, string>]> = [
    ['en', enFlat],
    ['es', esFlat],
    ['pt-BR', ptBrFlat],
  ];

  for (const { key, placeholders } of INTERPOLATED_KEYS) {
    for (const [locale, flat] of locales) {
      it(`${locale} — "${key}" contains ${placeholders.join(', ')}`, () => {
        const value = flat[key];
        expect(value, `key "${key}" missing in ${locale}`).toBeDefined();
        for (const ph of placeholders) {
          expect(value, `placeholder "${ph}" missing in ${locale} for key "${key}"`).toContain(ph);
        }
      });
    }
  }
});
