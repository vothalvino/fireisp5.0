'use strict';

const { validate } = require('../src/middleware/validate');
const schemas = require('../src/middleware/schemas/sniiReporting');

function validationError(schema, body) {
  const next = jest.fn();
  validate(schema)({ body }, {}, next);
  return next.mock.calls[0]?.[0];
}

function expectAccepted(schema, body) {
  expect(validationError(schema, body)).toBeUndefined();
}

function expectRejected(schema, body, field) {
  const error = validationError(schema, body);
  expect(error).toEqual(expect.objectContaining({
    statusCode: 422,
    code: 'VALIDATION_ERROR',
  }));
  expect(error.details).toEqual(expect.arrayContaining([
    expect.objectContaining({ field }),
  ]));
}

const SHA = 'a'.repeat(64);

function validProfile() {
  return {
    electronic_folio: 'CRT-E-123',
    source_channel: 'crt_ventanilla_current',
    source_attestation_reference: 'CRT-PORTAL-REVIEW-2026-08-15',
    adapter_reconciliation_reference: 'CURRENT-PACKAGE-ADAPTER-REVIEW-2026-08-15',
    adapter_reconciliation_sha256: 'b'.repeat(64),
    adapter_reconciled_at: '2026-08-15T10:00:00-06:00',
    template_version: '2026-01',
    template_source_url: 'https://www.example.gob.mx/template',
    template_sha256: SHA,
    dictionary_version: '2026-01',
    dictionary_source_url: 'https://www.example.gob.mx/dictionary',
    dictionary_sha256: SHA,
    annex_v_version: '2026-01',
    annex_v_source_url: 'https://www.example.gob.mx/annex-v',
    annex_v_sha256: SHA,
    official_sources_reviewed_at: '2026-08-15T10:00:00-06:00',
  };
}

describe('SNII sensitive input schemas', () => {
  test('requires separately pinned template, dictionary and Annex V sources', () => {
    expectAccepted(schemas.upsertProfile, validProfile());

    for (const field of [
      'source_channel', 'source_attestation_reference',
      'adapter_reconciliation_reference', 'adapter_reconciliation_sha256',
      'adapter_reconciled_at',
      'template_version', 'template_source_url', 'template_sha256',
      'dictionary_version', 'dictionary_source_url', 'dictionary_sha256',
      'annex_v_version', 'annex_v_source_url', 'annex_v_sha256',
      'official_sources_reviewed_at',
    ]) {
      const body = validProfile();
      delete body[field];
      expectRejected(schemas.upsertProfile, body, field);
    }
  });

  test('rejects unpinned hashes and non-HTTPS official source URLs', () => {
    expectRejected(schemas.upsertProfile, {
      ...validProfile(), template_sha256: 'not-a-sha256',
    }, 'template_sha256');
    expectRejected(schemas.upsertProfile, {
      ...validProfile(), dictionary_source_url: 'http://example.test/dictionary',
    }, 'dictionary_source_url');
  });

  test('rejects arrays and primitives where reviewed JSON objects are required', () => {
    const base = {
      profile_id: 1,
      source_type: 'manual',
      element_type: 'torre',
    };
    expectRejected(schemas.createAsset, { ...base, manual_payload: [] }, 'manual_payload');
    expectRejected(schemas.createAsset, { ...base, field_overrides: 'LAT=1' }, 'field_overrides');
    expectAccepted(schemas.createAsset, { ...base, manual_payload: { LATITUD: 1 } });
  });

  test('requires an explicit filing kind, window, year and frequency', () => {
    const body = {
      profile_id: 1,
      period_start: '2026-01-01',
      period_end: '2026-06-30',
      filing_kind: 'update',
      filing_window: 'first_semiannual',
      filing_year: 2026,
      filing_frequency: 'semiannual',
    };
    expectAccepted(schemas.createBatch, body);
    expectAccepted(schemas.createBatch, {
      ...body,
      supersedes_batch_id: 9,
      supersession_reason: 'Replaced after source inventory review',
    });
    expectRejected(schemas.createBatch, {
      ...body,
      supersedes_batch_id: 9,
      supersession_reason: '',
    }, 'supersession_reason');
    for (const field of ['filing_kind', 'filing_window', 'filing_year', 'filing_frequency']) {
      const incomplete = { ...body };
      delete incomplete[field];
      expectRejected(schemas.createBatch, incomplete, field);
    }
  });

  test('requires timing identity while keeping evidence identity server-derived', () => {
    const body = {
      event_type: 'submitted',
      attempt_no: 1,
      occurred_at: '2026-08-15T10:00:00-06:00',
      occurred_timezone: 'America/Chihuahua',
      authority_reference: 'VENTANILLA-123',
    };
    expectAccepted(schemas.createFilingEvent, body);
    for (const field of [
      'attempt_no', 'occurred_at', 'occurred_timezone',
      'authority_reference',
    ]) {
      const incomplete = { ...body };
      delete incomplete[field];
      expectRejected(schemas.createFilingEvent, incomplete, field);
    }
    expect(schemas.createFilingEvent).not.toHaveProperty('evidence_upload_id');
    expect(schemas.createFilingEvent).not.toHaveProperty('evidence_file_id');
    expect(schemas.createFilingEvent).not.toHaveProperty('evidence_sha256');
  });

  test('requires both the source and classification preview hashes for approval', () => {
    expectAccepted(schemas.approveAsset, {
      expected_source_snapshot_hash: SHA,
      expected_classification_hash: 'b'.repeat(64),
    });
    expectRejected(schemas.approveAsset, {
      expected_source_snapshot_hash: SHA,
    }, 'expected_classification_hash');
    expectRejected(schemas.approveAsset, {
      expected_classification_hash: SHA,
    }, 'expected_source_snapshot_hash');
  });

  test('does not expose tenant, actor, state or approval columns as client-fillable fields', () => {
    for (const schema of [
      schemas.upsertProfile, schemas.setApplicability, schemas.createAsset,
      schemas.updateAsset, schemas.approveAsset, schemas.createBatch,
      schemas.approveBatch, schemas.generateArtifact, schemas.createFilingEvent,
    ]) {
      for (const protectedField of [
        'organization_id', 'created_by', 'updated_by', 'classified_by',
        'approved_by', 'approval_status', 'full_load', 'content_text',
        'content_sha256', 'evidence_content', 'evidence_upload_id',
        'evidence_file_id', 'evidence_sha256', 'event_hash',
      ]) {
        expect(schema).not.toHaveProperty(protectedField);
      }
    }
    for (const schema of [
      schemas.upsertProfile, schemas.createAsset, schemas.updateAsset,
      schemas.approveAsset, schemas.createBatch, schemas.approveBatch,
      schemas.generateArtifact, schemas.createFilingEvent,
    ]) {
      expect(schema).not.toHaveProperty('status');
    }
  });
});
