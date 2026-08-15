'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('legal and regulatory touchpoint register', () => {
  const register = read('docs/legal-regulatory-register.md');
  const readme = read('README.md');
  const featureList = read('isp-platform-features.md');
  const iftSchemaReview = read('docs/ift-statistical-report-schema-review.md');

  test('states its assurance boundary and review dates', () => {
    expect(register).toMatch(/not legal advice/i);
    expect(register).toMatch(/not (?:a )?(?:legal )?certification/i);
    expect(register).toMatch(/coverage (?:cutoff|as of)[^\n]*2026-08-15/i);
    expect(register).toMatch(/next (?:scheduled )?review[^\n]*2026-11-15/i);
    expect(register).not.toMatch(/\bCompliant\s*:\s*Yes\b/i);
  });

  test('defines controlled status vocabularies instead of a compliance checkbox', () => {
    expect(register).toMatch(/applicability (?:status|vocabulary)/i);
    expect(register).toMatch(/product (?:posture|status|vocabulary)/i);
    expect(register).toMatch(/deployment (?:validation|status|vocabulary)/i);
    expect(register).toMatch(/risk (?:level|status|vocabulary)/i);

    const vocabularies = {
      applicability: [
        'UNASSESSED',
        'CONDITIONAL',
        'APPLICABLE',
        'NOT_APPLICABLE',
        'SUPERSEDED',
      ],
      product: [
        'CAPABILITY_AVAILABLE',
        'PARTIAL',
        'NOT_SUPPORTED',
        'OPERATOR_ONLY',
        'NOT_ASSESSED',
      ],
      deployment: [
        'NOT_EVALUATED',
        'GAP',
        'IMPLEMENTING',
        'READY_FOR_VALIDATION',
        'VALIDATED',
        'ACCEPTED_RISK',
        'NOT_APPLICABLE',
      ],
      risk: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'MONITOR', 'UNASSESSED'],
    };

    for (const values of Object.values(vocabularies)) {
      for (const value of values) {
        expect(register).toContain(value);
      }
    }
  });

  test('anchors each major Mexican legal domain to an official primary source', () => {
    const primarySources = [
      ['LMTR', 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LMTR.pdf'],
      ['LFPDPPP', 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf'],
      ['CFF', 'https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf'],
      ['LFPC', 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf'],
      ['Código de Comercio', 'https://www.diputados.gob.mx/LeyesBiblio/pdf/CCom.pdf'],
      ['CNPP', 'https://www.diputados.gob.mx/LeyesBiblio/pdf/CNPP.pdf'],
      [
        'NOM-184-SCFI-2018',
        'https://www.dof.gob.mx/nota_detalle.php?codigo=5552286&fecha=08/03/2019',
      ],
      [
        'NOM-151-SCFI-2016',
        'https://www.dof.gob.mx/nota_detalle.php?codigo=5478024&fecha=30/03/2017',
      ],
    ];

    for (const [name, url] of primarySources) {
      expect(register).toContain(name);
      expect(register).toContain(url);
    }
  });

  test('uses stable requirement IDs across every tracked compliance domain', () => {
    const domainIdPatterns = [
      /\bMX-TEL-\d{3}\b/,
      /\bMX-PRIV-\d{3}\b/,
      /\bMX-TAX-\d{3}\b/,
      /\bMX-CONS-\d{3}\b/,
      /\bMX-(?:COMM|EREC)-\d{3}\b/,
      /\bMX-SEC-\d{3}\b/,
      /\bMX-AI-\d{3}\b/,
      /\bMX-(?:LAB|LABOR)-\d{3}\b/,
      /\b(?:EU|INTL)-(?:PRIV|GDPR)-\d{3}\b/,
    ];

    for (const pattern of domainIdPatterns) {
      expect(register).toMatch(pattern);
    }
  });

  test('links the detailed implementation and operating guides', () => {
    const specialistDocuments = [
      'compliance-mexico.md',
      'privacy.md',
      'connection-logging-compliance.md',
      'cfdi-sandbox-testing.md',
      'ift-statistical-report-schema-review.md',
    ];

    for (const document of specialistDocuments) {
      expect(register).toContain(document);
    }
  });

  test('keeps gaps and legal changes explicit and auditable', () => {
    expect(register).toMatch(/#{2,}\s+(?:known[- ]gap register|known gaps?)/i);
    expect(register).toMatch(/legal change workflow/i);
    expect(register).toMatch(/append-only/i);
    expect(register).toMatch(/change log/i);
    expect(register).toMatch(/effective date/i);
    expect(register).toMatch(/affected (?:requirement )?IDs?/i);
    expect(register).toMatch(/deployment validation/i);
  });

  test('is discoverable from the main documentation entry points', () => {
    for (const entryPoint of [readme, featureList]) {
      expect(entryPoint).toContain('docs/legal-regulatory-register.md');
    }
  });

  test('marks the old IFT schema citation as historical and requiring revalidation', () => {
    expect(iftSchemaReview).toContain('legal-regulatory-register.md');
    expect(iftSchemaReview).toMatch(/\b(?:stale|historical|legacy)\b/i);
    expect(iftSchemaReview).toMatch(/\b(?:former|abrogated|superseded)\b/i);
    expect(iftSchemaReview).toMatch(/revalidat|current-law verification/i);
  });
});
