'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const service = require('../src/services/sniiReportingService');

const CATALOG = service.getCatalog();

function frozenContract(slug) {
  const source = CATALOG.element_types.find(item => item.slug === slug);
  return Object.fromEntries([
    'slug', 'label', 'geometry', 'periodicity', 'official_template_filename',
    'official_filenames', 'preparation_filename', 'generated_format',
    'wire_headers', 'required_headers',
    'catalog_values', 'field_constraints', 'validation_supported',
    'preparation_supported',
  ].map(field => [field, source[field]]));
}

function currentProfile(overrides = {}) {
  const reviewedAt = new Date().toISOString();
  return {
    id: 9,
    subject_applicability: 'applicable',
    applicability_basis: 'Reviewed concession and service scope',
    external_decision_reference: 'LEGAL-SNII-2026-001',
    applicability_decided_by: 18,
    applicability_decided_at: reviewedAt,
    official_sources_reviewed_by: 17,
    official_sources_reviewed_at: reviewedAt,
    source_freshness_days: 180,
    source_channel: 'crt_ventanilla_current',
    source_attestation_reference: 'CURRENT-CRT-PORTAL-REVIEW',
    adapter_reconciliation_reference: 'ADAPTER-TO-CURRENT-PACKAGE-REVIEW',
    adapter_reconciliation_sha256: 'd'.repeat(64),
    adapter_catalog_version: CATALOG.catalog_version,
    adapter_reconciled_by: 17,
    adapter_reconciled_at: reviewedAt,
    template_version: 'current-template',
    template_source_url: 'https://authority.test/current-template',
    template_sha256: 'a'.repeat(64),
    dictionary_version: 'current-dictionary',
    dictionary_source_url: 'https://authority.test/current-dictionary',
    dictionary_sha256: 'b'.repeat(64),
    annex_v_version: 'current-annex-v',
    annex_v_source_url: 'https://authority.test/current-annex-v',
    annex_v_sha256: 'c'.repeat(64),
    legal_basis: 'LMTR_ARTICLES_174_181',
    electronic_folio: 'CRT-E-123',
    ...overrides,
  };
}

function frozenBatch(profile, overrides = {}) {
  const elementTypes = overrides.element_types_snapshot || ['torre'];
  const elementContracts = overrides.element_contract_snapshot
    || elementTypes.map(frozenContract);
  const applicability = overrides.applicability || reviewedApplicability();
  const batch = {
    id: 30,
    organization_id: 41,
    profile_id: profile.id,
    concession_title_id: profile.concession_title_id ?? null,
    concession_title_snapshot: profile.concession_title_snapshot ?? null,
    concession_title_sha256: profile.concession_title_sha256 ?? null,
    supersedes_batch_id: null,
    correction_root_batch_id: null,
    supersession_reason: null,
    period_start: '2026-01-01',
    period_end: '2026-12-31',
    filing_kind: 'initial',
    filing_window: 'initial',
    filing_year: 2026,
    filing_frequency: 'initial',
    full_load: 1,
    revision_no: 1,
    status: 'draft',
    catalog_version: CATALOG.catalog_version,
    element_types_snapshot: elementTypes,
    element_contract_snapshot: elementContracts,
    applicability_snapshot: service._test.buildApplicabilitySnapshot(profile, applicability),
    created_by: 18,
    ...Object.fromEntries([
      'source_channel', 'source_attestation_reference',
      'official_sources_reviewed_by', 'official_sources_reviewed_at',
      'source_freshness_days',
      'adapter_reconciliation_reference', 'adapter_reconciliation_sha256',
      'adapter_catalog_version', 'adapter_reconciled_by', 'adapter_reconciled_at',
      'template_version', 'template_source_url', 'template_sha256', 'template_effective_date',
      'dictionary_version', 'dictionary_source_url', 'dictionary_sha256',
      'annex_v_version', 'annex_v_source_url', 'annex_v_sha256',
      'legal_basis', 'electronic_folio',
    ].map(field => [field, profile[field] ?? null])),
    ...overrides,
  };
  const snapshotHash = service._test.computeBatchSnapshotHash(batch, overrides.items || []);
  return {
    ...batch,
    element_types_snapshot: service._test.stableStringify(batch.element_types_snapshot),
    element_contract_snapshot: service._test.stableStringify(batch.element_contract_snapshot),
    snapshot_hash: snapshotHash,
  };
}

function reviewedApplicability(onlyApplicable = 'torre') {
  const reviewedAt = '2026-08-10T18:00:00.000Z';
  return CATALOG.element_types.map(item => ({
    element_type: item.slug,
    applicability: item.slug === onlyApplicable ? 'applicable' : 'not_applicable',
    rationale: item.slug === onlyApplicable ? 'Infrastructure is operated' : 'Object is not operated',
    population_status: item.slug === onlyApplicable ? 'zero_population' : 'unreviewed',
    population_evidence_reference: item.slug === onlyApplicable ? 'ZERO-POP-REVIEW' : null,
    population_reviewed_by: item.slug === onlyApplicable ? 18 : null,
    population_reviewed_at: item.slug === onlyApplicable ? reviewedAt : null,
    reviewed_by: 18,
    reviewed_at: reviewedAt,
  }));
}

function concessionTitle(overrides = {}) {
  return {
    id: 22,
    title_number: 'CRT-TITLE-22',
    concession_type: 'commercial',
    services_authorized: JSON.stringify(['internet']),
    geographic_scope: 'Chihuahua',
    spectrum_bands: null,
    granted_date: '2024-01-01',
    expiration_date: null,
    renewal_filed_at: null,
    regulatory_body: 'CRT',
    document_file_id: 77,
    status: 'active',
    ...overrides,
  };
}

function profileBody(overrides = {}) {
  return {
    concession_title_id: 22,
    electronic_folio: 'CRT-NEW-22',
    source_channel: 'crt_ventanilla_current',
    source_attestation_reference: 'CRT-CURRENT-2026-08',
    adapter_reconciliation_reference: 'ADAPTER-REVIEW-2026-08',
    adapter_reconciliation_sha256: 'd'.repeat(64),
    adapter_reconciled_at: '2026-08-15T12:00:00.000-06:00',
    template_version: 'CRT-template-2026-08',
    template_source_url: 'https://authority.test/template',
    template_sha256: 'a'.repeat(64),
    template_effective_date: '2026-08-01',
    dictionary_version: 'CRT-dictionary-2026-08',
    dictionary_source_url: 'https://authority.test/dictionary',
    dictionary_sha256: 'b'.repeat(64),
    annex_v_version: 'CRT-annex-v-2026-08',
    annex_v_source_url: 'https://authority.test/annex-v',
    annex_v_sha256: 'c'.repeat(64),
    official_sources_reviewed_at: '2026-08-15T11:00:00.000-06:00',
    source_freshness_days: 180,
    ...overrides,
  };
}

function result(rows = []) {
  return Promise.resolve([rows, []]);
}

function transactionWith(handler) {
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(handler),
  };
  db.getConnection.mockResolvedValue(connection);
  return connection;
}

function context(actorId = 17) {
  return {
    actorId,
    ipAddress: '192.0.2.10',
    userAgent: 'jest-security-gate/1',
  };
}

function filingBody(overrides = {}) {
  return {
    event_type: 'submitted',
    attempt_no: 1,
    occurred_at: '2026-08-15T12:30:00.000-06:00',
    occurred_timezone: 'America/Chihuahua',
    authority_reference: 'CRT-VENTANILLA-001',
    notes: 'Operator-recorded filing',
    ...overrides,
  };
}

