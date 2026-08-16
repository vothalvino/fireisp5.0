// =============================================================================
// FireISP 5.0 — SNII preparation validation schemas
// =============================================================================

'use strict';

const SOURCE_TYPES = ['site', 'device', 'network_link', 'fiber_route', 'infrastructure_point', 'manual'];
const DECISIONS = ['unreviewed', 'included', 'excluded'];
const EXCLUSION_REASONS = ['dummy', 'test', 'cpe', 'customer_drop', 'duplicate', 'not_applicable', 'reported_by_owner', 'other'];
const OWNERSHIP = ['owned', 'leased', 'third_party'];
const APPLICABILITY = ['unreviewed', 'applicable', 'not_applicable'];
const FILING_EVENTS = ['submitted', 'acuse_received', 'accepted', 'rejected', 'correction_requested', 'corrected_submission'];

const upsertProfile = {
  concession_title_id: { type: 'number', min: 1 },
  electronic_folio: { type: 'string', required: true, min: 1, max: 100 },
  source_channel: { type: 'string', required: true, enum: ['crt_ventanilla_current'] },
  source_attestation_reference: { type: 'string', required: true, min: 1, max: 500 },
  adapter_reconciliation_reference: { type: 'string', required: true, min: 1, max: 500 },
  adapter_reconciliation_sha256: { type: 'string', required: true, pattern: /^[a-f0-9]{64}$/ },
  adapter_reconciled_at: { type: 'string', required: true },
  template_version: { type: 'string', required: true, min: 1, max: 100 },
  template_source_url: { type: 'string', required: true, min: 1, max: 1000, pattern: /^https:\/\//i },
  template_sha256: { type: 'string', required: true, pattern: /^[a-f0-9]{64}$/ },
  template_effective_date: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
  dictionary_version: { type: 'string', required: true, min: 1, max: 100 },
  dictionary_source_url: { type: 'string', required: true, min: 1, max: 1000, pattern: /^https:\/\//i },
  dictionary_sha256: { type: 'string', required: true, pattern: /^[a-f0-9]{64}$/ },
  annex_v_version: { type: 'string', required: true, min: 1, max: 100 },
  annex_v_source_url: { type: 'string', required: true, min: 1, max: 1000, pattern: /^https:\/\//i },
  annex_v_sha256: { type: 'string', required: true, pattern: /^[a-f0-9]{64}$/ },
  official_sources_reviewed_at: { type: 'string', required: true },
  source_freshness_days: { type: 'number', min: 1, max: 3650 },
};

const setSubjectApplicability = {
  status: { type: 'string', required: true, enum: APPLICABILITY },
  applicability_basis: { type: 'string', max: 2000 },
  external_decision_reference: { type: 'string', max: 500 },
};

const setApplicability = {
  status: { type: 'string', required: true, enum: APPLICABILITY },
  rationale: { type: 'string', max: 1000 },
  population_status: { type: 'string', enum: ['unreviewed', 'has_assets', 'zero_population'] },
  population_evidence_reference: { type: 'string', max: 500 },
};

const createAsset = {
  profile_id: { type: 'number', required: true, min: 1 },
  source_type: { type: 'string', required: true, enum: SOURCE_TYPES },
  source_id: { type: 'number', min: 1 },
  element_type: { type: 'string', required: true, min: 1, max: 64 },
  decision: { type: 'string', enum: DECISIONS },
  exclusion_reason: { type: 'string', enum: EXCLUSION_REASONS },
  decision_evidence_reference: { type: 'string', max: 500 },
  official_code: { type: 'string', max: 191 },
  ownership: { type: 'string', enum: OWNERSHIP },
  owner_name: { type: 'string', max: 255 },
  field_overrides: { type: 'object' },
  manual_payload: { type: 'object' },
};

const updateAsset = {
  element_type: { type: 'string', min: 1, max: 64 },
  decision: { type: 'string', enum: DECISIONS },
  exclusion_reason: { type: 'string', enum: EXCLUSION_REASONS },
  decision_evidence_reference: { type: 'string', max: 500 },
  official_code: { type: 'string', max: 191 },
  ownership: { type: 'string', enum: OWNERSHIP },
  owner_name: { type: 'string', max: 255 },
  field_overrides: { type: 'object' },
  manual_payload: { type: 'object' },
};

const approveAsset = {
  expected_source_snapshot_hash: { type: 'string', required: true, pattern: /^[a-f0-9]{64}$/ },
  expected_classification_hash: { type: 'string', required: true, pattern: /^[a-f0-9]{64}$/ },
};

const createBatch = {
  profile_id: { type: 'number', required: true, min: 1 },
  supersedes_batch_id: { type: 'number', min: 1 },
  supersession_reason: { type: 'string', min: 1, max: 500 },
  period_start: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  period_end: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  filing_kind: { type: 'string', required: true, enum: ['initial', 'update', 'voluntary'] },
  filing_window: { type: 'string', required: true, enum: ['initial', 'first_semiannual', 'second_combined', 'anytime'] },
  filing_year: { type: 'number', required: true, min: 2000, max: 2100 },
  filing_frequency: { type: 'string', required: true, enum: ['initial', 'semiannual', 'annual_and_semiannual', 'voluntary'] },
};

const approveBatch = {
  expected_snapshot_hash: { type: 'string', required: true, pattern: /^[a-f0-9]{64}$/ },
};

const generateArtifact = {
  element_type: { type: 'string', required: true, min: 1, max: 64 },
  format: { type: 'string', required: true, enum: ['csv', 'kml'] },
};

const createFilingEvent = {
  event_type: { type: 'string', required: true, enum: FILING_EVENTS },
  attempt_no: { type: 'number', required: true, min: 1, max: 65535 },
  occurred_at: { type: 'string', required: true },
  occurred_timezone: { type: 'string', required: true, min: 1, max: 64 },
  authority_reference: { type: 'string', required: true, min: 1, max: 191 },
  notes: { type: 'string', max: 2000 },
};

module.exports = {
  SOURCE_TYPES,
  DECISIONS,
  EXCLUSION_REASONS,
  OWNERSHIP,
  APPLICABILITY,
  FILING_EVENTS,
  upsertProfile,
  setSubjectApplicability,
  setApplicability,
  createAsset,
  updateAsset,
  approveAsset,
  createBatch,
  approveBatch,
  generateArtifact,
  createFilingEvent,
};