function evidenceFile(bytes = Buffer.from('CRT receipt evidence\n', 'utf8'), overrides = {}) {
  return {
    originalname: 'acuse.pdf',
    mimetype: 'application/pdf',
    buffer: bytes,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SNII operational inventory tenant boundary', () => {
  test('requires an explicit reviewed population decision for every applicable object type', async () => {
    await expect(service.setApplicability(41, 17, 'torre', {
      status: 'applicable',
      rationale: 'We operate tower infrastructure',
    }, context())).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });

    await expect(service.setApplicability(41, 17, 'torre', {
      status: 'applicable',
      rationale: 'No towers in this filing period',
      population_status: 'zero_population',
    }, context())).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });

    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('a prepare-only profile identity change invalidates every prior applicability review', async () => {
    const existing = {
      id: 9,
      concession_title_id: 12,
      electronic_folio: 'CRT-OLD-12',
      subject_applicability: 'applicable',
      applicability_basis: 'Prior title review',
      external_decision_reference: 'LEGAL-OLD-12',
      applicability_decided_by: 88,
      applicability_decided_at: new Date('2026-08-01T12:00:00.000Z'),
    };
    const body = profileBody();
    const connection = transactionWith((sql) => {
      if (/FROM concession_titles/.test(sql)) {
        return result([concessionTitle()]);
      }
      if (/SELECT id, concession_title_id, electronic_folio/.test(sql)) return result([existing]);
      if (/UPDATE snii_reporting_profiles SET/.test(sql)) return result({ affectedRows: 1 });
      if (/UPDATE snii_element_applicability SET applicability = 'unreviewed'/.test(sql)) {
        return result({ affectedRows: CATALOG.element_types.length });
      }
      if (/INSERT IGNORE INTO snii_element_applicability/.test(sql)) {
        return result({ affectedRows: 0 });
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 91 });
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) {
        return result([{ ...currentProfile(), ...body, id: 9, subject_applicability: 'unreviewed' }]);
      }
      if (/FROM snii_element_applicability/.test(sql)) return result([]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const updated = await service.upsertProfile(41, 17, body, context());

    expect(updated.subject_applicability).toBe('unreviewed');
    const profileUpdate = connection.execute.mock.calls.find(([sql]) =>
      /UPDATE snii_reporting_profiles SET/.test(sql));
    expect(profileUpdate[1].slice(24, 29)).toEqual(['unreviewed', null, null, null, null]);
    const elementReset = connection.execute.mock.calls.find(([sql]) =>
      /UPDATE snii_element_applicability SET applicability = 'unreviewed'/.test(sql));
    expect(elementReset).toBeDefined();
    expect(elementReset[1]).toEqual([41, 9]);
    const auditActions = connection.execute.mock.calls
      .filter(([sql]) => /INSERT INTO snii_audit_events/.test(sql))
      .map(([, params]) => params[2]);
    expect(auditActions).toContain('profile.identity_applicability_invalidated');
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('a missing or cross-tenant concession title is an indistinguishable 404', async () => {
    const connection = transactionWith((sql, params) => {
      if (/FROM concession_titles/.test(sql)) {
        expect(params).toEqual([999, 41]);
        expect(sql).toMatch(/organization_id = \?/);
        expect(sql).toMatch(/deleted_at IS NULL/);
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.upsertProfile(
      41, 17, profileBody({ concession_title_id: 999 }), context(),
    )).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });

    expect(connection.execute.mock.calls.some(([sql]) =>
      /^\s*(?:UPDATE|INSERT INTO) snii_reporting_profiles/.test(sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('freezes title, applicability and complete profile provenance into a batch hash', async () => {
    const title = concessionTitle();
    const titleSnapshot = service._test.concessionTitleSnapshot(title);
    const profile = currentProfile({
      concession_title_id: 22,
      concession_title_snapshot: titleSnapshot,
      concession_title_sha256: service._test.sha256(service._test.stableStringify(titleSnapshot)),
    });
    const applicability = reviewedApplicability();
    const expectedBatch = frozenBatch(profile, {
      created_by: 17,
      applicability,
      status: 'draft',
    });
    let batchInsert;
    let frozenHash;
    const connection = transactionWith((sql, params) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/FROM concession_titles/.test(sql)) return result([title]);
      if (/FROM snii_element_applicability/.test(sql)) return result(applicability);
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) return result([]);
      if (/INSERT INTO snii_report_batches/.test(sql)) {
        batchInsert = { sql, params };
        return result({ insertId: 30, affectedRows: 1 });
      }
      if (/UPDATE snii_report_batches SET item_count/.test(sql)) {
        frozenHash = params[1];
        return result({ affectedRows: 1 });
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 31 });
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{ ...expectedBatch, snapshot_hash: frozenHash }]);
      }
      if (/FROM snii_report_items|FROM snii_report_artifacts|FROM snii_filing_events/.test(sql)) {
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}; ${JSON.stringify(params)}`);
    });

    const created = await service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      supersedes_batch_id: null,
    }, context());

    expect((batchInsert.sql.match(/\?/g) || [])).toHaveLength(batchInsert.params.length);
    expect(batchInsert.sql).toMatch(
      /concession_title_snapshot,[\s\S]*concession_title_sha256[\s\S]*applicability_snapshot/,
    );
    expect(batchInsert.params).toContain(service._test.stableStringify(titleSnapshot));
    expect(batchInsert.params).toContain(service._test.stableStringify(
      service._test.buildApplicabilitySnapshot(profile, applicability),
    ));
    expect(frozenHash).toBe(expectedBatch.snapshot_hash);
    expect(created.snapshot_hash).toBe(expectedBatch.snapshot_hash);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('rejects an unlinked second batch for the same filing window', async () => {
    const connection = transactionWith((sql, params) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([currentProfile()]);
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) {
        expect(params).toEqual([
          9, 41, 'initial', 2026, 'initial', '2026-01-01', '2026-12-31', 'initial',
        ]);
        expect(sql).toMatch(/organization_id = \?/);
        return result([{ id: 30, revision_no: 1 }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      supersedes_batch_id: null,
    }, context())).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_report_batches/.test(sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('allows a distinct voluntary anytime period to begin at revision one', async () => {
    const profile = currentProfile();
    const applicability = reviewedApplicability('sitio_privado');
    const expectedBatch = frozenBatch(profile, {
      id: 32,
      created_by: 17,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      filing_kind: 'voluntary',
      filing_window: 'anytime',
      filing_frequency: 'voluntary',
      element_types_snapshot: ['sitio_privado'],
      element_contract_snapshot: [frozenContract('sitio_privado')],
      applicability,
    });
    let latestLookup;
    let batchInsert;
    let frozenHash;
    const connection = transactionWith((sql, params) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) {
        latestLookup = { sql, params };
        return result([]);
      }
      if (/FROM snii_element_applicability/.test(sql)) return result(applicability);
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      if (/INSERT INTO snii_report_batches/.test(sql)) {
        batchInsert = { sql, params };
        return result({ insertId: 32, affectedRows: 1 });
      }
      if (/UPDATE snii_report_batches SET item_count/.test(sql)) {
        frozenHash = params[1];
        return result({ affectedRows: 1 });
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 93 });
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{ ...expectedBatch, snapshot_hash: frozenHash }]);
      }
      if (/FROM snii_report_items|FROM snii_report_artifacts|FROM snii_filing_events/.test(sql)) {
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}; ${JSON.stringify(params)}`);
    });

    const created = await service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      filing_kind: 'voluntary',
      filing_window: 'anytime',
      filing_year: 2026,
      filing_frequency: 'voluntary',
      supersedes_batch_id: null,
    }, context());

    expect(latestLookup.sql).toMatch(/period_start = \?[\s\S]*period_end = \?[\s\S]*filing_frequency = \?/);
    expect(latestLookup.params).toEqual([
      9, 41, 'voluntary', 2026, 'anytime', '2026-09-01', '2026-09-30', 'voluntary',
    ]);
    expect((batchInsert.sql.match(/\?/g) || [])).toHaveLength(batchInsert.params.length);
    expect(created).toMatchObject({ revision_no: 1, correction_root_batch_id: null });
    expect(frozenHash).toBe(expectedBatch.snapshot_hash);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('rejects a second unrelated recurring series even when its period dates differ', async () => {
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([currentProfile()]);
      if (/period_start = \?[\s\S]*period_end = \?[\s\S]*filing_frequency = \?/.test(sql)) {
        return result([]);
      }
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) return result([{ id: 30 }]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-02-01',
      period_end: '2026-06-30',
      filing_kind: 'update',
      filing_window: 'first_semiannual',
      filing_year: 2026,
      filing_frequency: 'semiannual',
      supersedes_batch_id: null,
    }, context())).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_report_batches/.test(sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('atomically replaces a correction draft while retaining its external correction root', async () => {
    const profile = currentProfile();
    const applicability = reviewedApplicability();
    const predecessor = {
      id: 30,
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      revision_no: 2,
      status: 'draft',
      concession_title_id: null,
      electronic_folio: profile.electronic_folio,
      correction_root_batch_id: 20,
    };
    const correctionRoot = {
      id: 20,
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      status: 'correction_required',
      concession_title_id: null,
      electronic_folio: profile.electronic_folio,
    };
    const reason = 'Operational inventory changed after the first draft was frozen';
    const expectedBatch = frozenBatch(profile, {
      id: 31,
      created_by: 17,
      revision_no: 3,
      supersedes_batch_id: 30,
      correction_root_batch_id: 20,
      supersession_reason: reason,
      applicability,
      status: 'draft',
    });
    let batchInsert;
    let frozenHash;
    const connection = transactionWith((sql, params) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) {
        return result([{ id: 30, revision_no: 2, status: 'draft' }]);
      }
      if (/SELECT id, profile_id, period_start/.test(sql)) {
        return result([Number(params[0]) === 20 ? correctionRoot : predecessor]);
      }
      if (/WHERE supersedes_batch_id = \?/.test(sql)) return result([]);
      if (/FROM snii_element_applicability/.test(sql)) return result(applicability);
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      if (/UPDATE snii_report_batches SET status = 'superseded'/.test(sql)) {
        expect(params).toEqual([30, 41]);
        return result({ affectedRows: 1 });
      }
      if (/INSERT INTO snii_report_batches/.test(sql)) {
        batchInsert = { sql, params };
        return result({ insertId: 31, affectedRows: 1 });
      }
      if (/UPDATE snii_report_batches SET item_count/.test(sql)) {
        frozenHash = params[1];
        return result({ affectedRows: 1 });
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 91 });
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{ ...expectedBatch, snapshot_hash: frozenHash }]);
      }
      if (/FROM snii_report_items|FROM snii_report_artifacts|FROM snii_filing_events/.test(sql)) {
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}; ${JSON.stringify(params)}`);
    });

    const created = await service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      supersedes_batch_id: 30,
      supersession_reason: reason,
    }, context());

    expect((batchInsert.sql.match(/\?/g) || [])).toHaveLength(batchInsert.params.length);
    expect(batchInsert.params).toEqual(expect.arrayContaining([30, 20, reason, 3]));
    expect(frozenHash).toBe(expectedBatch.snapshot_hash);
    expect(created).toMatchObject({
      id: 31,
      revision_no: 3,
      supersedes_batch_id: 30,
      correction_root_batch_id: 20,
      supersession_reason: reason,
      snapshot_hash: expectedBatch.snapshot_hash,
    });
    const auditActions = connection.execute.mock.calls
      .filter(([sql]) => /INSERT INTO snii_audit_events/.test(sql))
      .map(([, params]) => params[2]);
    expect(auditActions).toEqual(['batch.created', 'batch.superseded']);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['validation', () => service.validateBatch(41, 17, 30, context())],
    ['artifact generation', () => service.generateArtifact(41, 17, 30,
      { element_type: 'torre', format: 'csv' }, context())],
    ['filing', () => service.recordFilingEvent(41, 17, 30, filingBody(), evidenceFile(), context())],
  ])('a superseded snapshot cannot continue to %s', async (_operation, invoke) => {
    const batch = frozenBatch(currentProfile(), { status: 'superseded' });
    const connection = transactionWith((sql) => {
      if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(invoke()).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) =>
      /^\s*(?:UPDATE|INSERT INTO)\s+snii_/.test(sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['period start', { period_start: '2026-02-01' }, {}],
    ['period end', { period_end: '2026-11-30' }, {}],
    ['filing frequency', {}, { filing_frequency: 'semiannual' }],
  ])('rejects a correction revision with changed %s', async (
    _label, requestOverride, predecessorOverride,
  ) => {
    const predecessor = {
      id: 30,
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      revision_no: 1,
      status: 'correction_required',
      concession_title_id: null,
      electronic_folio: 'CRT-E-123',
      ...predecessorOverride,
    };
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([currentProfile()]);
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) {
        return result([{ id: 30, revision_no: 1 }]);
      }
      if (/SELECT id, profile_id, period_start/.test(sql)) return result([predecessor]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      supersedes_batch_id: 30,
      ...requestOverride,
    }, context())).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_report_batches/.test(sql))).toBe(false);
  });

  test('requires a correction to directly supersede the latest revision', async () => {
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([currentProfile()]);
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) {
        return result([{ id: 31, revision_no: 2 }]);
      }
      if (/SELECT id, profile_id, period_start/.test(sql)) {
        return result([{
          id: 30,
          profile_id: 9,
          period_start: '2026-01-01',
          period_end: '2026-12-31',
          filing_kind: 'initial',
          filing_window: 'initial',
          filing_year: 2026,
          filing_frequency: 'initial',
          revision_no: 1,
          status: 'correction_required',
          concession_title_id: null,
          electronic_folio: 'CRT-E-123',
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      supersedes_batch_id: 30,
    }, context())).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['electronic folio', currentProfile({ electronic_folio: 'CRT-E-CHANGED' })],
    ['concession title', currentProfile({ concession_title_id: 99 })],
  ])('rejects an external correction with changed %s identity', async (_label, profile) => {
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) {
        return result([{ id: 30, revision_no: 1, status: 'correction_required' }]);
      }
      if (/SELECT id, profile_id, period_start/.test(sql)) {
        return result([{
          id: 30,
          profile_id: 9,
          period_start: '2026-01-01',
          period_end: '2026-12-31',
          filing_kind: 'initial',
          filing_window: 'initial',
          filing_year: 2026,
          filing_frequency: 'initial',
          revision_no: 1,
          status: 'correction_required',
          concession_title_id: null,
          electronic_folio: 'CRT-E-123',
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      supersedes_batch_id: 30,
    }, context())).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_report_batches/.test(sql))).toBe(false);
  });

  test('rejects an internal correction-draft replacement whose root filing identity changed', async () => {
    const profile = currentProfile({ electronic_folio: 'CRT-E-CHANGED' });
    const directPredecessor = {
      id: 31,
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      revision_no: 2,
      status: 'draft',
      concession_title_id: null,
      electronic_folio: 'CRT-E-123',
      correction_root_batch_id: 30,
    };
    const root = {
      ...directPredecessor,
      id: 30,
      revision_no: 1,
      status: 'correction_required',
      correction_root_batch_id: null,
    };
    const connection = transactionWith((sql, params) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) {
        return result([{ id: 31, revision_no: 2, status: 'draft' }]);
      }
      if (/SELECT id, profile_id, period_start/.test(sql)) {
        return result([Number(params[0]) === 30 ? root : directPredecessor]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.createBatch(41, 17, {
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      supersedes_batch_id: 31,
      supersession_reason: 'Refresh the correction draft after source changes',
    }, context())).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(connection.execute.mock.calls.some(([sql]) =>
      /UPDATE snii_report_batches SET status = 'superseded'|INSERT INTO snii_report_batches/.test(sql)))
      .toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('blocks an out-of-window annual population contradiction in a semiannual batch', async () => {
    const applicability = reviewedApplicability().map(item => item.element_type === 'poste'
      ? {
        ...item,
        applicability: 'applicable',
        rationale: 'Operator reports poles annually',
        population_status: 'has_assets',
        population_evidence_reference: null,
      }
      : item);
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_reporting_profiles/.test(sql)) return result([currentProfile()]);
      if (/ORDER BY revision_no DESC LIMIT 1 FOR UPDATE/.test(sql)) return result([]);
      if (/FROM snii_element_applicability/.test(sql)) return result(applicability);
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    let caught;
    try {
      await service.createBatch(41, 17, {
        profile_id: 9,
        period_start: '2026-01-01',
        period_end: '2026-06-30',
        filing_kind: 'update',
        filing_window: 'first_semiannual',
        filing_year: 2026,
        filing_frequency: 'semiannual',
        supersedes_batch_id: null,
      }, context());
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(caught.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'applicable_type_has_no_approved_assets', element_type: 'poste',
      }),
    ]));
    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_report_batches/.test(sql))).toBe(false);
  });

  test.each([
    ['source reviewer', { official_sources_reviewed_by: 99 }],
    ['source review time', { official_sources_reviewed_at: '2026-08-12T18:00:00.000Z' }],
    ['source freshness policy', { source_freshness_days: 30 }],
  ])('keeps a frozen batch stale after a changed %s', async (_label, profileOverride) => {
    const frozenProfile = currentProfile();
    const batch = frozenBatch(frozenProfile, {
      status: 'validated',
      validation_result: JSON.stringify({ valid: true }),
    });
    const connection = transactionWith((sql) => {
      if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
      if (/FROM snii_reporting_profiles/.test(sql)) {
        return result([{ ...frozenProfile, ...profileOverride }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.approveBatch(41, 19, 30, batch.snapshot_hash, context(19)))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) => /status = 'approved'/.test(sql)))
      .toBe(false);
  });

  test.each([
    ['changed', concessionTitle({ status: 'pending_renewal' }), 'concession_title_changed'],
    ['soft-deleted or missing', null, 'concession_title_missing'],
  ])('blocks batch approval when its reviewed title is %s', async (_label, currentTitle, code) => {
    const reviewedTitle = concessionTitle();
    const reviewedSnapshot = service._test.concessionTitleSnapshot(reviewedTitle);
    const profile = currentProfile({
      concession_title_id: 22,
      concession_title_snapshot: reviewedSnapshot,
      concession_title_sha256: service._test.sha256(
        service._test.stableStringify(reviewedSnapshot),
      ),
    });
    const batch = frozenBatch(profile, {
      status: 'validated',
      validation_result: JSON.stringify({ valid: true }),
    });
    const connection = transactionWith((sql) => {
      if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
      if (/FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/FROM concession_titles/.test(sql)) return result(currentTitle ? [currentTitle] : []);
      if (/FROM snii_element_applicability/.test(sql)) return result(reviewedApplicability());
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    let caught;
    try {
      await service.approveBatch(41, 17, 30, batch.snapshot_hash, context());
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(caught.details).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    expect(connection.execute.mock.calls.some(([sql]) => /status = 'approved'/.test(sql))).toBe(false);
  });

  test('an old batch stays stale after the changed title is independently re-reviewed', async () => {
    const oldTitleSnapshot = service._test.concessionTitleSnapshot(concessionTitle());
    const oldProfile = currentProfile({
      concession_title_id: 22,
      concession_title_snapshot: oldTitleSnapshot,
      concession_title_sha256: service._test.sha256(service._test.stableStringify(oldTitleSnapshot)),
    });
    const batch = frozenBatch(oldProfile, { status: 'draft' });
    const changedSnapshot = service._test.concessionTitleSnapshot(
      concessionTitle({ status: 'pending_renewal' }),
    );
    const reReviewedProfile = currentProfile({
      concession_title_id: 22,
      concession_title_snapshot: changedSnapshot,
      concession_title_sha256: service._test.sha256(service._test.stableStringify(changedSnapshot)),
      applicability_basis: 'Counsel reviewed the pending renewal',
      external_decision_reference: 'LEGAL-REVIEW-NEW-TITLE-STATE',
    });
    const connection = transactionWith((sql) => {
      if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
      if (/FROM snii_reporting_profiles/.test(sql)) return result([reReviewedProfile]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.validateBatch(41, 17, 30, context()))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) =>
      /UPDATE snii_report_batches SET status/.test(sql))).toBe(false);
  });

  test('fails closed when the stored title snapshot does not match its stored hash', async () => {
    const title = concessionTitle();
    const snapshot = service._test.concessionTitleSnapshot(title);
    const profile = currentProfile({
      concession_title_id: 22,
      concession_title_snapshot: { ...snapshot, status: 'revoked' },
      concession_title_sha256: service._test.sha256(service._test.stableStringify(snapshot)),
    });
    const batch = frozenBatch(profile, {
      status: 'validated',
      validation_result: JSON.stringify({ valid: true }),
    });
    const _connection = transactionWith((sql) => {
      if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
      if (/FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/FROM concession_titles/.test(sql)) return result([title]);
      if (/FROM snii_element_applicability/.test(sql)) return result(reviewedApplicability());
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    let caught;
    try {
      await service.approveBatch(41, 17, 30, batch.snapshot_hash, context());
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(caught.message).toMatch(/concession-title snapshot/i);
  });

  test('candidate discovery scopes every source and registry query to the exact tenant', async () => {
    db.query.mockImplementation((sql) => {
      if (/FROM sites WHERE/.test(sql)) {
        return result([{ id: 1, site_type: 'tower', name: 'T-1' }]);
      }
      return result([]);
    });

    const candidates = await service.listCandidates(41);

    expect(candidates).toEqual([
      expect.objectContaining({
        source_type: 'site',
        source_id: 1,
        decision: 'unreviewed',
        approval_status: null,
        eligibility: 'explicit_review_required',
      }),
    ]);
    expect(db.query).toHaveBeenCalledTimes(6);
    for (const [sql, params] of db.query.mock.calls) {
      expect(sql).toMatch(/organization_id\s*=\s*\?/);
      expect(sql).not.toMatch(/(?:OR\s+)?(?:\w+\.)?organization_id\s+IS\s+NULL/i);
      expect(params).toContain(41);
    }

    const deviceSql = db.query.mock.calls.find(([sql]) => /FROM devices d/.test(sql))[0];
    expect(deviceSql).toMatch(/d\.client_id IS NULL AND d\.contract_id IS NULL/);
    expect(deviceSql).toMatch(/NOT EXISTS \(SELECT 1 FROM cpe_devices/);
    const fiberSql = db.query.mock.calls.find(([sql]) => /FROM fiber_routes/.test(sql))[0];
    expect(fiberSql).toMatch(/route_type <> 'drop'/);
    expect(fiberSql).toMatch(/to_onu_detail_id IS NULL/);
  });

  test('a directly typed OLT remains eligible when its legacy category is the default', async () => {
    db.query.mockImplementation((sql, params) => {
      if (/FROM devices d/.test(sql)) {
        expect(params).toEqual([41]);
        return result([{
          id: 44,
          name: 'OLT installed before category cleanup',
          type: 'olt',
          category: 'client',
          client_id: null,
          contract_id: null,
          latitude: 28.63,
          longitude: -106.08,
        }]);
      }
      return result([]);
    });

    const candidates = await service.listCandidates(41);

    expect(candidates).toEqual([
      expect.objectContaining({
        source_type: 'device',
        source_id: 44,
        suggested_element_type: 'olt',
        decision: 'unreviewed',
      }),
    ]);
    const [deviceSql, deviceParams] = db.query.mock.calls.find(([sql]) => /FROM devices d/.test(sql));
    expect(deviceParams).toEqual([41]);
    expect(deviceSql).toMatch(/WHERE d\.organization_id = \?/);
    expect(deviceSql).not.toMatch(/d\.organization_id IS NULL/);
    expect(deviceSql).not.toMatch(/d\.category\s*=\s*['"]pop['"]/i);
    expect(deviceSql).toMatch(/d\.type IN \('olt','ptp','ptmp_ap'\)/);
    expect(deviceSql).toMatch(
      /LEFT JOIN sites s ON s\.id = d\.site_id AND s\.organization_id = d\.organization_id/,
    );
    expect(deviceSql).toMatch(
      /c\.device_id = d\.id AND c\.organization_id = d\.organization_id/,
    );
  });

  test('generic asset inventory omits coordinates and reviewed payload blobs', async () => {
    db.query.mockImplementation((sql, params) => {
      expect(sql).toMatch(/FROM snii_asset_registry WHERE organization_id = \?/);
      expect(params).toEqual([41]);
      return result([{
        id: 71,
        organization_id: 41,
        profile_id: 9,
        source_type: 'manual',
        source_id: null,
        element_type: 'torre',
        decision: 'included',
        approval_status: 'approved',
        source_snapshot_hash: 'a'.repeat(64),
        classification_hash: 'b'.repeat(64),
        manual_payload: JSON.stringify({ LATITUD: 28.63, LONGITUD: -106.08 }),
        reviewed_payload: JSON.stringify({
          wire: { LATITUD: 28.63, LONGITUD: -106.08 },
          geometry: { type: 'Point', coordinates: [-106.08, 28.63] },
        }),
        field_overrides: JSON.stringify({ LATITUD: 28.63 }),
      }]);
    });

    const assets = await service.listAssets(41);

    expect(assets).toHaveLength(1);
    expect(assets[0]).not.toHaveProperty('manual_payload');
    expect(assets[0]).not.toHaveProperty('reviewed_payload');
    expect(assets[0]).not.toHaveProperty('field_overrides');
    expect(JSON.stringify(assets[0])).not.toMatch(/28\.63|-106\.08|coordinates/i);
  });

  test('new registry entries remain unreviewed and unapproved unless explicitly classified', async () => {
    let insertParams;
    const connection = transactionWith((sql, params) => {
      if (/SELECT id FROM snii_reporting_profiles/.test(sql)) return result([{ id: 9 }]);
      if (/FROM sites WHERE id =/.test(sql)) {
        return result([{ id: 5, site_type: 'tower', name: 'Tower 5', updated_at: null }]);
      }
      if (/INSERT INTO snii_asset_registry/.test(sql)) {
        insertParams = params;
        return result({ insertId: 71, affectedRows: 1 });
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 72 });
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) {
        return result([{
          id: 71,
          organization_id: 41,
          profile_id: 9,
          source_type: 'site',
          source_id: 5,
          element_type: 'torre',
          decision: 'unreviewed',
          approval_status: 'not_required',
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const created = await service.createAsset(41, 17, {
      profile_id: 9,
      source_type: 'site',
      source_id: 5,
      element_type: 'torre',
    }, context());

    expect(created).toMatchObject({ decision: 'unreviewed', approval_status: 'not_required' });
    expect(insertParams.slice(0, 7)).toEqual([
      41, 9, 'site', 5, 'torre', 'unreviewed', 'not_required',
    ]);
    expect(insertParams[8]).toBeNull(); // decision_evidence_reference
    expect(insertParams[14]).toBeNull(); // reviewed_payload
    expect(insertParams[15]).toBeNull(); // source_snapshot_hash
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('a source identity outside the tenant is indistinguishable from a missing source', async () => {
    const connection = transactionWith((sql) => {
      if (/SELECT id FROM snii_reporting_profiles/.test(sql)) return result([{ id: 9 }]);
      if (/FROM sites WHERE id =/.test(sql)) return result([]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.createAsset(41, 17, {
      profile_id: 9,
      source_type: 'site',
      source_id: 500,
      element_type: 'torre',
    }, context())).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });

    const sourceLookup = connection.execute.mock.calls.find(([sql]) => /FROM sites WHERE id =/.test(sql));
    expect(sourceLookup[0]).toMatch(/id = \? AND organization_id = \?/);
    expect(sourceLookup[1]).toEqual([500, 41]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('cross-tenant batch IDs return 404 without querying child evidence', async () => {
    db.query.mockResolvedValueOnce([[], []]);

    await expect(service.getBatch(41, 999))
      .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/id = \? AND organization_id = \?/);
    expect(db.query.mock.calls[0][1]).toEqual([999, 41]);
  });

  test('requires a different actor and an unchanged source for asset approval', async () => {
    let connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) {
        return result([{
          id: 71,
          organization_id: 41,
          source_type: 'site',
          source_id: 5,
          element_type: 'torre',
          decision: 'excluded',
          approval_status: 'pending',
          exclusion_reason: 'dummy',
          decision_evidence_reference: 'FIELD-REVIEW-1',
          reviewed_payload: JSON.stringify({ wire: {}, geometry: null }),
          source_snapshot_hash: 'a'.repeat(64),
          classification_hash: 'b'.repeat(64),
          classified_by: 17,
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.approveAsset(
      41, 17, 71, 'a'.repeat(64), 'b'.repeat(64), context(),
    ))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.rollback).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) {
        return result([{
          id: 71,
          organization_id: 41,
          source_type: 'site',
          source_id: 5,
          element_type: 'torre',
          decision: 'excluded',
          approval_status: 'pending',
          exclusion_reason: 'dummy',
          decision_evidence_reference: 'FIELD-REVIEW-1',
          reviewed_payload: JSON.stringify({ wire: {}, geometry: null }),
          source_snapshot_hash: 'a'.repeat(64),
          classification_hash: 'b'.repeat(64),
          classified_by: 18,
        }]);
      }
      if (/FROM sites WHERE id =/.test(sql)) {
        return result([{ id: 5, site_type: 'tower', name: 'Changed tower', updated_at: null }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.approveAsset(
      41, 17, 71, 'a'.repeat(64), 'b'.repeat(64), context(),
    ))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.execute.mock.calls.some(([sql]) =>
      /SET approval_status = 'approved'/.test(sql))).toBe(false);
  });

  test('approval binds the exact classification preview and recomputes it server-side', async () => {
    let connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) {
        return result([{
          id: 71,
          organization_id: 41,
          source_type: 'site',
          source_id: 5,
          element_type: 'torre',
          decision: 'excluded',
          approval_status: 'pending',
          exclusion_reason: 'dummy',
          decision_evidence_reference: 'FIELD-REVIEW-1',
          reviewed_payload: JSON.stringify({ wire: {}, geometry: null }),
          source_snapshot_hash: 'a'.repeat(64),
          classification_hash: 'b'.repeat(64),
          classified_by: 18,
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.approveAsset(
      41, 17, 71, 'a'.repeat(64), 'c'.repeat(64), context(),
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) => /FROM sites WHERE id =/.test(sql)))
      .toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    const sourceRow = {
      id: 5,
      name: 'Tower 5',
      site_type: 'tower',
      latitude: 28.63,
      longitude: -106.08,
      updated_at: null,
    };
    const sourceHash = service._test.sha256(service._test.stableStringify({
      ...sourceRow,
      source_type: 'site',
    }));
    connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) {
        return result([{
          id: 71,
          organization_id: 41,
          source_type: 'site',
          source_id: 5,
          element_type: 'torre',
          decision: 'excluded',
          approval_status: 'pending',
          exclusion_reason: 'dummy',
          decision_evidence_reference: 'FIELD-REVIEW-1',
          reviewed_payload: JSON.stringify({ wire: {}, geometry: null }),
          field_overrides: JSON.stringify({}),
          source_snapshot_hash: sourceHash,
          classification_hash: 'd'.repeat(64),
          classified_by: 18,
        }]);
      }
      if (/FROM sites WHERE id =/.test(sql)) return result([sourceRow]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.approveAsset(
      41, 17, 71, sourceHash, 'd'.repeat(64), context(),
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) =>
      /SET approval_status = 'approved'/.test(sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});

describe('SNII evidence truth and fail-closed audit', () => {
  test('an unreviewed registry row blocks batch approval', async () => {
    const contract = frozenContract('torre');
    const profile = currentProfile();
    const batch = frozenBatch(profile, {
      status: 'validated',
      validation_result: JSON.stringify({ valid: true }),
      element_types_snapshot: ['torre'],
      element_contract_snapshot: [contract],
    });
    const connection = transactionWith((sql) => {
      if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
      if (/FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/FROM snii_element_applicability/.test(sql)) return result(reviewedApplicability());
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) {
        return result([{
          id: 90,
          profile_id: 9,
          source_type: 'manual',
          source_id: null,
          element_type: 'torre',
          decision: 'unreviewed',
          approval_status: 'not_required',
          manual_payload: JSON.stringify({ LATITUD: 28.6, LONGITUD: -106.1 }),
        }]);
      }
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    let caught;
    try {
      await service.approveBatch(41, 17, 30, batch.snapshot_hash, context());
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(caught.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'asset_decision_unreviewed', asset_id: 90 }),
    ]));
    expect(connection.execute.mock.calls.some(([sql]) => /status = 'approved'/.test(sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['approval', 'validated', 'included'],
    ['artifact generation', 'approved', 'included'],
    ['approval', 'validated', 'excluded'],
    ['artifact generation', 'approved', 'excluded'],
  ])('operational source drift blocks batch %s from %s state for an %s decision',
    async (operation, status, decision) => {
      const contract = frozenContract('torre');
      const profile = currentProfile();
      const oldPayload = Object.fromEntries(contract.required_headers.map(header => [header, 'x']));
      for (const [header, accepted] of Object.entries(contract.catalog_values)) {
        oldPayload[header] = accepted[0];
      }
      oldPayload.CODIGO_IDENTIFICADOR = 'T-1';
      oldPayload.PROPIEDAD = 'Propio';
      oldPayload.PROPIETARIO = 'MX ISP';
      oldPayload.LATITUD = 28.6;
      oldPayload.LONGITUD = -106.1;
      const oldSource = { ...oldPayload, source_type: 'manual', updated_at: null };
      const changedPayload = { ...oldPayload, LATITUD: 29.1 };
      const asset = {
        id: 71,
        profile_id: 9,
        source_type: 'manual',
        source_id: null,
        element_type: 'torre',
        decision,
        approval_status: 'approved',
        decision_evidence_reference: 'FIELD-REVIEW-1',
        exclusion_reason: decision === 'excluded' ? 'dummy' : null,
        official_code: 'T-1',
        ownership: 'owned',
        owner_name: 'MX ISP',
        field_overrides: JSON.stringify({}),
        manual_payload: JSON.stringify(changedPayload),
        source_snapshot_hash: service._test.sha256(service._test.stableStringify(oldSource)),
        classified_by: 18,
        approved_by: 17,
      };
      const batch = {
        id: 30,
        profile_id: 9,
        status,
        validation_result: JSON.stringify({ valid: true }),
        created_by: 18,
        snapshot_hash: 'd'.repeat(64),
        catalog_version: CATALOG.catalog_version,
        filing_kind: 'initial',
        filing_window: 'initial',
        filing_year: 2026,
        full_load: 1,
        supersedes_batch_id: null,
        element_types_snapshot: JSON.stringify(['torre']),
        element_contract_snapshot: JSON.stringify([contract]),
        ...Object.fromEntries([
          'source_channel', 'source_attestation_reference',
          'official_sources_reviewed_by', 'official_sources_reviewed_at',
          'source_freshness_days',
          'adapter_reconciliation_reference', 'adapter_reconciliation_sha256',
          'adapter_catalog_version', 'adapter_reconciled_by', 'adapter_reconciled_at',
          'template_version', 'template_source_url', 'template_sha256',
          'dictionary_version', 'dictionary_source_url', 'dictionary_sha256',
          'annex_v_version', 'annex_v_source_url', 'annex_v_sha256',
          'legal_basis', 'electronic_folio',
        ].map(field => [field, profile[field]])),
      };
      const connection = transactionWith((sql) => {
        if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
        if (/FROM snii_reporting_profiles/.test(sql)) return result([profile]);
        if (/FROM snii_element_applicability/.test(sql)) {
          return result(reviewedApplicability().map(row => row.element_type === 'torre'
            ? {
              ...row,
              population_status: decision === 'included' ? 'has_assets' : 'zero_population',
              population_evidence_reference: decision === 'included' ? null : 'ZERO-POP-REVIEW',
            }
            : row));
        }
        if (/SELECT \* FROM snii_asset_registry/.test(sql)) return result([asset]);
        if (/FROM snii_asset_registry/.test(sql)) return result([]);
        if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
          return result([]);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      let caught;
      try {
        if (operation === 'approval') {
          await service.approveBatch(41, 19, 30, batch.snapshot_hash, context(19));
        } else {
          await service.generateArtifact(41, 19, 30,
            { element_type: 'torre', format: 'csv' }, context(19));
        }
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(caught.details).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'reviewed_source_stale', asset_id: 71, decision }),
      ]));
      expect(connection.execute.mock.calls.some(([sql]) =>
        /INSERT INTO snii_report_artifacts|status = 'approved'/.test(sql))).toBe(false);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

  test('deletion of a source behind an approved exclusion blocks batch readiness', async () => {
    const profile = currentProfile();
    const contract = frozenContract('torre');
    const batch = {
      id: 30,
      profile_id: 9,
      status: 'validated',
      validation_result: JSON.stringify({ valid: true }),
      created_by: 18,
      snapshot_hash: 'd'.repeat(64),
      catalog_version: CATALOG.catalog_version,
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      full_load: 1,
      supersedes_batch_id: null,
      element_types_snapshot: JSON.stringify(['torre']),
      element_contract_snapshot: JSON.stringify([contract]),
      ...Object.fromEntries([
        'source_channel', 'source_attestation_reference',
        'official_sources_reviewed_by', 'official_sources_reviewed_at',
        'source_freshness_days',
        'adapter_reconciliation_reference', 'adapter_reconciliation_sha256',
        'adapter_catalog_version', 'adapter_reconciled_by', 'adapter_reconciled_at',
        'template_version', 'template_source_url', 'template_sha256',
        'dictionary_version', 'dictionary_source_url', 'dictionary_sha256',
        'annex_v_version', 'annex_v_source_url', 'annex_v_sha256',
        'legal_basis', 'electronic_folio',
      ].map(field => [field, profile[field]])),
    };
    const connection = transactionWith((sql) => {
      if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
      if (/FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/FROM snii_element_applicability/.test(sql)) return result(reviewedApplicability());
      if (/SELECT \* FROM snii_asset_registry/.test(sql)) {
        return result([{
          id: 71,
          profile_id: 9,
          source_type: 'site',
          source_id: 5,
          element_type: 'torre',
          decision: 'excluded',
          approval_status: 'approved',
          exclusion_reason: 'dummy',
          decision_evidence_reference: 'FIELD-REVIEW-1',
          source_snapshot_hash: 'a'.repeat(64),
          classification_hash: 'b'.repeat(64),
          classified_by: 18,
          approved_by: 17,
        }]);
      }
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    let caught;
    try {
      await service.approveBatch(41, 19, 30, batch.snapshot_hash, context(19));
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(caught.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'reviewed_source_missing',
        asset_id: 71,
        decision: 'excluded',
      }),
    ]));
    expect(connection.execute.mock.calls.some(([sql]) => /status = 'approved'/.test(sql)))
      .toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('artifact generation records exported, never filed or accepted', async () => {
    const sqlSeen = [];
    let artifactInsert;
    const contract = frozenContract('torre');
    const profile = currentProfile();
    const batch = frozenBatch(profile, {
      status: 'approved',
      element_types_snapshot: ['torre'],
      element_contract_snapshot: [contract],
    });
    const connection = transactionWith((sql, params) => {
      sqlSeen.push(sql);
      if (/FROM snii_report_batches WHERE id/.test(sql)) {
        return result([batch]);
      }
      if (/FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/FROM snii_element_applicability/.test(sql)) return result(reviewedApplicability());
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      if (/FROM snii_report_artifacts[\s\S]*element_type =/.test(sql)) return result([]);
      if (/FROM snii_report_items/.test(sql)) return result([]);
      if (/INSERT INTO snii_report_artifacts/.test(sql)) {
        artifactInsert = { sql, params };
        return result({ insertId: 81, affectedRows: 1 });
      }
      if (/SELECT DISTINCT element_type FROM snii_report_artifacts/.test(sql)) {
        return result([{ element_type: 'torre' }]);
      }
      if (/UPDATE snii_report_batches/.test(sql)) return result({ affectedRows: 1 });
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 82 });
      if (/FROM snii_report_artifacts WHERE id/.test(sql)) {
        return result([{ id: 81, organization_id: 41, batch_id: 30,
          content_sha256: 'b'.repeat(64) }]);
      }
      throw new Error(`Unexpected SQL: ${sql}; ${JSON.stringify(params)}`);
    });

    await service.generateArtifact(41, 17, 30, {
      element_type: 'torre',
      format: 'csv',
    }, context());

    const statusUpdate = connection.execute.mock.calls.find(([sql]) =>
      /UPDATE snii_report_batches SET status/.test(sql));
    expect(statusUpdate[0]).toMatch(/status = 'exported'/);
    expect(statusUpdate[0]).not.toMatch(/filed|accepted/);
    expect(sqlSeen.join('\n')).not.toMatch(/SET status = '(?:filed|accepted)'/);
    expect(service._test.sha256(artifactInsert.params[6])).toBe(artifactInsert.params[7]);
    expect(Buffer.byteLength(artifactInsert.params[6], 'utf8')).toBe(artifactInsert.params[8]);
    expect(artifactInsert.params[4]).toBe('torre.csv');
    expect(artifactInsert.sql).toMatch(/source_classification/);
    expect(artifactInsert.params).toContain('historical_adapter_reconciled');
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('a partial full-load artifact set does not mark the batch exported', async () => {
    const profile = currentProfile();
    const contracts = [frozenContract('torre'), frozenContract('poste')];
    const applicability = CATALOG.element_types.map(item => ({
      element_type: item.slug,
      applicability: ['torre', 'poste'].includes(item.slug) ? 'applicable' : 'not_applicable',
      population_status: ['torre', 'poste'].includes(item.slug) ? 'zero_population' : 'unreviewed',
      population_evidence_reference: ['torre', 'poste'].includes(item.slug)
        ? `ZERO-POP-${item.slug}` : null,
    }));
    const batch = frozenBatch(profile, {
      status: 'approved',
      element_types_snapshot: ['torre', 'poste'],
      element_contract_snapshot: contracts,
      applicability,
    });
    let auditInsert;
    const connection = transactionWith((sql, params) => {
      if (/FROM snii_report_batches WHERE id/.test(sql)) return result([batch]);
      if (/FROM snii_reporting_profiles/.test(sql)) return result([profile]);
      if (/FROM snii_element_applicability/.test(sql)) return result(applicability);
      if (/FROM snii_asset_registry/.test(sql)) return result([]);
      if (/FROM (?:sites|devices d|fiber_routes|map_infrastructure_points|network_links l)/.test(sql)) {
        return result([]);
      }
      if (/SELECT id, content_sha256 FROM snii_report_artifacts/.test(sql)) return result([]);
      if (/FROM snii_report_items/.test(sql)) return result([]);
      if (/INSERT INTO snii_report_artifacts/.test(sql)) {
        return result({ insertId: 81, affectedRows: 1 });
      }
      if (/SELECT DISTINCT element_type FROM snii_report_artifacts/.test(sql)) {
        return result([{ element_type: 'torre' }]);
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) {
        auditInsert = { sql, params };
        return result({ insertId: 82 });
      }
      if (/FROM snii_report_artifacts WHERE id/.test(sql)) {
        return result([{ id: 81, organization_id: 41, batch_id: 30, element_type: 'torre' }]);
      }
      throw new Error(`Unexpected SQL: ${sql}; ${JSON.stringify(params)}`);
    });

    await service.generateArtifact(41, 17, 30, {
      element_type: 'torre',
      format: 'csv',
    }, context());

    expect(connection.execute.mock.calls.some(([sql]) =>
      /UPDATE snii_report_batches SET status = 'exported'/.test(sql))).toBe(false);
    expect(JSON.parse(auditInsert.params[5])).toMatchObject({
      full_load_exported: false,
      generated_is_filed: false,
    });
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('a verified multipart submission atomically retains exact bytes and advances to filed', async () => {
    const evidenceBytes = Buffer.from('CRT receipt evidence\n', 'utf8');
    const uploadedEvidence = evidenceFile(evidenceBytes);
    const evidenceHash = service._test.sha256(evidenceBytes);
    let uploadInsert;
    let filingInsert;
    let filingResponseSelect;
    let statusUpdate;
    const connection = transactionWith((sql, params) => {
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{
          id: 30,
          organization_id: 41,
          status: 'exported',
          first_exported_at: '2026-08-15T17:00:00.000Z',
          supersedes_batch_id: null,
          element_types_snapshot: JSON.stringify(['torre']),
        }]);
      }
      if (/SELECT DISTINCT element_type FROM snii_report_artifacts/.test(sql)) {
        return result([{ element_type: 'torre' }]);
      }
      if (/INSERT INTO snii_evidence_uploads/.test(sql)) {
        uploadInsert = { sql, params };
        return result({ insertId: 91, affectedRows: 1 });
      }
      if (/INSERT INTO snii_filing_events/.test(sql)) {
        filingInsert = { sql, params };
        return result({ insertId: 92, affectedRows: 1 });
      }
      if (/UPDATE snii_report_batches SET status = \?/.test(sql)) {
        statusUpdate = { sql, params };
        return result({ affectedRows: 1 });
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 93 });
      if (/FROM snii_filing_events WHERE id/.test(sql)) {
        filingResponseSelect = sql;
        return result([{
          id: 92,
          organization_id: 41,
          batch_id: 30,
          event_type: 'submitted',
          evidence_upload_id: 91,
          evidence_file_name: 'acuse.pdf',
          evidence_mime_type: 'application/pdf',
          evidence_byte_size: evidenceBytes.length,
          evidence_sha256: evidenceHash,
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}; ${JSON.stringify(params)}`);
    });

    const recorded = await service.recordFilingEvent(
      41, 17, 30, filingBody(), uploadedEvidence, context(),
    );

    expect(recorded).toMatchObject({ event_type: 'submitted', evidence_sha256: evidenceHash });
    expect(recorded).not.toHaveProperty('evidence_content');
    expect(uploadInsert.params).toEqual([
      41, 'acuse.pdf', 'application/pdf', evidenceBytes.length,
      evidenceHash, evidenceBytes, 17,
    ]);
    expect(filingInsert.sql).toMatch(
      /evidence_upload_id,[\s\S]*evidence_file_name,[\s\S]*evidence_mime_type,[\s\S]*evidence_byte_size,[\s\S]*evidence_content,[\s\S]*evidence_sha256/,
    );
    expect(filingInsert.params.slice(7, 13)).toEqual([
      91, 'acuse.pdf', 'application/pdf', evidenceBytes.length, evidenceBytes, evidenceHash,
    ]);
    expect(service._test.sha256(filingInsert.params[11])).toBe(filingInsert.params[12]);
    expect(filingResponseSelect).not.toMatch(/evidence_content|SELECT\s+\*/i);
    expect(statusUpdate.params).toEqual(['filed', 30, 41]);
    expect(statusUpdate.sql).not.toMatch(/accepted/);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('a corrected submission resolves retained evidence through an internal replacement hop', async () => {
    const evidenceBytes = Buffer.from('corrected CRT receipt evidence\n', 'utf8');
    const evidenceHash = service._test.sha256(evidenceBytes);
    const identity = {
      profile_id: 9,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      filing_kind: 'initial',
      filing_window: 'initial',
      filing_year: 2026,
      filing_frequency: 'initial',
      concession_title_id: null,
      electronic_folio: 'CRT-E-123',
    };
    let correctionLookupParams;
    let statusUpdate;
    const connection = transactionWith((sql, params) => {
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{
          id: 32,
          organization_id: 41,
          ...identity,
          status: 'exported',
          first_exported_at: '2026-08-15T17:00:00.000Z',
          supersedes_batch_id: 31,
          correction_root_batch_id: 30,
          element_types_snapshot: JSON.stringify(['torre']),
        }]);
      }
      if (/SELECT id, profile_id, period_start/.test(sql)) {
        expect(params).toEqual([30, 41]);
        return result([{ id: 30, ...identity, status: 'correction_required' }]);
      }
      if (/event_type IN \('rejected','correction_requested'\)/.test(sql)) {
        correctionLookupParams = params;
        return result([{
          id: 90,
          attempt_no: 1,
          occurred_at: '2026-08-15T18:00:00.000Z',
        }]);
      }
      if (/SELECT DISTINCT element_type FROM snii_report_artifacts/.test(sql)) {
        return result([{ element_type: 'torre' }]);
      }
      if (/INSERT INTO snii_evidence_uploads/.test(sql)) {
        return result({ insertId: 91, affectedRows: 1 });
      }
      if (/INSERT INTO snii_filing_events/.test(sql)) {
        return result({ insertId: 92, affectedRows: 1 });
      }
      if (/UPDATE snii_report_batches SET status = \?/.test(sql)) {
        statusUpdate = { sql, params };
        return result({ affectedRows: 1 });
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 93 });
      if (/FROM snii_filing_events WHERE id/.test(sql)) {
        return result([{
          id: 92,
          organization_id: 41,
          batch_id: 32,
          event_type: 'corrected_submission',
          attempt_no: 2,
          evidence_sha256: evidenceHash,
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}; ${JSON.stringify(params)}`);
    });

    const recorded = await service.recordFilingEvent(
      41, 17, 32, filingBody({
        event_type: 'corrected_submission',
        attempt_no: 2,
        occurred_at: '2026-08-15T13:30:00.000-06:00',
        authority_reference: 'CRT-CORRECTED-002',
      }), evidenceFile(evidenceBytes), context(),
    );

    expect(correctionLookupParams).toEqual([30, 41]);
    expect(statusUpdate.params).toEqual(['filed', 32, 41]);
    expect(recorded).toMatchObject({ event_type: 'corrected_submission', attempt_no: 2 });
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('API-facing batch and filing-event reads never select retained evidence bytes', async () => {
    const event = {
      id: 92,
      organization_id: 41,
      batch_id: 30,
      event_type: 'submitted',
      evidence_upload_id: 91,
      evidence_file_name: 'acuse.pdf',
      evidence_mime_type: 'application/pdf',
      evidence_byte_size: 21,
      evidence_sha256: 'a'.repeat(64),
    };
    let batchEventSelect;
    const batchConnection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{
          id: 30,
          organization_id: 41,
          status: 'filed',
          full_load: 1,
          element_types_snapshot: JSON.stringify(['torre']),
          element_contract_snapshot: JSON.stringify([frozenContract('torre')]),
        }]);
      }
      if (/FROM snii_report_items/.test(sql)) {
        return result([{
          id: 101,
          organization_id: 41,
          batch_id: 30,
          registry_asset_id: 71,
          element_type: 'torre',
          official_code: 'T-1',
          source_type: 'manual',
          snapshot_payload: JSON.stringify({
            wire: { LATITUD: 28.63, LONGITUD: -106.08 },
            geometry: { type: 'Point', coordinates: [-106.08, 28.63] },
          }),
          payload_hash: 'd'.repeat(64),
          validation_errors: null,
        }]);
      }
      if (/FROM snii_report_artifacts/.test(sql)) return result([]);
      if (/FROM snii_filing_events/.test(sql)) {
        batchEventSelect = sql;
        return result([event]);
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 93 });
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const batch = await service.getBatch(41, 30, context());

    expect(batch.filing_events).toEqual([event]);
    expect(batch.filing_events[0]).not.toHaveProperty('evidence_content');
    expect(batch.items[0]).not.toHaveProperty('snapshot_payload');
    expect(batch.items[0]).not.toHaveProperty('registry_asset_id');
    expect(JSON.stringify(batch)).not.toMatch(/28\.63|-106\.08|coordinates|evidence_content/i);
    expect(batchEventSelect).not.toMatch(/evidence_content|SELECT\s+\*/i);
    expect(batchEventSelect).not.toMatch(/JOIN\s+(?:files|snii_evidence_uploads)/i);
    expect(batchConnection.commit).toHaveBeenCalledTimes(1);

    let listEventSelect;
    const listConnection = transactionWith((sql) => {
      if (/SELECT id FROM snii_report_batches/.test(sql)) return result([{ id: 30 }]);
      if (/FROM snii_filing_events/.test(sql)) {
        listEventSelect = sql;
        return result([event]);
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 94 });
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const events = await service.listFilingEvents(41, 30, context());

    expect(events).toEqual([event]);
    expect(events[0]).not.toHaveProperty('evidence_content');
    expect(listEventSelect).not.toMatch(/evidence_content|SELECT\s+\*/i);
    expect(listEventSelect).not.toMatch(/JOIN\s+(?:files|snii_evidence_uploads)/i);
    expect(listConnection.commit).toHaveBeenCalledTimes(1);
  });

  test('acceptance cannot be inferred for an exported batch without a recorded submission', async () => {
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{
          id: 30,
          organization_id: 41,
          status: 'exported',
          first_exported_at: '2026-08-15T17:00:00.000Z',
          supersedes_batch_id: null,
          element_types_snapshot: JSON.stringify(['torre']),
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.recordFilingEvent(
      41, 17, 30, filingBody({
        event_type: 'accepted',
        authority_reference: 'CRT-ACCEPTANCE-001',
      }), evidenceFile(), context(),
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_evidence_uploads|INSERT INTO snii_filing_events|UPDATE snii_report_batches/.test(sql)))
      .toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test.each([
    ['a non-initial attempt number', { attempt_no: 2 }, '2026-08-15T17:00:00.000Z'],
    ['an occurrence before completed export', {}, '2026-08-15T19:00:00.000Z'],
  ])('rejects an initial submission with %s', async (_label, overrides, exportedAt) => {
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{
          id: 30,
          organization_id: 41,
          status: 'exported',
          first_exported_at: exportedAt,
          supersedes_batch_id: null,
          element_types_snapshot: JSON.stringify(['torre']),
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.recordFilingEvent(
      41, 17, 30, filingBody(overrides), evidenceFile(), context(),
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_evidence_uploads|INSERT INTO snii_filing_events/.test(sql))).toBe(false);
  });

  test.each([
    ['an arbitrary unmatched attempt', 99, null, null],
    ['a timestamp before its submission', 1, '2026-08-15T19:00:00.000Z', null],
    ['a timestamp before the latest same-attempt event', 1,
      '2026-08-15T18:00:00.000Z', '2026-08-15T19:00:00.000Z'],
  ])('rejects an authority response with %s', async (
    _label, attemptNo, submittedAt, latestAt,
  ) => {
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{ id: 30, organization_id: 41, status: 'filed' }]);
      }
      if (/event_type IN \('submitted','corrected_submission'\)/.test(sql)) {
        return result(submittedAt ? [{ id: 90, event_type: 'submitted', occurred_at: submittedAt }] : []);
      }
      if (/SELECT id, occurred_at FROM snii_filing_events/.test(sql)) {
        return result(latestAt ? [{ id: 91, occurred_at: latestAt }] : []);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.recordFilingEvent(
      41, 17, 30, filingBody({
        event_type: 'accepted',
        attempt_no: attemptNo,
        authority_reference: 'CRT-RESPONSE-001',
      }), evidenceFile(), context(),
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_evidence_uploads|INSERT INTO snii_filing_events/.test(sql))).toBe(false);
  });

  test.each([
    ['does not increment the rejected attempt', 3, '2026-08-15T14:00:00.000-06:00'],
    ['predates the predecessor correction', 2, '2026-08-15T12:30:00.000-06:00'],
  ])('rejects a corrected submission that %s', async (_label, attemptNo, occurredAt) => {
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{
          id: 31,
          organization_id: 41,
          profile_id: 9,
          status: 'exported',
          first_exported_at: '2026-08-15T17:00:00.000Z',
          supersedes_batch_id: 32,
          correction_root_batch_id: 30,
          period_start: '2026-01-01',
          period_end: '2026-12-31',
          filing_kind: 'initial',
          filing_window: 'initial',
          filing_year: 2026,
          filing_frequency: 'initial',
          concession_title_id: null,
          electronic_folio: 'CRT-E-123',
          element_types_snapshot: JSON.stringify(['torre']),
        }]);
      }
      if (/SELECT id, profile_id, period_start/.test(sql)) {
        return result([{
          id: 30,
          profile_id: 9,
          status: 'correction_required',
          period_start: '2026-01-01',
          period_end: '2026-12-31',
          filing_kind: 'initial',
          filing_window: 'initial',
          filing_year: 2026,
          filing_frequency: 'initial',
          concession_title_id: null,
          electronic_folio: 'CRT-E-123',
        }]);
      }
      if (/event_type IN \('rejected','correction_requested'\)/.test(sql)) {
        return result([{ id: 92, attempt_no: 1, occurred_at: '2026-08-15T19:00:00.000Z' }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.recordFilingEvent(
      41, 17, 31, filingBody({
        event_type: 'corrected_submission',
        attempt_no: attemptNo,
        occurred_at: occurredAt,
        authority_reference: 'CRT-CORRECTED-002',
      }), evidenceFile(), context(),
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) =>
      /INSERT INTO snii_evidence_uploads|INSERT INTO snii_filing_events/.test(sql))).toBe(false);
  });

  test.each([
    ['empty bytes', evidenceFile(Buffer.alloc(0))],
    ['unsafe filename', evidenceFile(undefined, { originalname: '../acuse.pdf' })],
  ])('rejects %s before opening a filing transaction', async (_label, file) => {
    await expect(service.recordFilingEvent(
      41, 17, 30, filingBody(), file, context(),
    )).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });

    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('retained evidence bytes and the batch state roll back together when audit fails', async () => {
    const evidenceBytes = Buffer.from('atomic CRT filing evidence\n', 'utf8');
    const uploadedEvidence = evidenceFile(evidenceBytes, { originalname: 'filing-confirmation.pdf' });
    const evidenceHash = service._test.sha256(evidenceBytes);
    const auditFailure = new Error('filing audit unavailable');
    let uploadInsert;
    let filingInsert;
    const connection = transactionWith((sql, params) => {
      if (/SELECT \* FROM snii_report_batches WHERE id/.test(sql)) {
        return result([{
          id: 30,
          organization_id: 41,
          status: 'exported',
          first_exported_at: '2026-08-15T17:00:00.000Z',
          supersedes_batch_id: null,
          element_types_snapshot: JSON.stringify(['torre']),
        }]);
      }
      if (/SELECT DISTINCT element_type FROM snii_report_artifacts/.test(sql)) {
        return result([{ element_type: 'torre' }]);
      }
      if (/INSERT INTO snii_evidence_uploads/.test(sql)) {
        uploadInsert = { sql, params };
        return result({ insertId: 91, affectedRows: 1 });
      }
      if (/INSERT INTO snii_filing_events/.test(sql)) {
        filingInsert = { sql, params };
        return result({ insertId: 92, affectedRows: 1 });
      }
      if (/UPDATE snii_report_batches SET status = \?/.test(sql)) {
        return result({ affectedRows: 1 });
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return Promise.reject(auditFailure);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.recordFilingEvent(
      41, 17, 30, filingBody({ authority_reference: 'CRT-VENTANILLA-ATOMIC-001' }),
      uploadedEvidence, context(),
    )).rejects.toBe(auditFailure);

    expect(uploadInsert.params.slice(1, 6)).toEqual([
      'filing-confirmation.pdf', 'application/pdf', evidenceBytes.length,
      evidenceHash, evidenceBytes,
    ]);
    expect(filingInsert.params.slice(7, 13)).toEqual([
      91, 'filing-confirmation.pdf', 'application/pdf', evidenceBytes.length,
      evidenceBytes, evidenceHash,
    ]);
    expect(connection.execute.mock.calls.some(([sql, params]) =>
      /UPDATE snii_report_batches SET status = \?/.test(sql) && params[0] === 'filed')).toBe(true);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('dedicated evidence download verifies bytes and commits its audit before returning', async () => {
    const evidenceBytes = Buffer.from('immutable filing evidence\n', 'utf8');
    const evidenceHash = service._test.sha256(evidenceBytes);
    const connection = transactionWith((sql, params) => {
      if (/FROM snii_filing_events/.test(sql)) {
        expect(params).toEqual([92, 41]);
        return result([{
          id: 92,
          batch_id: 30,
          evidence_file_name: 'acuse.pdf',
          evidence_mime_type: 'application/pdf',
          evidence_byte_size: evidenceBytes.length,
          evidence_sha256: evidenceHash,
          evidence_content: evidenceBytes,
        }]);
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return result({ insertId: 93 });
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const downloaded = await service.getFilingEvidenceForDownload(41, 17, 92, context());

    expect(downloaded.evidence_content).toEqual(evidenceBytes);
    expect(downloaded.evidence_sha256).toBe(evidenceHash);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  test('dedicated evidence download fails closed on audit or retained-byte corruption', async () => {
    const evidenceBytes = Buffer.from('immutable filing evidence\n', 'utf8');
    const evidenceHash = service._test.sha256(evidenceBytes);
    const auditFailure = new Error('evidence audit unavailable');
    let connection = transactionWith((sql) => {
      if (/FROM snii_filing_events/.test(sql)) {
        return result([{
          id: 92,
          batch_id: 30,
          evidence_file_name: 'acuse.pdf',
          evidence_mime_type: 'application/pdf',
          evidence_byte_size: evidenceBytes.length,
          evidence_sha256: evidenceHash,
          evidence_content: evidenceBytes,
        }]);
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return Promise.reject(auditFailure);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.getFilingEvidenceForDownload(41, 17, 92, context()))
      .rejects.toBe(auditFailure);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();

    jest.clearAllMocks();
    connection = transactionWith((sql) => {
      if (/FROM snii_filing_events/.test(sql)) {
        return result([{
          id: 92,
          batch_id: 30,
          evidence_file_name: 'acuse.pdf',
          evidence_mime_type: 'application/pdf',
          evidence_byte_size: evidenceBytes.length,
          evidence_sha256: evidenceHash,
          evidence_content: Buffer.from('tampered evidence bytes\n', 'utf8'),
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.getFilingEvidenceForDownload(41, 17, 92, context()))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(connection.execute.mock.calls.some(([sql]) => /INSERT INTO snii_audit_events/.test(sql)))
      .toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('a failed audit insert rolls back a mutation', async () => {
    const auditFailure = new Error('audit storage unavailable');
    const connection = transactionWith((sql) => {
      if (/SELECT id FROM snii_reporting_profiles/.test(sql)) return result([{ id: 9 }]);
      if (/FROM sites WHERE id =/.test(sql)) {
        return result([{ id: 5, site_type: 'tower', name: 'Tower 5', updated_at: null }]);
      }
      if (/INSERT INTO snii_asset_registry/.test(sql)) return result({ insertId: 71 });
      if (/INSERT INTO snii_audit_events/.test(sql)) return Promise.reject(auditFailure);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.createAsset(41, 17, {
      profile_id: 9,
      source_type: 'site',
      source_id: 5,
      element_type: 'torre',
    }, context())).rejects.toBe(auditFailure);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('an artifact is not returned when its access audit cannot commit', async () => {
    const auditFailure = new Error('audit storage unavailable');
    const connection = transactionWith((sql) => {
      if (/SELECT \* FROM snii_report_artifacts/.test(sql)) {
        return result([{
          id: 81,
          organization_id: 41,
          batch_id: 30,
          file_name: 'torre.csv',
          content_text: 'CODIGO_IDENTIFICADOR\r\nT-1',
          content_sha256: 'b'.repeat(64),
        }]);
      }
      if (/INSERT INTO snii_audit_events/.test(sql)) return Promise.reject(auditFailure);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service.getArtifactForDownload(41, 17, 81, context()))
      .rejects.toBe(auditFailure);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
