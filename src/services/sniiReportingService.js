// =============================================================================
// FireISP 5.0 — MX SNII infrastructure-report preparation service
// =============================================================================
// This service prepares deterministic, evidence-pinned full-load files.  It
// does not contact the authority, submit a filing, or claim compliance.  Every
// operational record is tenant-scoped, explicitly classified, separately
// approved, and copied into an immutable batch before it can be exported.
// =============================================================================

'use strict';

const crypto = require('node:crypto');
const db = require('../config/database');
const {
  CATALOG_VERSION,
  ELEMENT_TYPES,
  HISTORICAL_TEMPLATE_INDEX_URL,
  HISTORICAL_DICTIONARY_INDEX_URL,
  CURRENT_CRT_PROCEDURE_URL,
  canonicalElementType,
  getElementType,
} = require('./sniiCatalog');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require('../utils/errors');

const GENERATOR_VERSION = 'fireisp-snii-preparer/1';
const SOURCE_TYPES = new Set([
  'site', 'device', 'network_link', 'fiber_route', 'infrastructure_point', 'manual',
]);
const TERMINAL_BATCH_STATES = new Set([
  'approved', 'exported', 'filed', 'correction_required', 'accepted', 'superseded',
]);

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function positiveId(value, field) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ValidationError(`Invalid ${field}`);
  return parsed;
}

function nonblank(value, field, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ValidationError(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function exactTimestamp(value, field, { futureAllowed = false } = {}) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} must be an ISO 8601 date-time with a timezone`);
  }
  const parsed = new Date(value);
  if (!futureAllowed && parsed.getTime() > Date.now() + 60 * 1000) {
    throw new ValidationError(`${field} cannot be in the future`);
  }
  return parsed;
}

function exactDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be an ISO date`);
  }
  return value;
}

function explicitOffsetMinutes(value) {
  if (value.endsWith('Z')) return 0;
  const match = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function timezoneOffsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second);
  return Math.round((representedUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

async function execute(executor, sql, params = []) {
  return typeof executor.execute === 'function'
    ? executor.execute(sql, params)
    : executor.query(sql, params);
}

async function rows(executor, sql, params = []) {
  const [result] = await execute(executor, sql, params);
  return result;
}

async function one(executor, sql, params = []) {
  const result = await rows(executor, sql, params);
  return result[0] || null;
}

async function withTransaction(work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }
}

function requestEvidence(context = {}) {
  return {
    ip_address: context.ipAddress || null,
    user_agent: context.userAgent ? String(context.userAgent).slice(0, 500) : null,
  };
}

async function appendAudit(connection, context, action, entityType, entityId, details = {}) {
  const actorId = positiveId(context.actorId, 'actor id');
  const evidence = requestEvidence(context);
  await execute(connection,
    `INSERT INTO snii_audit_events
       (organization_id, actor_user_id, action, entity_type, entity_id, details,
        ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [context.organizationId, actorId, action, entityType, entityId || null,
      stableStringify(details), evidence.ip_address, evidence.user_agent]);
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    ...row,
    concession_title_snapshot: parseJson(row.concession_title_snapshot, null),
    source_freshness_days: Number(row.source_freshness_days),
  };
}

function normalizeRegistry(row) {
  if (!row) return null;
  return {
    ...row,
    field_overrides: parseJson(row.field_overrides, {}),
    manual_payload: parseJson(row.manual_payload, null),
    reviewed_payload: parseJson(row.reviewed_payload, null),
  };
}

function normalizeBatch(row) {
  if (!row) return null;
  return {
    ...row,
    full_load: Boolean(row.full_load),
    concession_title_snapshot: parseJson(row.concession_title_snapshot, null),
    element_types_snapshot: parseJson(row.element_types_snapshot, []),
    element_contract_snapshot: parseJson(row.element_contract_snapshot, []),
    applicability_snapshot: parseJson(row.applicability_snapshot, null),
    validation_result: parseJson(row.validation_result, null),
  };
}

function concessionTitleSnapshot(title) {
  if (!title) return null;
  return {
    id: Number(title.id),
    title_number: title.title_number,
    concession_type: title.concession_type,
    services_authorized: stableValue(parseJson(title.services_authorized, [])),
    geographic_scope: title.geographic_scope ?? null,
    spectrum_bands: stableValue(parseJson(title.spectrum_bands, null)),
    granted_date: snapshotDate(title.granted_date),
    expiration_date: snapshotDate(title.expiration_date),
    renewal_filed_at: snapshotDate(title.renewal_filed_at),
    regulatory_body: title.regulatory_body,
    document_file_id: snapshotNumber(title.document_file_id),
    status: title.status,
  };
}

async function getConcessionTitle(executor, organizationId, titleId, lock = false) {
  return one(executor,
    `SELECT id, title_number, concession_type, services_authorized, geographic_scope,
            spectrum_bands, granted_date, expiration_date, renewal_filed_at,
            regulatory_body, document_file_id, status
       FROM concession_titles
      WHERE id = ? AND organization_id = ? AND deleted_at IS NULL LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [titleId, organizationId]);
}

function normalizeItem(row) {
  return {
    ...row,
    snapshot_payload: parseJson(row.snapshot_payload, {}),
    validation_errors: parseJson(row.validation_errors, null),
  };
}

function getCatalog() {
  return {
    catalog_version: CATALOG_VERSION,
    module_mode: 'preparation_only',
    authority: 'CRT',
    legal_basis: 'LMTR_ARTICLES_174_181',
    preparation_only: true,
    automatic_submission: false,
    source_types: [...SOURCE_TYPES],
    decisions: ['unreviewed', 'included', 'excluded'],
    exclusion_reasons: ['dummy', 'test', 'cpe', 'customer_drop', 'duplicate',
      'not_applicable', 'reported_by_owner', 'other'],
    applicability_states: ['unreviewed', 'applicable', 'not_applicable'],
    batch_states: ['draft', 'validated', 'approved', 'exported', 'filed',
      'correction_required', 'accepted', 'superseded'],
    filing_event_types: ['submitted', 'acuse_received', 'accepted', 'rejected',
      'correction_requested', 'corrected_submission'],
    export_formats: ['csv', 'kml'],
    source_posture: {
      embedded_contract: 'historical_2024_bootstrap_reference',
      historical_template_index_url: HISTORICAL_TEMPLATE_INDEX_URL,
      historical_dictionary_index_url: HISTORICAL_DICTIONARY_INDEX_URL,
      current_crt_procedure_url: CURRENT_CRT_PROCEDURE_URL,
      current_templates_location: 'authenticated_crt_ventanilla',
      current_profile_pins_required: true,
      artifact_origin: 'historical_adapter_reconciled_to_operator_pinned_current_package',
      current_package_bytes_are_not_ingested: true,
    },
    element_types: ELEMENT_TYPES,
  };
}

function advisorySchedule(lastDigit) {
  if (!Number.isInteger(lastDigit)) return {
    folio_last_digit: null,
    first_window: null,
    second_window: null,
    next_window: null,
    advisory: true,
    note: 'No folio digit was available; confirm the current CRT/Annex V schedule.',
  };
  const group = lastDigit === 0 || lastDigit === 9 ? 0
    : lastDigit === 1 || lastDigit === 8 ? 1
      : lastDigit === 2 || lastDigit === 7 ? 2
        : lastDigit === 3 || lastDigit === 6 ? 3 : 4;
  const year = new Date().getUTCFullYear();
  const window = (filingYear, startMonth) => ({
    year: filingYear,
    start_month: startMonth,
    end_month: startMonth + 1,
    reference_range: `${filingYear}-${String(startMonth).padStart(2, '0')}..${filingYear}-${String(startMonth + 1).padStart(2, '0')}`,
  });
  const first = window(year, group + 1);
  const second = window(year, group + 7);
  const currentMonth = new Date().getUTCMonth() + 1;
  const next = currentMonth <= first.end_month ? { kind: 'first_semiannual', ...first }
    : currentMonth <= second.end_month ? { kind: 'second_combined', ...second }
      : { kind: 'first_semiannual', ...window(year + 1, group + 1) };
  return {
    folio_last_digit: lastDigit,
    first_window: first.reference_range,
    second_window: second.reference_range,
    next_window: next.reference_range,
    next_window_kind: next.kind,
    advisory: true,
    source: CURRENT_CRT_PROCEDURE_URL,
    note: 'Reference month ranges only; revalidate current CRT/Annex V rules before filing.',
  };
}

async function getProfile(organizationId) {
  const profile = normalizeProfile(await one(db,
    'SELECT * FROM snii_reporting_profiles WHERE organization_id = ? LIMIT 1',
    [organizationId]));
  if (!profile) return null;
  profile.element_applicability = await rows(db,
    `SELECT element_type, applicability, rationale, population_status,
            population_evidence_reference, population_reviewed_by, population_reviewed_at,
            reviewed_by, reviewed_at, updated_at
       FROM snii_element_applicability
      WHERE organization_id = ? AND profile_id = ? ORDER BY element_type`,
    [organizationId, profile.id]);
  return profile;
}

async function getProfileEnvelope(organizationId) {
  const profile = await getProfile(organizationId);
  if (!profile) {
    return {
      data: null,
      applicability: [],
      readiness: {
        ready: false,
        blockers: [{ code: 'profile_missing' }],
        counts: {},
        schedule: {},
      },
    };
  }
  const state = await readiness(db, organizationId, profile, {
    filing_kind: 'initial',
    filing_window: 'initial',
  });
  const assets = await listAssetsFrom(db, organizationId);
  const candidates = await collectCandidates(db, organizationId);
  const applicability = profile.element_applicability;
  const lastDigitMatch = String(profile.electronic_folio || '').match(/(\d)(?!.*\d)/);
  return {
    data: Object.fromEntries(Object.entries(profile)
      .filter(([key]) => key !== 'element_applicability')),
    applicability,
    readiness: {
      ready: state.blockers.length === 0,
      blockers: state.blockers,
      counts: {
        catalog_element_types: ELEMENT_TYPES.length,
        applicability_unreviewed: applicability.filter(item =>
          item.applicability === 'unreviewed').length,
        population_unreviewed: applicability.filter(item =>
          item.applicability === 'applicable' && item.population_status === 'unreviewed').length,
        candidates: candidates.length,
        assets_unreviewed: assets.filter(item => item.decision === 'unreviewed').length,
        assets_pending_approval: assets.filter(item =>
          item.decision !== 'unreviewed' && item.approval_status !== 'approved').length,
        assets_included: assets.filter(item => item.decision === 'included').length,
        assets_excluded: assets.filter(item => item.decision === 'excluded').length,
      },
      schedule: advisorySchedule(lastDigitMatch ? Number(lastDigitMatch[1]) : null),
    },
  };
}

function validateProfileDecision(body) {
  const status = body.subject_applicability || 'unreviewed';
  if (status !== 'unreviewed') {
    nonblank(body.applicability_basis, 'applicability_basis');
    nonblank(body.external_decision_reference, 'external_decision_reference', 500);
  }
}

async function upsertProfile(organizationId, actorId, body, context = {}) {
  const reviewedAt = exactTimestamp(body.official_sources_reviewed_at,
    'official_sources_reviewed_at');
  const reconciledAt = exactTimestamp(body.adapter_reconciled_at, 'adapter_reconciled_at');
  if (reconciledAt < reviewedAt) {
    throw new ValidationError('adapter_reconciled_at cannot predate the source review');
  }
  const concessionTitleId = body.concession_title_id === null
    || body.concession_title_id === undefined
    ? null : positiveId(body.concession_title_id, 'concession_title_id');
  const electronicFolio = nonblank(body.electronic_folio, 'electronic_folio', 100);

  return withTransaction(async (connection) => {
    let titleSnapshot = null;
    let titleSnapshotHash = null;
    if (concessionTitleId) {
      const title = await getConcessionTitle(connection, organizationId, concessionTitleId, true);
      if (!title) throw new NotFoundError('Concession title');
      titleSnapshot = concessionTitleSnapshot(title);
      titleSnapshotHash = sha256(stableStringify(titleSnapshot));
    }

    const existing = await one(connection,
      `SELECT id, concession_title_id, electronic_folio,
              concession_title_sha256,
              subject_applicability, applicability_basis,
              external_decision_reference, applicability_decided_by, applicability_decided_at
         FROM snii_reporting_profiles WHERE organization_id = ? LIMIT 1 FOR UPDATE`,
      [organizationId]);
    const identityChanged = Boolean(existing) && (
      (existing.concession_title_id === null || existing.concession_title_id === undefined
        ? null : Number(existing.concession_title_id)) !== concessionTitleId
      || existing.electronic_folio !== electronicFolio
      || (existing.concession_title_sha256 ?? null) !== titleSnapshotHash
    );
    const applicability = identityChanged
      ? 'unreviewed' : existing?.subject_applicability || 'unreviewed';
    const values = [
      concessionTitleId,
      titleSnapshot ? stableStringify(titleSnapshot) : null,
      titleSnapshotHash,
      electronicFolio,
      body.source_channel,
      nonblank(body.source_attestation_reference, 'source_attestation_reference', 500),
      nonblank(body.adapter_reconciliation_reference,
        'adapter_reconciliation_reference', 500),
      body.adapter_reconciliation_sha256,
      CATALOG_VERSION,
      actorId,
      reconciledAt,
      nonblank(body.template_version, 'template_version', 100),
      nonblank(body.template_source_url, 'template_source_url', 1000),
      body.template_sha256,
      body.template_effective_date || null,
      nonblank(body.dictionary_version, 'dictionary_version', 100),
      nonblank(body.dictionary_source_url, 'dictionary_source_url', 1000),
      body.dictionary_sha256,
      nonblank(body.annex_v_version, 'annex_v_version', 100),
      nonblank(body.annex_v_source_url, 'annex_v_source_url', 1000),
      body.annex_v_sha256,
      actorId,
      reviewedAt,
      body.source_freshness_days || 180,
      applicability,
      identityChanged ? null : existing?.applicability_basis || null,
      identityChanged ? null : existing?.external_decision_reference || null,
      identityChanged ? null : existing?.applicability_decided_by || null,
      identityChanged ? null : existing?.applicability_decided_at || null,
      actorId,
    ];

    let profileId;
    if (existing) {
      await execute(connection,
        `UPDATE snii_reporting_profiles SET
           concession_title_id = ?, concession_title_snapshot = ?, concession_title_sha256 = ?,
           electronic_folio = ?, source_channel = ?,
           source_attestation_reference = ?, adapter_reconciliation_reference = ?,
           adapter_reconciliation_sha256 = ?, adapter_catalog_version = ?, adapter_reconciled_by = ?,
           adapter_reconciled_at = ?, template_version = ?,
           template_source_url = ?, template_sha256 = ?, template_effective_date = ?,
           dictionary_version = ?, dictionary_source_url = ?, dictionary_sha256 = ?,
           annex_v_version = ?, annex_v_source_url = ?, annex_v_sha256 = ?,
           official_sources_reviewed_by = ?, official_sources_reviewed_at = ?,
           source_freshness_days = ?, subject_applicability = ?, applicability_basis = ?,
           external_decision_reference = ?, applicability_decided_by = ?,
           applicability_decided_at = ?, updated_by = ?
         WHERE id = ? AND organization_id = ?`,
        [...values, existing.id, organizationId]);
      profileId = existing.id;
    } else {
      const [result] = await execute(connection,
        `INSERT INTO snii_reporting_profiles
          (organization_id, concession_title_id, concession_title_snapshot,
           concession_title_sha256, electronic_folio, source_channel,
           source_attestation_reference, adapter_reconciliation_reference,
           adapter_reconciliation_sha256, adapter_catalog_version,
           adapter_reconciled_by, adapter_reconciled_at,
           template_version, template_source_url, template_sha256, template_effective_date,
           dictionary_version, dictionary_source_url, dictionary_sha256,
           annex_v_version, annex_v_source_url, annex_v_sha256,
           official_sources_reviewed_by, official_sources_reviewed_at, source_freshness_days,
           subject_applicability, applicability_basis, external_decision_reference,
           applicability_decided_by, applicability_decided_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [organizationId, ...values.slice(0, -1), actorId, actorId]);
      profileId = result.insertId;
    }

    if (identityChanged) {
      await execute(connection,
        `UPDATE snii_element_applicability SET applicability = 'unreviewed', rationale = NULL,
            population_status = 'unreviewed', population_evidence_reference = NULL,
            population_reviewed_by = NULL, population_reviewed_at = NULL,
            reviewed_by = NULL, reviewed_at = NULL
          WHERE organization_id = ? AND profile_id = ?`,
        [organizationId, profileId]);
      await appendAudit(connection, { ...context, organizationId, actorId },
        'profile.identity_applicability_invalidated', 'profile', profileId, {
          old_concession_title_id: existing.concession_title_id,
          new_concession_title_id: concessionTitleId,
          old_electronic_folio: existing.electronic_folio,
          new_electronic_folio: electronicFolio,
          subject_applicability: 'unreviewed',
          element_applicability: 'unreviewed',
        });
    }

    for (const item of ELEMENT_TYPES) {
      await execute(connection,
        `INSERT IGNORE INTO snii_element_applicability
          (organization_id, profile_id, element_type) VALUES (?, ?, ?)`,
        [organizationId, profileId, item.slug]);
    }
    await appendAudit(connection, { ...context, organizationId, actorId },
      existing ? 'profile.updated' : 'profile.created', 'profile', profileId, {
        catalog_version: CATALOG_VERSION,
        subject_applicability: applicability,
        concession_title_id: concessionTitleId,
        concession_title_sha256: titleSnapshotHash,
        template_sha256: body.template_sha256,
        dictionary_sha256: body.dictionary_sha256,
        annex_v_sha256: body.annex_v_sha256,
        adapter_reconciliation_sha256: body.adapter_reconciliation_sha256,
      });
    return getProfileFrom(connection, organizationId, profileId);
  });
}

async function setSubjectApplicability(organizationId, actorId, body, context = {}) {
  validateProfileDecision({
    subject_applicability: body.status,
    applicability_basis: body.applicability_basis,
    external_decision_reference: body.external_decision_reference,
  });
  return withTransaction(async (connection) => {
    const profile = await one(connection,
      'SELECT id FROM snii_reporting_profiles WHERE organization_id = ? LIMIT 1 FOR UPDATE',
      [organizationId]);
    if (!profile) throw new NotFoundError('SNII reporting profile');
    const unreviewed = body.status === 'unreviewed';
    await execute(connection,
      `UPDATE snii_reporting_profiles SET subject_applicability = ?,
          applicability_basis = ?, external_decision_reference = ?,
          applicability_decided_by = ?, applicability_decided_at = ?, updated_by = ?
        WHERE id = ? AND organization_id = ?`,
      [body.status, unreviewed ? null : body.applicability_basis.trim(),
        unreviewed ? null : body.external_decision_reference.trim(),
        unreviewed ? null : actorId, unreviewed ? null : new Date(), actorId,
        profile.id, organizationId]);
    await appendAudit(connection, { ...context, organizationId, actorId },
      'profile.applicability_decided', 'profile', profile.id, {
        status: body.status,
        external_decision_reference: unreviewed ? null : body.external_decision_reference.trim(),
      });
    return getProfileFrom(connection, organizationId, profile.id);
  });
}

async function getProfileFrom(executor, organizationId, profileId) {
  const profile = normalizeProfile(await one(executor,
    'SELECT * FROM snii_reporting_profiles WHERE id = ? AND organization_id = ? LIMIT 1',
    [profileId, organizationId]));
  if (!profile) throw new NotFoundError('SNII reporting profile');
  profile.element_applicability = await rows(executor,
    `SELECT element_type, applicability, rationale, population_status,
            population_evidence_reference, population_reviewed_by, population_reviewed_at,
            reviewed_by, reviewed_at, updated_at
       FROM snii_element_applicability
      WHERE profile_id = ? AND organization_id = ? ORDER BY element_type`,
    [profileId, organizationId]);
  return profile;
}

async function setApplicability(organizationId, actorId, elementType, body, context = {}) {
  const canonical = canonicalElementType(elementType);
  if (!canonical) throw new ValidationError('Unknown SNII element type');
  if (body.status !== 'unreviewed') nonblank(body.rationale, 'rationale', 1000);
  const populationStatus = body.status === 'applicable'
    ? body.population_status : 'unreviewed';
  if (body.status === 'applicable'
      && !['has_assets', 'zero_population'].includes(populationStatus)) {
    throw new ValidationError('Applicable element types require a reviewed population_status');
  }
  if (populationStatus === 'zero_population') {
    nonblank(body.population_evidence_reference, 'population_evidence_reference', 500);
  }
  return withTransaction(async (connection) => {
    const profile = await one(connection,
      'SELECT id FROM snii_reporting_profiles WHERE organization_id = ? LIMIT 1 FOR UPDATE',
      [organizationId]);
    if (!profile) throw new NotFoundError('SNII reporting profile');
    const [result] = await execute(connection,
      `UPDATE snii_element_applicability SET applicability = ?, rationale = ?,
          population_status = ?, population_evidence_reference = ?,
          population_reviewed_by = ?, population_reviewed_at = ?,
          reviewed_by = ?, reviewed_at = ?
        WHERE organization_id = ? AND profile_id = ? AND element_type = ?`,
      [body.status, body.rationale?.trim() || null, populationStatus,
        populationStatus === 'zero_population'
          ? body.population_evidence_reference.trim() : null,
        body.status === 'applicable' ? actorId : null,
        body.status === 'applicable' ? new Date() : null,
        body.status === 'unreviewed' ? null : actorId,
        body.status === 'unreviewed' ? null : new Date(),
        organizationId, profile.id, canonical]);
    if (result.affectedRows !== 1) throw new NotFoundError('SNII element applicability');
    await appendAudit(connection, { ...context, organizationId, actorId },
      'applicability.reviewed', 'element_applicability', profile.id, {
        element_type: canonical,
        applicability: body.status,
        rationale: body.rationale?.trim() || null,
        population_status: populationStatus,
        population_evidence_reference: populationStatus === 'zero_population'
          ? body.population_evidence_reference.trim() : null,
      });
    return one(connection,
      `SELECT element_type, applicability, rationale, population_status,
              population_evidence_reference, population_reviewed_by, population_reviewed_at,
              reviewed_by, reviewed_at, updated_at
         FROM snii_element_applicability
        WHERE organization_id = ? AND profile_id = ? AND element_type = ?`,
      [organizationId, profile.id, canonical]);
  });
}

function suggestion(sourceType, row) {
  if (sourceType === 'site') {
    return {
      tower: 'torre',
      pop: 'central',
      data_center: 'central',
      aggregation_node: 'sitio_transmision',
    }[row.site_type] || null;
  }
  if (sourceType === 'device') {
    return { olt: 'olt', ptp: 'antena_microondas', ptmp_ap: 'antena_microondas' }[row.type] || null;
  }
  if (sourceType === 'network_link') return row.link_type === 'wireless' ? 'enlace_microondas' : null;
  if (sourceType === 'fiber_route') {
    return ['trunk', 'feeder'].includes(row.route_type)
      ? 'cable_fibra_transporte' : 'cable_fibra_acceso';
  }
  if (sourceType === 'infrastructure_point') {
    return { tower: 'torre', pole: 'poste', pop: 'sitio_transmision' }[row.type] || null;
  }
  return null;
}

async function resolveSite(executor, organizationId, sourceId) {
  const row = await one(executor,
    `SELECT id, name, site_type, address, city, state, country, zip_code,
            latitude, longitude, notes, status, created_at, updated_at, deleted_at
       FROM sites WHERE id = ? AND organization_id = ? LIMIT 1`,
    [sourceId, organizationId]);
  return row ? { ...row, source_type: 'site' } : null;
}

async function resolveDevice(executor, organizationId, sourceId) {
  const row = await one(executor,
    `SELECT d.id, d.site_id, d.name, d.type, d.category, d.manufacturer, d.model,
            d.serial_number, d.role, d.status, d.notes, d.created_at, d.updated_at,
            d.deleted_at, COALESCE(d.latitude, s.latitude) AS latitude,
            COALESCE(d.longitude, s.longitude) AS longitude, s.name AS site_name
       FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id AND s.organization_id = d.organization_id
      WHERE d.id = ? AND d.organization_id = ? AND d.organization_id IS NOT NULL
        AND d.type IN ('olt','ptp','ptmp_ap')
        AND d.client_id IS NULL AND d.contract_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM cpe_devices c
           WHERE c.device_id = d.id AND c.organization_id = d.organization_id
        )
      LIMIT 1`,
    [sourceId, organizationId]);
  return row ? { ...row, source_type: 'device' } : null;
}

async function resolveInfrastructurePoint(executor, organizationId, sourceId) {
  const row = await one(executor,
    `SELECT id, site_id, name, type, latitude, longitude, address, description,
            properties, is_active, created_at, updated_at, deleted_at
       FROM map_infrastructure_points
      WHERE id = ? AND organization_id = ? AND type IN ('tower','pole','pop') LIMIT 1`,
    [sourceId, organizationId]);
  if (!row) return null;
  return {
    ...row,
    properties: parseJson(row.properties, {}),
    source_type: 'infrastructure_point',
  };
}

async function resolveFiberRoute(executor, organizationId, sourceId) {
  const route = await one(executor,
    `SELECT id, name, route_type, from_device_id, to_device_id, from_splitter_id,
            to_splitter_id, to_onu_detail_id, cable_length_m, cable_type,
            installed_at, status, gis_path, notes, created_at, updated_at, deleted_at
       FROM fiber_routes
      WHERE id = ? AND organization_id = ? AND organization_id IS NOT NULL
        AND route_type <> 'drop' AND to_onu_detail_id IS NULL LIMIT 1`,
    [sourceId, organizationId]);
  if (!route) return null;
  const segments = await rows(executor,
    `SELECT id, sequence_no, coordinates, length_m, cable_type, burial_type, fiber_count,
            status, updated_at
       FROM fiber_route_segments
      WHERE fiber_route_id = ? AND organization_id = ? ORDER BY sequence_no, id`,
    [sourceId, organizationId]);
  return {
    ...route,
    gis_path: parseJson(route.gis_path, null),
    segments: segments.map(segment => ({
      ...segment,
      coordinates: parseJson(segment.coordinates, null),
    })),
    source_type: 'fiber_route',
  };
}

async function resolveNetworkLink(executor, organizationId, sourceId) {
  const row = await one(executor,
    `SELECT l.id, l.device_a_id, l.device_b_id, l.link_type, l.capacity_mbps,
            l.modulation, l.medium, l.role, l.status, l.notes, l.created_at,
            l.updated_at, l.deleted_at,
            a.name AS device_a_name, b.name AS device_b_name,
            COALESCE(a.latitude, sa.latitude) AS latitude_a,
            COALESCE(a.longitude, sa.longitude) AS longitude_a,
            COALESCE(b.latitude, sb.latitude) AS latitude_b,
            COALESCE(b.longitude, sb.longitude) AS longitude_b
       FROM network_links l
       JOIN devices a ON a.id = l.device_a_id AND a.organization_id = l.organization_id
       JOIN devices b ON b.id = l.device_b_id AND b.organization_id = l.organization_id
       LEFT JOIN sites sa ON sa.id = a.site_id AND sa.organization_id = l.organization_id
       LEFT JOIN sites sb ON sb.id = b.site_id AND sb.organization_id = l.organization_id
      WHERE l.id = ? AND l.organization_id = ? AND l.organization_id IS NOT NULL
        AND l.link_type = 'wireless'
        AND a.client_id IS NULL AND a.contract_id IS NULL
        AND b.client_id IS NULL AND b.contract_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM cpe_devices c
                         WHERE c.device_id IN (a.id, b.id)
                           AND c.organization_id = l.organization_id)
      LIMIT 1`,
    [sourceId, organizationId]);
  return row ? { ...row, source_type: 'network_link' } : null;
}

async function resolveSource(executor, organizationId, sourceType, sourceId, manualPayload = null) {
  if (!SOURCE_TYPES.has(sourceType)) throw new ValidationError('Unknown source_type');
  if (sourceType === 'manual') {
    if (sourceId !== null && sourceId !== undefined) {
      throw new ValidationError('Manual SNII sources cannot have source_id');
    }
    if (!manualPayload || typeof manualPayload !== 'object' || Array.isArray(manualPayload)) {
      throw new ValidationError('manual_payload is required for a manual source');
    }
    return { ...manualPayload, source_type: 'manual', updated_at: null };
  }
  const id = positiveId(sourceId, 'source_id');
  if (sourceType === 'site') return resolveSite(executor, organizationId, id);
  if (sourceType === 'device') return resolveDevice(executor, organizationId, id);
  if (sourceType === 'network_link') return resolveNetworkLink(executor, organizationId, id);
  if (sourceType === 'fiber_route') return resolveFiberRoute(executor, organizationId, id);
  return resolveInfrastructurePoint(executor, organizationId, id);
}

function normalizeCoordinates(value) {
  const geometry = parseJson(value, value);
  if (!geometry) return null;
  if (geometry.type === 'Feature') return normalizeCoordinates(geometry.geometry);
  if (geometry.type && Array.isArray(geometry.coordinates)) {
    return { type: geometry.type, coordinates: geometry.coordinates };
  }
  if (Array.isArray(geometry)) return { type: 'LineString', coordinates: geometry };
  return null;
}

function coordinateNumber(value) {
  if (missingValue(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function sourceGeometry(source, contract) {
  if (contract.geometry === 'Point') {
    const latitude = source.LATITUD ?? source.latitude;
    const longitude = source.LONGITUD ?? source.longitude;
    const latitudeNumber = coordinateNumber(latitude);
    const longitudeNumber = coordinateNumber(longitude);
    if (latitudeNumber === null || longitudeNumber === null) return null;
    return { type: 'Point', coordinates: [longitudeNumber, latitudeNumber] };
  }
  if (source.source_type === 'network_link') {
    const longitudeA = coordinateNumber(source.longitude_a);
    const latitudeA = coordinateNumber(source.latitude_a);
    const longitudeB = coordinateNumber(source.longitude_b);
    const latitudeB = coordinateNumber(source.latitude_b);
    if ([longitudeA, latitudeA, longitudeB, latitudeB].some(value => value === null)) {
      return null;
    }
    const coordinates = [
      [longitudeA, latitudeA],
      [longitudeB, latitudeB],
    ];
    return { type: 'LineString', coordinates };
  }
  if (source.source_type === 'fiber_route') {
    const direct = normalizeCoordinates(source.gis_path);
    if (direct) return direct;
    const segmentCoordinates = source.segments
      ?.map(segment => normalizeCoordinates(segment.coordinates)?.coordinates)
      .filter(Boolean).flat() || [];
    return segmentCoordinates.length >= 2
      ? { type: 'LineString', coordinates: segmentCoordinates } : null;
  }
  return normalizeCoordinates(source._geometry || source.geometry || source.coordinates);
}

function ownershipWire(value) {
  if (value === 'owned') return 'Propio';
  if (value === 'leased' || value === 'third_party') return 'Arrendado';
  return value || null;
}

function baseWireValues(source, asset, geometry) {
  const values = {
    CODIGO_IDENTIFICADOR: asset.official_code,
    MARCA: source.manufacturer || source.MARCA || null,
    MODELO: source.model || source.MODELO || source.cable_type || null,
    PROPIEDAD: ownershipWire(asset.ownership),
    PROPIETARIO: asset.owner_name || null,
    LATITUD: geometry?.type === 'Point' ? geometry.coordinates[1] : null,
    LONGITUD_TRAMO: source.cable_length_m || source.length_m || null,
    LONGITUD: geometry?.type === 'Point'
      ? geometry.coordinates[0]
      : (source.cable_length_m || source.length_m || null),
    TIPO_FIBRA: source.cable_type || null,
    NUMERO_HILOS: source.fiber_count || null,
    NODO_ORIGEN: source.device_a_name || source.from_device_id || null,
    NODO_DESTINO: source.device_b_name || source.to_device_id || null,
    CI_SITIOA: source.device_a_name || null,
    CI_SITIOB: source.device_b_name || null,
  };
  return values;
}

function buildReviewedPayload(source, asset) {
  const contract = getElementType(asset.element_type);
  if (!contract) throw new ValidationError('Unknown SNII element type');
  let geometry = sourceGeometry(source, contract);
  const overrides = parseJson(asset.field_overrides, {});
  const sourceValues = source.source_type === 'manual' ? source : {};
  const base = baseWireValues(source, asset, geometry);
  const wire = {};
  for (const header of contract.wire_headers) {
    const value = Object.prototype.hasOwnProperty.call(overrides, header)
      ? overrides[header]
      : (Object.prototype.hasOwnProperty.call(sourceValues, header) ? sourceValues[header] : base[header]);
    const constraint = contract.field_constraints[header];
    if (value === undefined || value === null || value === '') wire[header] = null;
    else if (constraint?.type === 'float') {
      const number = coordinateNumber(value);
      wire[header] = number === null ? value : number;
    }
    else wire[header] = String(value);
  }
  if (contract.geometry === 'Point') {
    const latitude = coordinateNumber(wire.LATITUD);
    const longitude = coordinateNumber(wire.LONGITUD);
    geometry = latitude === null || longitude === null
      ? null : { type: 'Point', coordinates: [longitude, latitude] };
  }
  return { wire, geometry };
}

function missingValue(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function validateWireRecord(contract, payload) {
  const errors = [];
  const wire = payload?.wire || {};
  for (const header of contract.required_headers) {
    if (missingValue(wire[header])) errors.push({ field: header, code: 'required' });
  }
  for (const [header, accepted] of Object.entries(contract.catalog_values)) {
    if (!missingValue(wire[header]) && !accepted.includes(String(wire[header]))) {
      errors.push({ field: header, code: 'catalog_value', accepted });
    }
  }
  for (const [header, constraint] of Object.entries(contract.field_constraints)) {
    const value = wire[header];
    if (missingValue(value)) continue;
    if (constraint.type === 'float') {
      const number = coordinateNumber(value);
      if (number === null) errors.push({ field: header, code: 'float' });
      if (number !== null && header === 'LATITUD' && (number < -90 || number > 90)) {
        errors.push({ field: header, code: 'latitude_range' });
      }
      if (number !== null && header === 'LONGITUD' && (number < -180 || number > 180)) {
        errors.push({ field: header, code: 'longitude_range' });
      }
    } else {
      const string = String(value);
      if (string.length > constraint.max_length) {
        errors.push({ field: header, code: 'max_length', max_length: constraint.max_length });
      }
      const coordinateString = ['LATITUD', 'LONGITUD'].includes(header)
        && /^-?\d+(?:\.\d+)?$/.test(string);
      if (/^[\t\r\n=+@-]/.test(string) && !coordinateString) {
        errors.push({ field: header, code: 'unsafe_spreadsheet_text' });
      }
    }
  }
  if (!payload?.geometry || payload.geometry.type !== contract.geometry) {
    errors.push({ field: '_geometry', code: `required_${contract.geometry}` });
  } else {
    const validPosition = (position) => {
      if (!Array.isArray(position) || position.length < 2) return false;
      const longitude = coordinateNumber(position[0]);
      const latitude = coordinateNumber(position[1]);
      return longitude !== null && latitude !== null
        && longitude >= -180 && longitude <= 180
        && latitude >= -90 && latitude <= 90;
    };
    if (contract.geometry === 'Point' && !validPosition(payload.geometry.coordinates)) {
      errors.push({ field: '_geometry', code: 'invalid_point' });
    }
    if (contract.geometry === 'Point' && validPosition(payload.geometry.coordinates)) {
      const wireLongitude = coordinateNumber(wire.LONGITUD);
      const wireLatitude = coordinateNumber(wire.LATITUD);
      if (wireLongitude === null || wireLatitude === null) {
        errors.push({ field: '_geometry', code: 'invalid_point_wire_coordinates' });
      } else if (wireLongitude !== coordinateNumber(payload.geometry.coordinates[0])
          || wireLatitude !== coordinateNumber(payload.geometry.coordinates[1])) {
        errors.push({ field: '_geometry', code: 'point_wire_geometry_mismatch' });
      }
    }
    if (contract.geometry === 'LineString') {
      const line = payload.geometry.coordinates;
      if (!Array.isArray(line) || line.length < 2 || !line.every(validPosition)) {
        errors.push({ field: '_geometry', code: 'invalid_linestring' });
      }
    }
    if (contract.geometry === 'Polygon') {
      const coordinates = payload.geometry.coordinates;
      const ring = Array.isArray(coordinates?.[0]?.[0]) ? coordinates[0] : coordinates;
      const closed = Array.isArray(ring) && ring.length >= 4
        && validPosition(ring[0]) && validPosition(ring[ring.length - 1])
        && Number(ring[0][0]) === Number(ring[ring.length - 1][0])
        && Number(ring[0][1]) === Number(ring[ring.length - 1][1]);
      if (!closed || !ring.every(validPosition)) {
        errors.push({ field: '_geometry', code: 'invalid_polygon_outer_ring' });
      }
    }
  }
  return errors;
}

function duplicateOfficialCodeErrors(items) {
  const seen = new Map();
  const errors = [];
  for (const item of items) {
    const code = item.snapshot_payload?.wire?.CODIGO_IDENTIFICADOR;
    if (missingValue(code)) continue;
    const key = `${item.element_type}:${String(code).trim()}`;
    const previous = seen.get(key);
    if (previous) {
      errors.push({
        code: 'duplicate_official_code',
        element_type: item.element_type,
        official_code: String(code),
        item_ids: [previous, item.id],
      });
    } else {
      seen.set(key, item.id);
    }
  }
  return errors;
}

function assertAssetDecision(asset, reviewedPayload) {
  if (asset.decision === 'unreviewed') return;
  nonblank(asset.decision_evidence_reference, 'decision_evidence_reference', 500);
  if (asset.decision === 'excluded') {
    if (!asset.exclusion_reason) throw new ValidationError('exclusion_reason is required');
    return;
  }
  if (asset.decision !== 'included') throw new ValidationError('Invalid asset decision');
  if (!asset.official_code) throw new ValidationError('official_code is required for included assets');
  if (!asset.ownership) throw new ValidationError('ownership is required for included assets');
  if (!asset.owner_name) throw new ValidationError('owner_name is required for included assets');
  const contract = getElementType(asset.element_type);
  const errors = validateWireRecord(contract, reviewedPayload);
  if (errors.length) throw new ValidationError('SNII asset fields are incomplete or invalid', errors);
}

function computeClassificationHash(asset, reviewedPayload, sourceSnapshotHash) {
  return sha256(stableStringify({
    source_snapshot_hash: sourceSnapshotHash,
    element_type: asset.element_type,
    decision: asset.decision,
    exclusion_reason: asset.decision === 'excluded' ? asset.exclusion_reason : null,
    decision_evidence_reference: asset.decision_evidence_reference,
    official_code: asset.official_code,
    ownership: asset.ownership,
    owner_name: asset.owner_name,
    reviewed_payload: reviewedPayload,
  }));
}

async function collectCandidates(executor, organizationId) {
  const candidates = [];
  const append = (sourceType, sourceRows) => {
    for (const source of sourceRows) {
      const suggested = suggestion(sourceType, source);
      if (suggested) candidates.push({
        source_type: sourceType,
        source_id: source.id,
        suggested_element_type: suggested,
        source,
      });
    }
  };
  append('site', await rows(executor,
    `SELECT id, name, site_type, status, latitude, longitude, updated_at, deleted_at
       FROM sites WHERE organization_id = ?
        AND site_type IN ('pop','data_center','tower','aggregation_node') ORDER BY id`,
    [organizationId]));
  append('device', await rows(executor,
    `SELECT d.id, d.name, d.type, d.status, d.manufacturer, d.model,
            COALESCE(d.latitude, s.latitude) AS latitude,
            COALESCE(d.longitude, s.longitude) AS longitude,
            d.updated_at, d.deleted_at
       FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id AND s.organization_id = d.organization_id
      WHERE d.organization_id = ?
        AND d.type IN ('olt','ptp','ptmp_ap')
        AND d.client_id IS NULL AND d.contract_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM cpe_devices c
                         WHERE c.device_id = d.id AND c.organization_id = d.organization_id)
      ORDER BY d.id`, [organizationId]));
  append('fiber_route', await rows(executor,
    `SELECT id, name, route_type, status, cable_length_m, cable_type, updated_at, deleted_at
       FROM fiber_routes WHERE organization_id = ? AND route_type <> 'drop'
        AND to_onu_detail_id IS NULL ORDER BY id`, [organizationId]));
  append('infrastructure_point', await rows(executor,
    `SELECT id, name, type, latitude, longitude, is_active, updated_at, deleted_at
       FROM map_infrastructure_points WHERE organization_id = ?
        AND type IN ('tower','pole','pop') ORDER BY id`, [organizationId]));
  append('network_link', await rows(executor,
    `SELECT l.id, l.link_type, l.status, l.updated_at, l.deleted_at,
            a.name AS device_a_name, b.name AS device_b_name
       FROM network_links l
       JOIN devices a ON a.id = l.device_a_id AND a.organization_id = l.organization_id
       JOIN devices b ON b.id = l.device_b_id AND b.organization_id = l.organization_id
      WHERE l.organization_id = ? AND l.link_type = 'wireless'
        AND a.client_id IS NULL AND a.contract_id IS NULL
        AND b.client_id IS NULL AND b.contract_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM cpe_devices c
                         WHERE c.device_id IN (a.id, b.id)
                           AND c.organization_id = l.organization_id)
      ORDER BY l.id`, [organizationId]));

  const registry = await rows(executor,
    `SELECT id, source_type, source_id, element_type, decision, approval_status,
            source_snapshot_hash, classification_hash, classified_at, approved_at
       FROM snii_asset_registry WHERE organization_id = ? AND source_type <> 'manual'`,
    [organizationId]);
  const byIdentity = new Map();
  for (const item of registry) {
    const key = `${item.source_type}:${item.source_id}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(item);
  }
  return candidates.map(candidate => ({
    ...candidate,
    registry_entries: byIdentity.get(`${candidate.source_type}:${candidate.source_id}`) || [],
  }));
}

function sanitizeCandidate(candidate) {
  const first = candidate.registry_entries[0] || null;
  const registryMappings = candidate.registry_entries.map(entry => ({
    registry_id: entry.id,
    element_type: entry.element_type,
    decision: entry.decision,
    approval_status: entry.approval_status,
    source_snapshot_hash: entry.source_snapshot_hash,
    classification_hash: entry.classification_hash,
    classified_at: entry.classified_at,
    approved_at: entry.approved_at,
  }));
  return {
    source_type: candidate.source_type,
    source_id: candidate.source_id,
    source_name: candidate.source.name
      || [candidate.source.device_a_name, candidate.source.device_b_name].filter(Boolean).join(' ↔ ')
      || null,
    suggested_element_type: candidate.suggested_element_type,
    source_hash: sha256(stableStringify(candidate.source)),
    registry_id: first?.id || null,
    decision: first?.decision || 'unreviewed',
    approval_status: first?.approval_status || null,
    has_registry_decision: registryMappings.length > 0,
    registry_mappings: registryMappings,
    eligibility: 'explicit_review_required',
    blockers: first ? [] : ['not_classified'],
  };
}

async function listCandidates(organizationId, context = null) {
  if (!context) return (await collectCandidates(db, organizationId)).map(sanitizeCandidate);
  return withTransaction(async (connection) => {
    const result = (await collectCandidates(connection, organizationId)).map(sanitizeCandidate);
    await appendAudit(connection, context, 'candidates.viewed', 'candidate_inventory', null, {
      count: result.length,
      source_types: [...new Set(result.map(item => item.source_type))].sort(),
    });
    return result;
  });
}

async function listAssetsFrom(executor, organizationId, filters = {}) {
  const conditions = ['organization_id = ?'];
  const params = [organizationId];
  if (filters.decision) {
    conditions.push('decision = ?');
    params.push(filters.decision);
  }
  if (filters.element_type) {
    const canonical = canonicalElementType(filters.element_type);
    if (!canonical) throw new ValidationError('Unknown SNII element type');
    conditions.push('element_type = ?');
    params.push(canonical);
  }
  const result = await rows(executor,
    `SELECT * FROM snii_asset_registry WHERE ${conditions.join(' AND ')} ORDER BY id`, params);
  return result.map(normalizeRegistry);
}

function assetMetadata(asset, sourceState = {}) {
  const {
    field_overrides: _fieldOverrides,
    manual_payload: _manualPayload,
    reviewed_payload: _reviewedPayload,
    ...metadata
  } = asset;
  return { ...metadata, ...sourceState };
}

async function assetCurrentState(executor, organizationId, asset) {
  const source = await resolveSource(executor, organizationId, asset.source_type,
    asset.source_id, asset.manual_payload);
  if (!source) {
    return { source_present: false, current_source_hash: null, is_stale: true,
      source_state: 'missing' };
  }
  const currentHash = sha256(stableStringify(source));
  if (asset.decision === 'unreviewed' || !asset.source_snapshot_hash) {
    return { source_present: true, current_source_hash: currentHash, is_stale: null,
      source_state: 'unreviewed' };
  }
  const stale = currentHash !== asset.source_snapshot_hash;
  return { source_present: true, current_source_hash: currentHash, is_stale: stale,
    source_state: stale ? 'stale' : 'current' };
}

async function listAssetMetadata(executor, organizationId, filters = {}) {
  const assets = await listAssetsFrom(executor, organizationId, filters);
  return Promise.all(assets.map(async asset => assetMetadata(
    asset, await assetCurrentState(executor, organizationId, asset),
  )));
}

async function listAssets(organizationId, filters = {}, context = null) {
  if (!context) return listAssetMetadata(db, organizationId, filters);
  return withTransaction(async (connection) => {
    const result = await listAssetMetadata(connection, organizationId, filters);
    await appendAudit(connection, context, 'assets.viewed', 'asset_registry', null, {
      count: result.length,
      filters: {
        decision: filters.decision || null,
        element_type: filters.element_type || null,
      },
    });
    return result;
  });
}

async function getAssetDetail(organizationId, assetId, context = {}) {
  const id = positiveId(assetId, 'asset id');
  return withTransaction(async (connection) => {
    const asset = normalizeRegistry(await one(connection,
      'SELECT * FROM snii_asset_registry WHERE id = ? AND organization_id = ? LIMIT 1',
      [id, organizationId]));
    if (!asset) throw new NotFoundError('SNII asset registry entry');
    const source = await resolveSource(connection, organizationId, asset.source_type,
      asset.source_id, asset.manual_payload);
    const currentReviewedPayload = source ? buildReviewedPayload(source, asset) : null;
    const result = {
      ...assetMetadata(asset, await assetCurrentState(connection, organizationId, asset)),
      field_overrides: asset.field_overrides,
      manual_payload: asset.source_type === 'manual' ? asset.manual_payload : null,
      reviewed_payload: asset.reviewed_payload,
      current_reviewed_payload: currentReviewedPayload,
    };
    await appendAudit(connection, context, 'asset.detail_viewed', 'asset_registry', id, {
      source_type: asset.source_type,
      element_type: asset.element_type,
      decision: asset.decision,
      classification_hash: asset.classification_hash,
      source_state: result.source_state,
    });
    return result;
  });
}

function registryValues(body, existing = {}) {
  const elementType = canonicalElementType(body.element_type ?? existing.element_type);
  if (!elementType) throw new ValidationError('Unknown SNII element type');
  const decision = body.decision ?? existing.decision ?? 'unreviewed';
  if (!['unreviewed', 'included', 'excluded'].includes(decision)) {
    throw new ValidationError('Invalid asset decision');
  }
  return {
    element_type: elementType,
    decision,
    exclusion_reason: body.exclusion_reason ?? existing.exclusion_reason ?? null,
    decision_evidence_reference: body.decision_evidence_reference
      ?? existing.decision_evidence_reference ?? null,
    official_code: body.official_code ?? existing.official_code ?? null,
    ownership: body.ownership ?? existing.ownership ?? null,
    owner_name: body.owner_name ?? existing.owner_name ?? null,
    field_overrides: body.field_overrides ?? existing.field_overrides ?? {},
    manual_payload: body.manual_payload ?? existing.manual_payload ?? null,
  };
}

async function createAsset(organizationId, actorId, body, context = {}) {
  const profileId = positiveId(body.profile_id, 'profile_id');
  const sourceType = body.source_type;
  if (!SOURCE_TYPES.has(sourceType)) throw new ValidationError('Unknown source_type');
  const values = registryValues(body);
  return withTransaction(async (connection) => {
    const profile = await one(connection,
      `SELECT id FROM snii_reporting_profiles
        WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
      [profileId, organizationId]);
    if (!profile) throw new NotFoundError('SNII reporting profile');
    const sourceId = sourceType === 'manual' ? null : positiveId(body.source_id, 'source_id');
    const source = await resolveSource(connection, organizationId, sourceType, sourceId,
      values.manual_payload);
    if (!source) throw new NotFoundError('SNII source');
    const reviewedPayload = values.decision === 'unreviewed'
      ? null : buildReviewedPayload(source, values);
    assertAssetDecision(values, reviewedPayload);
    const snapshotHash = values.decision === 'unreviewed' ? null : sha256(stableStringify(source));
    const classificationHash = values.decision === 'unreviewed'
      ? null : computeClassificationHash(values, reviewedPayload, snapshotHash);
    try {
      const [result] = await execute(connection,
        `INSERT INTO snii_asset_registry
          (organization_id, profile_id, source_type, source_id, element_type, decision,
           approval_status, exclusion_reason, decision_evidence_reference, official_code,
           ownership, owner_name, field_overrides, manual_payload, reviewed_payload,
           source_snapshot_hash, classification_hash, classification_revision,
           source_updated_at, classified_by, classified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [organizationId, profileId, sourceType, sourceId, values.element_type, values.decision,
          values.decision === 'unreviewed' ? 'not_required' : 'pending',
          values.decision === 'excluded' ? values.exclusion_reason : null,
          values.decision === 'unreviewed' ? null : values.decision_evidence_reference,
          values.official_code, values.ownership, values.owner_name,
          stableStringify(values.field_overrides),
          sourceType === 'manual' ? stableStringify(values.manual_payload) : null,
          reviewedPayload ? stableStringify(reviewedPayload) : null,
          snapshotHash, classificationHash, values.decision === 'unreviewed' ? 0 : 1,
          source.updated_at || null,
          values.decision === 'unreviewed' ? null : actorId,
          values.decision === 'unreviewed' ? null : new Date()]);
      await appendAudit(connection, { ...context, organizationId, actorId },
        'asset.classified', 'asset_registry', result.insertId, {
          source_type: sourceType,
          source_id: sourceId,
          element_type: values.element_type,
          decision: values.decision,
          approval_status: values.decision === 'unreviewed' ? 'not_required' : 'pending',
          source_snapshot_hash: snapshotHash,
          classification_hash: classificationHash,
        });
      return normalizeRegistry(await one(connection,
        'SELECT * FROM snii_asset_registry WHERE id = ? AND organization_id = ?',
        [result.insertId, organizationId]));
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ConflictError('SNII source mapping already exists');
      throw err;
    }
  });
}

async function updateAsset(organizationId, actorId, assetId, body, context = {}) {
  const id = positiveId(assetId, 'asset id');
  return withTransaction(async (connection) => {
    const existing = normalizeRegistry(await one(connection,
      'SELECT * FROM snii_asset_registry WHERE id = ? AND organization_id = ? FOR UPDATE',
      [id, organizationId]));
    if (!existing) throw new NotFoundError('SNII asset registry entry');
    const values = registryValues(body, existing);
    let source = await resolveSource(connection, organizationId, existing.source_type,
      existing.source_id, values.manual_payload);
    if (!source && values.decision === 'excluded' && existing.reviewed_payload) {
      source = { ...existing.reviewed_payload, source_type: existing.source_type, updated_at: null };
    }
    if (!source) throw new NotFoundError('SNII source');
    const reviewedPayload = values.decision === 'unreviewed'
      ? null : buildReviewedPayload(source, values);
    assertAssetDecision(values, reviewedPayload);
    const snapshotHash = values.decision === 'unreviewed' ? null : sha256(stableStringify(source));
    const classificationHash = values.decision === 'unreviewed'
      ? null : computeClassificationHash(values, reviewedPayload, snapshotHash);
    const classificationRevision = values.decision === 'unreviewed'
      ? 0 : Number(existing.classification_revision || 0) + 1;
    await execute(connection,
      `UPDATE snii_asset_registry SET element_type = ?, decision = ?, approval_status = ?,
          exclusion_reason = ?, decision_evidence_reference = ?, official_code = ?,
          ownership = ?, owner_name = ?, field_overrides = ?, manual_payload = ?,
          reviewed_payload = ?, source_snapshot_hash = ?, classification_hash = ?,
          classification_revision = ?, source_updated_at = ?,
          classified_by = ?, classified_at = ?, approved_by = NULL, approved_at = NULL
        WHERE id = ? AND organization_id = ?`,
      [values.element_type, values.decision,
        values.decision === 'unreviewed' ? 'not_required' : 'pending',
        values.decision === 'excluded' ? values.exclusion_reason : null,
        values.decision === 'unreviewed' ? null : values.decision_evidence_reference,
        values.official_code, values.ownership, values.owner_name,
        stableStringify(values.field_overrides),
        existing.source_type === 'manual' ? stableStringify(values.manual_payload) : null,
        reviewedPayload ? stableStringify(reviewedPayload) : null,
        snapshotHash, classificationHash, classificationRevision, source.updated_at || null,
        values.decision === 'unreviewed' ? null : actorId,
        values.decision === 'unreviewed' ? null : new Date(), id, organizationId]);
    await appendAudit(connection, { ...context, organizationId, actorId },
      'asset.classified', 'asset_registry', id, {
        source_type: existing.source_type,
        source_id: existing.source_id,
        element_type: values.element_type,
        decision: values.decision,
        approval_status: values.decision === 'unreviewed' ? 'not_required' : 'pending',
        source_snapshot_hash: snapshotHash,
        classification_hash: classificationHash,
      });
    return normalizeRegistry(await one(connection,
      'SELECT * FROM snii_asset_registry WHERE id = ? AND organization_id = ?',
      [id, organizationId]));
  });
}

async function approveAsset(organizationId, actorId, assetId, expectedSourceHash,
  expectedClassificationHash, context = {}) {
  const id = positiveId(assetId, 'asset id');
  return withTransaction(async (connection) => {
    const asset = normalizeRegistry(await one(connection,
      'SELECT * FROM snii_asset_registry WHERE id = ? AND organization_id = ? FOR UPDATE',
      [id, organizationId]));
    if (!asset) throw new NotFoundError('SNII asset registry entry');
    if (asset.decision === 'unreviewed' || asset.approval_status !== 'pending') {
      throw new ConflictError('Asset must have a pending explicit classification');
    }
    if (Number(asset.classified_by) === Number(actorId)) {
      throw new ConflictError('The classifier cannot approve the same SNII asset decision');
    }
    if (asset.source_snapshot_hash !== expectedSourceHash) {
      throw new ConflictError('Source snapshot changed or the expected hash is stale');
    }
    if (asset.classification_hash !== expectedClassificationHash) {
      throw new ConflictError('Classification changed after the approval preview');
    }
    const source = await resolveSource(connection, organizationId, asset.source_type,
      asset.source_id, asset.manual_payload);
    if (!source) throw new ConflictError('Source no longer exists or is no longer eligible');
    const currentHash = sha256(stableStringify(source));
    if (currentHash !== asset.source_snapshot_hash) {
      throw new ConflictError('Source changed after classification; review it again');
    }
    const reviewedPayload = buildReviewedPayload(source, asset);
    assertAssetDecision(asset, reviewedPayload);
    const currentClassificationHash = computeClassificationHash(asset, reviewedPayload, currentHash);
    if (currentClassificationHash !== asset.classification_hash) {
      throw new ConflictError('Classification payload changed after review');
    }
    await execute(connection,
      `UPDATE snii_asset_registry SET approval_status = 'approved', approved_by = ?, approved_at = ?
        WHERE id = ? AND organization_id = ?`, [actorId, new Date(), id, organizationId]);
    await appendAudit(connection, { ...context, organizationId, actorId },
      'asset.approved', 'asset_registry', id, {
        decision: asset.decision,
        element_type: asset.element_type,
        source_snapshot_hash: currentHash,
        classification_hash: currentClassificationHash,
        classifier_user_id: asset.classified_by,
      });
    return normalizeRegistry(await one(connection,
      'SELECT * FROM snii_asset_registry WHERE id = ? AND organization_id = ?',
      [id, organizationId]));
  });
}

function expectedWindow(body) {
  if (body.filing_kind === 'initial') {
    if (body.filing_window !== 'initial' || body.filing_frequency !== 'initial') {
      throw new ValidationError('Initial filings require the initial window and frequency');
    }
    return;
  }
  if (body.filing_kind === 'voluntary') {
    if (body.filing_window !== 'anytime' || body.filing_frequency !== 'voluntary') {
      throw new ValidationError('Voluntary filings require the anytime window and frequency');
    }
    return;
  }
  if (body.filing_window === 'first_semiannual' && body.filing_frequency !== 'semiannual') {
    throw new ValidationError('The first semiannual window requires semiannual frequency');
  }
  if (body.filing_window === 'second_combined'
      && body.filing_frequency !== 'annual_and_semiannual') {
    throw new ValidationError('The second combined window requires annual_and_semiannual frequency');
  }
  if (['initial', 'anytime'].includes(body.filing_window)) {
    throw new ValidationError('Update filings require a recurring filing window');
  }
}

function dueForWindow(contract, batch) {
  if (batch.filing_kind === 'initial') return true;
  if (batch.filing_kind === 'voluntary') return contract.periodicity === 'voluntary';
  if (batch.filing_window === 'first_semiannual') return contract.periodicity === 'semiannual';
  return contract.periodicity === 'semiannual' || contract.periodicity === 'annual';
}

function snapshotContracts(elementTypes) {
  return elementTypes.map((elementType) => {
    const contract = getElementType(elementType);
    return {
      slug: contract.slug,
      label: contract.label,
      geometry: contract.geometry,
      periodicity: contract.periodicity,
      official_template_filename: contract.official_template_filename,
      official_filenames: contract.official_filenames,
      preparation_filename: contract.preparation_filename,
      generated_format: contract.generated_format,
      wire_headers: contract.wire_headers,
      required_headers: contract.required_headers,
      catalog_values: contract.catalog_values,
      field_constraints: contract.field_constraints,
      validation_supported: contract.validation_supported,
      preparation_supported: contract.preparation_supported,
    };
  });
}

function snapshotNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function snapshotDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text;
}

function snapshotInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function buildApplicabilitySnapshot(profile, applicability) {
  return {
    subject: {
      status: profile.subject_applicability,
      basis: profile.applicability_basis ?? null,
      external_decision_reference: profile.external_decision_reference ?? null,
      decided_by: snapshotNumber(profile.applicability_decided_by),
      decided_at: snapshotInstant(profile.applicability_decided_at),
    },
    elements: [...applicability].sort((left, right) =>
      left.element_type.localeCompare(right.element_type)).map(item => ({
      element_type: item.element_type,
      applicability: item.applicability,
      rationale: item.rationale ?? null,
      population_status: item.population_status,
      population_evidence_reference: item.population_evidence_reference ?? null,
      population_reviewed_by: snapshotNumber(item.population_reviewed_by),
      population_reviewed_at: snapshotInstant(item.population_reviewed_at),
      reviewed_by: snapshotNumber(item.reviewed_by),
      reviewed_at: snapshotInstant(item.reviewed_at),
    })),
  };
}

function batchSnapshotDescriptor(batch, itemHashes) {
  return {
    organization_id: snapshotNumber(batch.organization_id),
    profile_id: snapshotNumber(batch.profile_id),
    concession_title_id: snapshotNumber(batch.concession_title_id),
    concession_title_snapshot: parseJson(batch.concession_title_snapshot, null),
    concession_title_sha256: batch.concession_title_sha256 ?? null,
    catalog_version: batch.catalog_version,
    period_start: snapshotDate(batch.period_start),
    period_end: snapshotDate(batch.period_end),
    filing_kind: batch.filing_kind,
    filing_window: batch.filing_window,
    filing_year: Number(batch.filing_year),
    filing_frequency: batch.filing_frequency,
    full_load: Boolean(Number(batch.full_load ?? 1)),
    revision_no: snapshotNumber(batch.revision_no),
    supersedes_batch_id: batch.supersedes_batch_id === null
      || batch.supersedes_batch_id === undefined
      ? null : Number(batch.supersedes_batch_id),
    correction_root_batch_id: batch.correction_root_batch_id === null
      || batch.correction_root_batch_id === undefined
      ? null : Number(batch.correction_root_batch_id),
    supersession_reason: batch.supersession_reason ?? null,
    source_channel: batch.source_channel,
    source_attestation_reference: batch.source_attestation_reference,
    official_sources_reviewed_by: snapshotNumber(batch.official_sources_reviewed_by),
    official_sources_reviewed_at: snapshotInstant(batch.official_sources_reviewed_at),
    source_freshness_days: snapshotNumber(batch.source_freshness_days),
    adapter_reconciliation_reference: batch.adapter_reconciliation_reference,
    adapter_reconciliation_sha256: batch.adapter_reconciliation_sha256,
    adapter_catalog_version: batch.adapter_catalog_version,
    adapter_reconciled_by: snapshotNumber(batch.adapter_reconciled_by),
    adapter_reconciled_at: snapshotInstant(batch.adapter_reconciled_at),
    template_version: batch.template_version,
    template_source_url: batch.template_source_url,
    template_sha256: batch.template_sha256,
    template_effective_date: snapshotDate(batch.template_effective_date),
    dictionary_version: batch.dictionary_version,
    dictionary_source_url: batch.dictionary_source_url,
    dictionary_sha256: batch.dictionary_sha256,
    annex_v_version: batch.annex_v_version,
    annex_v_source_url: batch.annex_v_source_url,
    annex_v_sha256: batch.annex_v_sha256,
    legal_basis: batch.legal_basis,
    electronic_folio: batch.electronic_folio,
    created_by: snapshotNumber(batch.created_by),
    applicability_snapshot: parseJson(batch.applicability_snapshot, null),
    element_types: batch.element_types_snapshot,
    element_contracts: batch.element_contract_snapshot,
    items: itemHashes.map(item => ({
      registry_asset_id: Number(item.registry_asset_id),
      element_type: item.element_type,
      payload_hash: item.payload_hash,
    })),
  };
}

function computeBatchSnapshotHash(batch, items) {
  return sha256(stableStringify(batchSnapshotDescriptor(batch, items)));
}

function batchContract(batch, elementType) {
  return batch.element_contract_snapshot.find(contract => contract.slug === elementType) || null;
}

async function readiness(connection, organizationId, profile, batchRequest) {
  const blockers = [];
  if (profile.subject_applicability !== 'applicable') {
    blockers.push({ code: 'profile_not_applicable', status: profile.subject_applicability });
  }
  if (profile.concession_title_id) {
    const storedTitleSnapshot = parseJson(profile.concession_title_snapshot, null);
    if (!storedTitleSnapshot
        || sha256(stableStringify(storedTitleSnapshot)) !== profile.concession_title_sha256) {
      blockers.push({ code: 'concession_title_snapshot_integrity_failed' });
    }
    const title = await getConcessionTitle(connection, organizationId,
      profile.concession_title_id);
    if (!title) {
      blockers.push({ code: 'concession_title_missing' });
    } else {
      const currentTitleHash = sha256(stableStringify(concessionTitleSnapshot(title)));
      if (currentTitleHash !== profile.concession_title_sha256) {
        blockers.push({ code: 'concession_title_changed' });
      }
    }
  }
  const reviewedAt = new Date(profile.official_sources_reviewed_at).getTime();
  const freshnessMs = Number(profile.source_freshness_days) * 86400000;
  if (!Number.isFinite(reviewedAt) || Date.now() - reviewedAt > freshnessMs) {
    blockers.push({ code: 'official_sources_stale', reviewed_at: profile.official_sources_reviewed_at });
  }
  if (profile.source_channel !== 'crt_ventanilla_current'
      || !String(profile.source_attestation_reference || '').trim()) {
    blockers.push({ code: 'current_ventanilla_contract_unconfirmed' });
  }
  const reconciledAt = new Date(profile.adapter_reconciled_at).getTime();
  if (!String(profile.adapter_reconciliation_reference || '').trim()
      || !/^[a-f0-9]{64}$/.test(String(profile.adapter_reconciliation_sha256 || ''))
      || profile.adapter_catalog_version !== CATALOG_VERSION
      || !Number.isFinite(reconciledAt)
      || reconciledAt < reviewedAt) {
    blockers.push({ code: 'adapter_current_package_reconciliation_missing_or_stale' });
  }
  const pinnedUrls = [profile.template_source_url, profile.dictionary_source_url,
    profile.annex_v_source_url];
  if (pinnedUrls.some(url => url === HISTORICAL_TEMPLATE_INDEX_URL
      || url === HISTORICAL_DICTIONARY_INDEX_URL)) {
    blockers.push({ code: 'historical_archive_pins_not_current' });
  }
  const applicability = await rows(connection,
    `SELECT element_type, applicability, rationale, population_status,
            population_evidence_reference, population_reviewed_by, population_reviewed_at,
            reviewed_by, reviewed_at
       FROM snii_element_applicability
      WHERE profile_id = ? AND organization_id = ? ORDER BY element_type`,
    [profile.id, organizationId]);
  const decisions = new Map(applicability.map(item => [item.element_type, item]));
  for (const contract of ELEMENT_TYPES) {
    const decision = decisions.get(contract.slug);
    if (!decision || decision.applicability === 'unreviewed') {
      blockers.push({ code: 'element_applicability_unreviewed', element_type: contract.slug });
    }
    if (decision?.applicability === 'applicable'
        && !['has_assets', 'zero_population'].includes(decision.population_status)) {
      blockers.push({ code: 'element_population_unreviewed', element_type: contract.slug });
    }
    if (decision?.applicability === 'applicable' && !contract.preparation_supported) {
      blockers.push({ code: 'event_driven_workflow_unsupported', element_type: contract.slug });
    }
  }
  const dueTypes = ELEMENT_TYPES
    .filter(contract => decisions.get(contract.slug)?.applicability === 'applicable')
    .filter(contract => dueForWindow(contract, batchRequest))
    .map(contract => contract.slug);
  if (dueTypes.length === 0) blockers.push({ code: 'no_applicable_types_due' });
  const assets = (await rows(connection,
    'SELECT * FROM snii_asset_registry WHERE profile_id = ? AND organization_id = ? ORDER BY id',
    [profile.id, organizationId])).map(normalizeRegistry);
  for (const asset of assets) {
    if (asset.decision === 'unreviewed') {
      blockers.push({ code: 'asset_decision_unreviewed', asset_id: asset.id });
      continue;
    }
    if (asset.approval_status !== 'approved') {
      blockers.push({ code: 'asset_decision_unapproved', asset_id: asset.id });
      continue;
    }
    if (asset.decision === 'included'
        && decisions.get(asset.element_type)?.applicability !== 'applicable') {
      blockers.push({ code: 'included_type_not_applicable', asset_id: asset.id,
        element_type: asset.element_type });
      continue;
    }
    const source = await resolveSource(connection, organizationId, asset.source_type,
      asset.source_id, asset.manual_payload);
    if (!source) {
      blockers.push({ code: 'reviewed_source_missing', asset_id: asset.id,
        decision: asset.decision });
      continue;
    }
    const currentHash = sha256(stableStringify(source));
    if (currentHash !== asset.source_snapshot_hash) {
      blockers.push({ code: 'reviewed_source_stale', asset_id: asset.id,
        decision: asset.decision });
      continue;
    }
    if (asset.decision !== 'included') continue;
    const errors = validateWireRecord(getElementType(asset.element_type),
      buildReviewedPayload(source, asset));
    if (errors.length) blockers.push({ code: 'included_asset_invalid', asset_id: asset.id, errors });
  }
  const applicableTypes = ELEMENT_TYPES
    .filter(contract => decisions.get(contract.slug)?.applicability === 'applicable')
    .map(contract => contract.slug);
  for (const elementType of applicableTypes) {
    const includedCount = assets.filter(asset => asset.element_type === elementType
      && asset.decision === 'included' && asset.approval_status === 'approved').length;
    const population = decisions.get(elementType);
    if (population?.population_status === 'has_assets' && includedCount === 0) {
      blockers.push({ code: 'applicable_type_has_no_approved_assets', element_type: elementType });
    }
    if (population?.population_status === 'zero_population' && includedCount !== 0) {
      blockers.push({ code: 'zero_population_has_included_assets', element_type: elementType });
    }
  }

  // Candidate discovery is deliberately broad enough to include inactive and
  // soft-deleted infrastructure.  Names containing "dummy" are not guessed at:
  // the operator must classify and separately approve the exclusion.
  const candidates = await collectCandidates(connection, organizationId);
  for (const candidate of candidates) {
    const finalDecision = candidate.registry_entries.some(entry =>
      entry.decision !== 'unreviewed' && entry.approval_status === 'approved');
    if (!finalDecision) blockers.push({
      code: 'candidate_unreviewed',
      source_type: candidate.source_type,
      source_id: candidate.source_id,
      suggested_element_type: candidate.suggested_element_type,
    });
  }
  return { blockers, dueTypes, assets, applicability };
}

async function createBatch(organizationId, actorId, body, context = {}) {
  expectedWindow(body);
  const profileId = positiveId(body.profile_id, 'profile_id');
  const periodStart = exactDate(body.period_start, 'period_start');
  const periodEnd = exactDate(body.period_end, 'period_end');
  if (periodEnd < periodStart) throw new ValidationError('period_end must be on or after period_start');
  if (!periodStart.startsWith(String(body.filing_year))
      || !periodEnd.startsWith(String(body.filing_year))) {
    throw new ValidationError('period dates must be within filing_year');
  }
  const supersedesBatchId = body.supersedes_batch_id === null
    || body.supersedes_batch_id === undefined
    ? null : positiveId(body.supersedes_batch_id, 'supersedes_batch_id');
  return withTransaction(async (connection) => {
    const profile = normalizeProfile(await one(connection,
      `SELECT * FROM snii_reporting_profiles
        WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
      [profileId, organizationId]));
    if (!profile) throw new NotFoundError('SNII reporting profile');
    const latestBatch = await one(connection,
      `SELECT id, revision_no, status
         FROM snii_report_batches
        WHERE profile_id = ? AND organization_id = ? AND filing_kind = ?
          AND filing_year = ? AND filing_window = ?
          AND period_start = ? AND period_end = ? AND filing_frequency = ?
        ORDER BY revision_no DESC LIMIT 1 FOR UPDATE`,
      [profileId, organizationId, body.filing_kind, body.filing_year, body.filing_window,
        periodStart, periodEnd, body.filing_frequency]);
    let revisionNo = 1;
    let supersessionReason = null;
    let correctionRootBatchId = null;
    let internalReplacement = false;
    if (supersedesBatchId) {
      const predecessor = await one(connection,
        `SELECT id, profile_id, period_start, period_end, filing_kind, filing_year,
                filing_window, filing_frequency, revision_no, status,
                concession_title_id, electronic_folio, correction_root_batch_id
           FROM snii_report_batches
          WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
        [supersedesBatchId, organizationId]);
      if (!predecessor) throw new NotFoundError('Superseded SNII report batch');
      const internalStatus = ['draft', 'validated'].includes(predecessor.status);
      const externalCorrection = predecessor.status === 'correction_required';
      if ((!internalStatus && !externalCorrection)
          || Number(predecessor.profile_id) !== profileId
          || snapshotDate(predecessor.period_start) !== periodStart
          || snapshotDate(predecessor.period_end) !== periodEnd
          || predecessor.filing_kind !== body.filing_kind
          || Number(predecessor.filing_year) !== Number(body.filing_year)
          || predecessor.filing_window !== body.filing_window
          || predecessor.filing_frequency !== body.filing_frequency) {
        throw new ConflictError('Replacement revision must match its direct predecessor');
      }
      if (externalCorrection
          && (snapshotNumber(predecessor.concession_title_id)
              !== snapshotNumber(profile.concession_title_id)
            || predecessor.electronic_folio !== profile.electronic_folio)) {
        throw new ConflictError(
          'External correction must retain its concession title and electronic folio',
        );
      }
      if (!latestBatch || Number(latestBatch.id) !== Number(predecessor.id)
          || Number(latestBatch.revision_no) !== Number(predecessor.revision_no)) {
        throw new ConflictError('Replacement revision must directly supersede the latest batch');
      }
      revisionNo = Number(predecessor.revision_no) + 1;
      if (!Number.isSafeInteger(revisionNo) || revisionNo > 65535) {
        throw new ConflictError('Batch revision limit reached');
      }
      internalReplacement = internalStatus;
      let correctionRoot = null;
      if (externalCorrection) {
        correctionRoot = predecessor;
        correctionRootBatchId = Number(predecessor.id);
      } else if (predecessor.correction_root_batch_id) {
        correctionRoot = await one(connection,
          `SELECT id, profile_id, period_start, period_end, filing_kind, filing_year,
                  filing_window, filing_frequency, status, concession_title_id, electronic_folio
             FROM snii_report_batches
            WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
          [predecessor.correction_root_batch_id, organizationId]);
        if (!correctionRoot || correctionRoot.status !== 'correction_required') {
          throw new ConflictError('The external correction root is no longer available');
        }
        correctionRootBatchId = Number(correctionRoot.id);
      }
      if (correctionRoot
          && (Number(correctionRoot.profile_id) !== profileId
            || snapshotDate(correctionRoot.period_start) !== periodStart
            || snapshotDate(correctionRoot.period_end) !== periodEnd
            || correctionRoot.filing_kind !== body.filing_kind
            || Number(correctionRoot.filing_year) !== Number(body.filing_year)
            || correctionRoot.filing_window !== body.filing_window
            || correctionRoot.filing_frequency !== body.filing_frequency
            || snapshotNumber(correctionRoot.concession_title_id)
              !== snapshotNumber(profile.concession_title_id)
            || correctionRoot.electronic_folio !== profile.electronic_folio)) {
        throw new ConflictError(
          'Every external correction revision must retain its root filing identity and period',
        );
      }
      supersessionReason = internalReplacement
        ? nonblank(body.supersession_reason, 'supersession_reason', 500)
        : (body.supersession_reason
          ? nonblank(body.supersession_reason, 'supersession_reason', 500)
          : `authority_correction_for_batch:${supersedesBatchId}`);
      const successor = await one(connection,
        `SELECT id FROM snii_report_batches
          WHERE supersedes_batch_id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
        [supersedesBatchId, organizationId]);
      if (successor) throw new ConflictError('This correction-required batch already has a revision');
    } else if (latestBatch) {
      throw new ConflictError(
        'A batch already exists for this filing window; a later revision must supersede it',
      );
    } else if (body.supersession_reason !== null && body.supersession_reason !== undefined) {
      throw new ValidationError('supersession_reason requires supersedes_batch_id');
    }
    if (!supersedesBatchId && body.filing_kind !== 'voluntary') {
      const otherRecurringSeries = await one(connection,
        `SELECT id FROM snii_report_batches
          WHERE profile_id = ? AND organization_id = ? AND filing_kind = ?
            AND filing_year = ? AND filing_window = ?
          ORDER BY revision_no DESC LIMIT 1 FOR UPDATE`,
        [profileId, organizationId, body.filing_kind, body.filing_year, body.filing_window]);
      if (otherRecurringSeries) {
        throw new ConflictError(
          'A recurring batch series already exists for this filing window',
        );
      }
    }
    const state = await readiness(connection, organizationId, profile, body);
    if (state.blockers.length) {
      throw new ValidationError('SNII full-load preparation is not ready', state.blockers);
    }
    if (internalReplacement) {
      const [superseded] = await execute(connection,
        `UPDATE snii_report_batches SET status = 'superseded'
          WHERE id = ? AND organization_id = ? AND status IN ('draft','validated')`,
        [supersedesBatchId, organizationId]);
      if (Number(superseded.affectedRows) !== 1) {
        throw new ConflictError('The replacement predecessor is no longer replaceable');
      }
    }
    const contractSnapshot = snapshotContracts(state.dueTypes);
    const applicabilitySnapshot = buildApplicabilitySnapshot(profile, state.applicability);
    let result;
    try {
      [result] = await execute(connection,
        `INSERT INTO snii_report_batches
        (organization_id, profile_id, concession_title_id, concession_title_snapshot,
         concession_title_sha256, supersedes_batch_id, correction_root_batch_id,
         supersession_reason,
         period_start, period_end,
         filing_kind, filing_window,
         filing_year, filing_frequency, full_load, revision_no, status, catalog_version,
         element_types_snapshot, element_contract_snapshot, applicability_snapshot, source_channel,
         source_attestation_reference, official_sources_reviewed_by,
         official_sources_reviewed_at, source_freshness_days, adapter_reconciliation_reference,
         adapter_reconciliation_sha256, adapter_catalog_version,
         adapter_reconciled_by, adapter_reconciled_at,
         template_version, template_source_url, template_sha256, template_effective_date,
         dictionary_version, dictionary_source_url, dictionary_sha256,
         annex_v_version, annex_v_source_url, annex_v_sha256, legal_basis,
         electronic_folio, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [organizationId, profileId, profile.concession_title_id,
          profile.concession_title_snapshot
            ? stableStringify(profile.concession_title_snapshot) : null,
          profile.concession_title_sha256, supersedesBatchId, correctionRootBatchId,
          supersessionReason,
          periodStart, periodEnd,
          body.filing_kind, body.filing_window,
          body.filing_year, body.filing_frequency, revisionNo, CATALOG_VERSION,
          stableStringify(state.dueTypes), stableStringify(contractSnapshot),
          stableStringify(applicabilitySnapshot), profile.source_channel,
          profile.source_attestation_reference, profile.official_sources_reviewed_by,
          profile.official_sources_reviewed_at, profile.source_freshness_days,
          profile.adapter_reconciliation_reference,
          profile.adapter_reconciliation_sha256, profile.adapter_catalog_version,
          profile.adapter_reconciled_by, profile.adapter_reconciled_at,
          profile.template_version, profile.template_source_url,
          profile.template_sha256, profile.template_effective_date,
          profile.dictionary_version, profile.dictionary_source_url,
          profile.dictionary_sha256, profile.annex_v_version, profile.annex_v_source_url,
          profile.annex_v_sha256, profile.legal_basis, profile.electronic_folio, actorId]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new ConflictError(supersedesBatchId
          ? 'This correction-required batch already has a revision'
          : 'A batch already exists for this filing window');
      }
      throw err;
    }
    const batchId = result.insertId;
    const itemHashes = [];
    for (const asset of state.assets.filter(item =>
      item.decision === 'included' && state.dueTypes.includes(item.element_type))) {
      const source = await resolveSource(connection, organizationId, asset.source_type,
        asset.source_id, asset.manual_payload);
      const reviewed = buildReviewedPayload(source, asset);
      const payload = {
        wire: reviewed.wire,
        geometry: reviewed.geometry,
        source_snapshot_hash: asset.source_snapshot_hash,
        registry_approval: {
          classification_hash: asset.classification_hash,
          classification_revision: asset.classification_revision,
          classified_by: asset.classified_by,
          classified_at: asset.classified_at,
          approved_by: asset.approved_by,
          approved_at: asset.approved_at,
          decision_evidence_reference: asset.decision_evidence_reference,
        },
      };
      const payloadHash = sha256(stableStringify(payload));
      itemHashes.push({ registry_asset_id: asset.id, element_type: asset.element_type, payload_hash: payloadHash });
      await execute(connection,
        `INSERT INTO snii_report_items
          (organization_id, batch_id, registry_asset_id, element_type, official_code,
           source_type, source_id, snapshot_payload, payload_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [organizationId, batchId, asset.id, asset.element_type, asset.official_code,
          asset.source_type, asset.source_id, stableStringify(payload), payloadHash]);
    }
    const snapshotHash = computeBatchSnapshotHash({
      organization_id: organizationId,
      profile_id: profileId,
      concession_title_id: profile.concession_title_id,
      concession_title_snapshot: profile.concession_title_snapshot,
      concession_title_sha256: profile.concession_title_sha256,
      catalog_version: CATALOG_VERSION,
      period_start: periodStart,
      period_end: periodEnd,
      filing_kind: body.filing_kind,
      filing_window: body.filing_window,
      filing_year: body.filing_year,
      filing_frequency: body.filing_frequency,
      full_load: true,
      revision_no: revisionNo,
      supersedes_batch_id: supersedesBatchId,
      correction_root_batch_id: correctionRootBatchId,
      supersession_reason: supersessionReason,
      source_channel: profile.source_channel,
      source_attestation_reference: profile.source_attestation_reference,
      official_sources_reviewed_by: profile.official_sources_reviewed_by,
      official_sources_reviewed_at: profile.official_sources_reviewed_at,
      source_freshness_days: profile.source_freshness_days,
      adapter_reconciliation_reference: profile.adapter_reconciliation_reference,
      adapter_reconciliation_sha256: profile.adapter_reconciliation_sha256,
      adapter_catalog_version: profile.adapter_catalog_version,
      adapter_reconciled_by: profile.adapter_reconciled_by,
      adapter_reconciled_at: profile.adapter_reconciled_at,
      template_version: profile.template_version,
      template_source_url: profile.template_source_url,
      template_sha256: profile.template_sha256,
      template_effective_date: profile.template_effective_date,
      dictionary_version: profile.dictionary_version,
      dictionary_source_url: profile.dictionary_source_url,
      dictionary_sha256: profile.dictionary_sha256,
      annex_v_version: profile.annex_v_version,
      annex_v_source_url: profile.annex_v_source_url,
      annex_v_sha256: profile.annex_v_sha256,
      legal_basis: profile.legal_basis,
      electronic_folio: profile.electronic_folio,
      created_by: actorId,
      element_types_snapshot: state.dueTypes,
      element_contract_snapshot: contractSnapshot,
      applicability_snapshot: applicabilitySnapshot,
    }, itemHashes);
    await execute(connection,
      `UPDATE snii_report_batches SET item_count = ?, snapshot_hash = ?
        WHERE id = ? AND organization_id = ?`,
      [itemHashes.length, snapshotHash, batchId, organizationId]);
    await appendAudit(connection, { ...context, organizationId, actorId },
      'batch.created', 'report_batch', batchId, {
        snapshot_hash: snapshotHash,
        item_count: itemHashes.length,
        element_types: state.dueTypes,
        full_load: true,
        supersedes_batch_id: supersedesBatchId,
        correction_root_batch_id: correctionRootBatchId,
        supersession_reason: supersessionReason,
        filing_kind: body.filing_kind,
        filing_window: body.filing_window,
      });
    if (internalReplacement) {
      await appendAudit(connection, { ...context, organizationId, actorId },
        'batch.superseded', 'report_batch', supersedesBatchId, {
          successor_batch_id: batchId,
          supersession_reason: supersessionReason,
          predecessor_status: latestBatch.status || 'draft_or_validated',
        });
    }
    return sanitizeBatchForResponse(await getBatchFrom(connection, organizationId, batchId));
  });
}

async function listBatches(organizationId) {
  const result = await rows(db,
    'SELECT * FROM snii_report_batches WHERE organization_id = ? ORDER BY created_at DESC, id DESC',
    [organizationId]);
  return result.map(normalizeBatch);
}

async function getBatchFrom(executor, organizationId, batchId) {
  const batch = normalizeBatch(await one(executor,
    'SELECT * FROM snii_report_batches WHERE id = ? AND organization_id = ? LIMIT 1',
    [batchId, organizationId]));
  if (!batch) throw new NotFoundError('SNII report batch');
  batch.items = (await rows(executor,
    'SELECT * FROM snii_report_items WHERE batch_id = ? AND organization_id = ? ORDER BY id',
    [batchId, organizationId])).map(normalizeItem);
  batch.artifacts = await rows(executor,
    `SELECT id, element_type, format, file_name, mime_type, content_sha256, byte_size,
            catalog_version, official_template_filename, official_source_url,
            source_classification, official_source_sha256,
            adapter_reconciliation_reference, adapter_reconciliation_sha256,
            adapter_reconciled_at, generator_version,
            generated_by, generated_at
       FROM snii_report_artifacts
      WHERE batch_id = ? AND organization_id = ? ORDER BY element_type`,
    [batchId, organizationId]);
  batch.filing_events = await rows(executor,
    `SELECT id, organization_id, batch_id, event_type, attempt_no, occurred_at,
            occurred_timezone, authority_reference, evidence_upload_id, evidence_file_name,
            evidence_mime_type, evidence_byte_size, evidence_sha256, notes, event_hash,
            created_by, created_at
       FROM snii_filing_events
      WHERE batch_id = ? AND organization_id = ? ORDER BY occurred_at, id`,
    [batchId, organizationId]);
  return batch;
}

function sanitizeBatchForResponse(batch) {
  return {
    ...batch,
    items: batch.items?.map(item => ({
      id: item.id,
      element_type: item.element_type,
      official_code: item.official_code,
      source_type: item.source_type,
      payload_hash: item.payload_hash,
      validation_errors: item.validation_errors,
      created_at: item.created_at,
    })) || [],
  };
}

async function getBatch(organizationId, batchId, context = null) {
  const id = positiveId(batchId, 'batch id');
  if (!context) return sanitizeBatchForResponse(await getBatchFrom(db, organizationId, id));
  return withTransaction(async (connection) => {
    const batch = await getBatchFrom(connection, organizationId, id);
    await appendAudit(connection, context, 'batch.viewed', 'report_batch', id, {
      status: batch.status,
      item_count: batch.item_count,
      artifact_count: batch.artifacts.length,
      snapshot_hash: batch.snapshot_hash,
    });
    return sanitizeBatchForResponse(batch);
  });
}

async function assertBatchCurrent(connection, organizationId, batch) {
  if (batch.catalog_version !== CATALOG_VERSION) {
    throw new ConflictError('Batch uses a superseded embedded contract; create a new revision');
  }
  const profile = normalizeProfile(await one(connection,
    `SELECT * FROM snii_reporting_profiles
      WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
    [batch.profile_id, organizationId]));
  if (!profile) throw new NotFoundError('SNII reporting profile');
  const pinnedFields = [
    'concession_title_id', 'concession_title_sha256',
    'source_channel', 'source_attestation_reference',
    'official_sources_reviewed_by', 'official_sources_reviewed_at', 'source_freshness_days',
    'adapter_reconciliation_reference', 'adapter_reconciliation_sha256',
    'adapter_catalog_version', 'adapter_reconciled_by', 'adapter_reconciled_at',
    'template_version', 'template_source_url', 'template_sha256', 'template_effective_date',
    'dictionary_version', 'dictionary_source_url', 'dictionary_sha256',
    'annex_v_version', 'annex_v_source_url', 'annex_v_sha256',
    'legal_basis', 'electronic_folio',
  ];
  if (pinnedFields.some(field => String(profile[field] ?? '') !== String(batch[field] ?? ''))) {
    throw new ConflictError('The current profile contract differs from this batch; create a new revision');
  }
  if (stableStringify(profile.concession_title_snapshot)
      !== stableStringify(batch.concession_title_snapshot)
      || (batch.concession_title_snapshot
        && sha256(stableStringify(batch.concession_title_snapshot))
          !== batch.concession_title_sha256)) {
    throw new ConflictError('The frozen concession-title snapshot differs from the profile');
  }
  const state = await readiness(connection, organizationId, profile, batch);
  if (state.blockers.length) {
    throw new ValidationError('Current SNII review state blocks this batch', state.blockers);
  }
  const currentApplicabilitySnapshot = buildApplicabilitySnapshot(profile, state.applicability);
  if (stableStringify(currentApplicabilitySnapshot)
      !== stableStringify(batch.applicability_snapshot)) {
    throw new ConflictError('Current applicability review differs from this frozen batch');
  }
  if (stableStringify(state.dueTypes) !== stableStringify(batch.element_types_snapshot)) {
    throw new ConflictError('Current applicability differs from the frozen full-load object set');
  }
  const items = (await rows(connection,
    `SELECT * FROM snii_report_items
      WHERE batch_id = ? AND organization_id = ? ORDER BY id`,
    [batch.id, organizationId])).map(normalizeItem);
  if (computeBatchSnapshotHash(batch, items) !== batch.snapshot_hash) {
    throw new ConflictError('Frozen batch population or contract snapshot integrity check failed');
  }
  const includedAssets = state.assets.filter(asset => asset.decision === 'included'
    && asset.approval_status === 'approved'
    && batch.element_types_snapshot.includes(asset.element_type));
  const frozenIds = items.map(item => Number(item.registry_asset_id)).sort((a, b) => a - b);
  const currentIds = includedAssets.map(asset => Number(asset.id)).sort((a, b) => a - b);
  if (stableStringify(frozenIds) !== stableStringify(currentIds)) {
    throw new ConflictError('The current full-load asset population differs from the frozen batch');
  }
  const assetsById = new Map(includedAssets.map(asset => [Number(asset.id), asset]));
  for (const item of items) {
    const asset = assetsById.get(Number(item.registry_asset_id));
    if (!asset || asset.element_type !== item.element_type
        || asset.source_snapshot_hash !== item.snapshot_payload.source_snapshot_hash
        || asset.classification_hash
          !== item.snapshot_payload.registry_approval?.classification_hash
        || Number(asset.classification_revision)
          !== Number(item.snapshot_payload.registry_approval?.classification_revision)) {
      throw new ConflictError('A frozen asset classification changed after batch creation');
    }
    const source = await resolveSource(connection, organizationId, asset.source_type,
      asset.source_id, asset.manual_payload);
    if (!source || sha256(stableStringify(source)) !== asset.source_snapshot_hash) {
      throw new ConflictError('An operational source changed after batch creation');
    }
    const reviewed = buildReviewedPayload(source, asset);
    if (stableStringify(reviewed.wire) !== stableStringify(item.snapshot_payload.wire)
        || stableStringify(reviewed.geometry) !== stableStringify(item.snapshot_payload.geometry)) {
      throw new ConflictError('A reviewed SNII mapping changed after batch creation');
    }
  }
  return items;
}

async function validateBatch(organizationId, actorId, batchId, context = {}) {
  const id = positiveId(batchId, 'batch id');
  return withTransaction(async (connection) => {
    const batch = normalizeBatch(await one(connection,
      'SELECT * FROM snii_report_batches WHERE id = ? AND organization_id = ? FOR UPDATE',
      [id, organizationId]));
    if (!batch) throw new NotFoundError('SNII report batch');
    if (batch.status !== 'draft' && batch.status !== 'validated') {
      throw new ConflictError('Only a draft batch can be validated');
    }
    const items = await assertBatchCurrent(connection, organizationId, batch);
    const errors = [];
    for (const item of items) {
      const contract = batchContract(batch, item.element_type);
      if (!contract || !batch.element_types_snapshot.includes(item.element_type)) {
        errors.push({ item_id: item.id, code: 'element_not_in_full_load' });
        continue;
      }
      const payloadHash = sha256(stableStringify(item.snapshot_payload));
      if (payloadHash !== item.payload_hash) errors.push({ item_id: item.id, code: 'payload_hash_mismatch' });
      for (const error of validateWireRecord(contract, item.snapshot_payload)) {
        errors.push({ item_id: item.id, ...error });
      }
    }
    errors.push(...duplicateOfficialCodeErrors(items));
    if (computeBatchSnapshotHash(batch, items) !== batch.snapshot_hash) {
      errors.push({ code: 'snapshot_hash_mismatch' });
    }
    const validation = {
      valid: errors.length === 0,
      errors,
      checked_at: new Date().toISOString(),
      catalog_version: batch.catalog_version,
      element_types: batch.element_types_snapshot,
      full_load: true,
    };
    await execute(connection,
      `UPDATE snii_report_batches SET status = ?, validation_result = ?, validated_at = ?
        WHERE id = ? AND organization_id = ?`,
      [errors.length ? 'draft' : 'validated', stableStringify(validation), new Date(), id, organizationId]);
    await appendAudit(connection, { ...context, organizationId, actorId },
      'batch.validated', 'report_batch', id, {
        valid: validation.valid,
        error_count: errors.length,
        snapshot_hash: batch.snapshot_hash,
      });
    return { ...normalizeBatch(batch), status: errors.length ? 'draft' : 'validated',
      validation_result: validation };
  });
}

async function approveBatch(organizationId, actorId, batchId, expectedHash, context = {}) {
  const id = positiveId(batchId, 'batch id');
  return withTransaction(async (connection) => {
    const batch = normalizeBatch(await one(connection,
      'SELECT * FROM snii_report_batches WHERE id = ? AND organization_id = ? FOR UPDATE',
      [id, organizationId]));
    if (!batch) throw new NotFoundError('SNII report batch');
    if (batch.status !== 'validated' || batch.validation_result?.valid !== true) {
      throw new ConflictError('Batch must pass validation before approval');
    }
    if (batch.snapshot_hash !== expectedHash) throw new ConflictError('Batch snapshot hash mismatch');
    if (Number(batch.created_by) === Number(actorId)) {
      throw new ConflictError('The batch preparer cannot approve the same snapshot');
    }
    await assertBatchCurrent(connection, organizationId, batch);
    await execute(connection,
      `UPDATE snii_report_batches SET status = 'approved', approved_by = ?, approved_at = ?
        WHERE id = ? AND organization_id = ?`, [actorId, new Date(), id, organizationId]);
    await appendAudit(connection, { ...context, organizationId, actorId },
      'batch.approved', 'report_batch', id, {
        snapshot_hash: batch.snapshot_hash,
        preparer_user_id: batch.created_by,
        full_load: true,
      });
    return sanitizeBatchForResponse(await getBatchFrom(connection, organizationId, id));
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const string = String(value);
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

function toCsv(records, headers) {
  return [headers.join(','), ...records.map(record =>
    headers.map(header => csvEscape(record[header])).join(','))].join('\r\n') + '\r\n';
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function geoNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ValidationError('Invalid geographic coordinate');
  const fixed = number.toFixed(5);
  return fixed === '-0.00000' ? '0.00000' : fixed;
}

function coordinateText(geometry) {
  if (geometry.type === 'Point') {
    return `${geoNumber(geometry.coordinates[0])},${geoNumber(geometry.coordinates[1])},0`;
  }
  if (geometry.type === 'LineString') {
    return geometry.coordinates
      .map(point => `${geoNumber(point[0])},${geoNumber(point[1])},0`).join(' ');
  }
  if (geometry.type === 'Polygon') {
    const ring = Array.isArray(geometry.coordinates?.[0]?.[0])
      ? geometry.coordinates[0] : geometry.coordinates;
    return ring.map(point => `${geoNumber(point[0])},${geoNumber(point[1])},0`).join(' ');
  }
  throw new ValidationError('Unsupported KML geometry');
}

function kmlGeometry(geometry) {
  const coordinates = coordinateText(geometry);
  if (geometry.type === 'Point') return `<Point><coordinates>${coordinates}</coordinates></Point>`;
  if (geometry.type === 'LineString') {
    return `<LineString><tessellate>1</tessellate><coordinates>${coordinates}</coordinates></LineString>`;
  }
  return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
}

function orderedWire(wire, headers, { strings = false } = {}) {
  return Object.fromEntries(headers.map((header) => {
    const value = wire[header];
    if (strings) return [header, value === null || value === undefined ? '' : String(value)];
    return [header, value ?? null];
  }));
}

function toKml(items, contract) {
  const placemarks = items.map(item => {
    const wire = orderedWire(item.snapshot_payload.wire, contract.wire_headers, { strings: true });
    const description = JSON.stringify(wire)
      .replace(/&/g, '\\u0026')
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');
    const name = xmlEscape(wire.CODIGO_IDENTIFICADOR || contract.label);
    return `<Placemark><name>${name}</name><description><![CDATA[${description}]]></description>${kmlGeometry(item.snapshot_payload.geometry)}</Placemark>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEscape(contract.preparation_filename)}</name>${placemarks}</Document></kml>`;
}

async function generateArtifact(organizationId, actorId, batchId, body, context = {}) {
  const id = positiveId(batchId, 'batch id');
  const elementType = canonicalElementType(body.element_type);
  if (!elementType) throw new ValidationError('Unknown SNII element type');
  return withTransaction(async (connection) => {
    const batch = normalizeBatch(await one(connection,
      'SELECT * FROM snii_report_batches WHERE id = ? AND organization_id = ? FOR UPDATE',
      [id, organizationId]));
    if (!batch) throw new NotFoundError('SNII report batch');
    if (!['approved', 'exported'].includes(batch.status)) {
      throw new ConflictError('Batch must be approved before artifact generation');
    }
    const contract = batchContract(batch, elementType);
    if (!contract) throw new ValidationError('Element type is not part of this full-load filing window');
    if (!contract.preparation_supported) {
      throw new ConflictError('This object requires a separate event-driven workflow');
    }
    if (body.format !== contract.generated_format) {
      throw new ValidationError(`${contract.slug} must be generated as ${contract.generated_format}`);
    }
    if (!batch.element_types_snapshot.includes(elementType)) {
      throw new ValidationError('Element type is not part of this full-load filing window');
    }
    await assertBatchCurrent(connection, organizationId, batch);
    const existing = await one(connection,
      `SELECT id, content_sha256 FROM snii_report_artifacts
        WHERE batch_id = ? AND organization_id = ? AND element_type = ? AND format = ?`,
      [id, organizationId, elementType, body.format]);
    if (existing) throw new ConflictError('This immutable artifact already exists');
    const items = (await rows(connection,
      `SELECT * FROM snii_report_items
        WHERE batch_id = ? AND organization_id = ? AND element_type = ? ORDER BY id`,
      [id, organizationId, elementType])).map(normalizeItem);
    for (const item of items) {
      const errors = validateWireRecord(contract, item.snapshot_payload);
      if (errors.length) throw new ValidationError('Batch contains invalid SNII data', errors);
    }
    const duplicateErrors = duplicateOfficialCodeErrors(items);
    if (duplicateErrors.length) {
      throw new ValidationError('Batch contains duplicate official identifiers', duplicateErrors);
    }
    const content = body.format === 'csv'
      ? toCsv(items.map(item => orderedWire(item.snapshot_payload.wire, contract.wire_headers)),
        contract.wire_headers)
      : toKml(items, contract);
    const contentHash = sha256(content);
    const fileName = contract.preparation_filename;
    const mimeType = body.format === 'csv'
      ? 'text/csv; charset=utf-8' : 'application/vnd.google-earth.kml+xml; charset=utf-8';
    const [result] = await execute(connection,
      `INSERT INTO snii_report_artifacts
        (organization_id, batch_id, element_type, format, file_name, mime_type,
         content_text, content_sha256, byte_size, catalog_version,
         official_template_filename, source_classification, official_source_url,
         official_source_sha256, adapter_reconciliation_reference,
         adapter_reconciliation_sha256, adapter_reconciled_at,
         generator_version, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [organizationId, id, elementType, body.format, fileName, mimeType, content,
        contentHash, Buffer.byteLength(content, 'utf8'), batch.catalog_version,
        contract.official_filenames?.[body.format] || contract.preparation_filename,
        'historical_adapter_reconciled', batch.template_source_url,
        batch.template_sha256, batch.adapter_reconciliation_reference,
        batch.adapter_reconciliation_sha256, batch.adapter_reconciled_at,
        GENERATOR_VERSION, actorId]);
    const generated = await rows(connection,
      `SELECT DISTINCT element_type FROM snii_report_artifacts
        WHERE batch_id = ? AND organization_id = ?`, [id, organizationId]);
    const generatedTypes = new Set(generated.map(item => item.element_type));
    const fullLoadExported = batch.element_types_snapshot.every(type => generatedTypes.has(type));
    if (fullLoadExported) {
      await execute(connection,
        `UPDATE snii_report_batches SET status = 'exported',
            first_exported_at = COALESCE(first_exported_at, ?)
          WHERE id = ? AND organization_id = ?`, [new Date(), id, organizationId]);
    }
    await appendAudit(connection, { ...context, organizationId, actorId },
      'artifact.generated', 'report_artifact', result.insertId, {
        batch_id: id,
        element_type: elementType,
        format: body.format,
        file_name: fileName,
        evidence_sha256: contentHash,
        generated_is_filed: false,
        full_load_exported: fullLoadExported,
      });
    return one(connection,
      `SELECT id, organization_id, batch_id, element_type, format, file_name, mime_type,
              content_sha256, byte_size, catalog_version, official_template_filename,
              source_classification, official_source_url, official_source_sha256,
              adapter_reconciliation_reference, adapter_reconciliation_sha256,
              adapter_reconciled_at, generator_version,
              generated_by, generated_at
         FROM snii_report_artifacts WHERE id = ? AND organization_id = ?`,
      [result.insertId, organizationId]);
  });
}

async function getArtifactForDownload(organizationId, actorId, artifactId, context = {}) {
  const id = positiveId(artifactId, 'artifact id');
  return withTransaction(async (connection) => {
    const artifact = await one(connection,
      'SELECT * FROM snii_report_artifacts WHERE id = ? AND organization_id = ? LIMIT 1',
      [id, organizationId]);
    if (!artifact) throw new NotFoundError('SNII report artifact');
    // Audit is in the same tenant database and commits before the route writes
    // any byte.  If this insert/commit fails, the download fails closed.
    await appendAudit(connection, { ...context, organizationId, actorId },
      'artifact.downloaded', 'report_artifact', id, {
        batch_id: artifact.batch_id,
        element_type: artifact.element_type,
        file_name: artifact.file_name,
        evidence_sha256: artifact.content_sha256,
      });
    return artifact;
  });
}

async function listFilingEvents(organizationId, batchId, context = null) {
  const id = positiveId(batchId, 'batch id');
  const read = async (executor) => {
    const exists = await one(executor,
      'SELECT id FROM snii_report_batches WHERE id = ? AND organization_id = ?',
      [id, organizationId]);
    if (!exists) throw new NotFoundError('SNII report batch');
    return rows(executor,
      `SELECT id, organization_id, batch_id, event_type, attempt_no, occurred_at,
              occurred_timezone, authority_reference, evidence_upload_id, evidence_file_name,
              evidence_mime_type, evidence_byte_size, evidence_sha256, notes, event_hash,
              created_by, created_at
         FROM snii_filing_events WHERE batch_id = ? AND organization_id = ?
        ORDER BY occurred_at, id`, [id, organizationId]);
  };
  if (!context) return read(db);
  return withTransaction(async (connection) => {
    const result = await read(connection);
    await appendAudit(connection, context, 'filing_events.viewed', 'report_batch', id, {
      count: result.length,
    });
    return result;
  });
}

function nextBatchStatus(eventType, currentStatus) {
  if (eventType === 'submitted' || eventType === 'corrected_submission') return 'filed';
  if (eventType === 'accepted') return 'accepted';
  if (eventType === 'rejected' || eventType === 'correction_requested') {
    return 'correction_required';
  }
  return currentStatus;
}

function assertFilingTransition(batch, eventType) {
  if (eventType === 'submitted'
      && (batch.status !== 'exported' || batch.correction_root_batch_id)) {
    throw new ConflictError('A submitted event requires a complete exported batch');
  }
  if (eventType === 'corrected_submission'
      && (batch.status !== 'exported' || !batch.correction_root_batch_id)) {
    throw new ConflictError('A corrected submission requires a new exported correction revision');
  }
  if (['acuse_received', 'accepted', 'rejected', 'correction_requested'].includes(eventType)
      && batch.status !== 'filed') {
    throw new ConflictError(`${eventType} requires a previously recorded submission`);
  }
  if (TERMINAL_BATCH_STATES.has(batch.status) && batch.status === 'accepted') {
    throw new ConflictError('An accepted batch cannot receive more filing events');
  }
}

async function recordFilingEvent(organizationId, actorId, batchId, body, evidenceFile,
  context = {}) {
  const id = positiveId(batchId, 'batch id');
  const attemptNo = positiveId(body.attempt_no, 'attempt_no');
  if (attemptNo > 65535) throw new ValidationError('attempt_no must be at most 65535');
  const occurredAt = exactTimestamp(body.occurred_at, 'occurred_at');
  const timezone = nonblank(body.occurred_timezone, 'occurred_timezone', 64);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch (_err) {
    throw new ValidationError('occurred_timezone must be an IANA timezone');
  }
  if (explicitOffsetMinutes(body.occurred_at) !== timezoneOffsetMinutes(occurredAt, timezone)) {
    throw new ValidationError('occurred_at offset does not match occurred_timezone');
  }
  if (!Buffer.isBuffer(evidenceFile?.buffer) || evidenceFile.buffer.length < 1
      || evidenceFile.buffer.length > 10 * 1024 * 1024) {
    throw new ValidationError('evidence_file must contain 1 byte to 10 MiB');
  }
  const evidenceFileName = nonblank(evidenceFile.originalname, 'evidence_file name', 255);
  if (evidenceFileName.includes('/') || evidenceFileName.includes('\\')
      || [...evidenceFileName].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })) {
    throw new ValidationError('evidence_file name contains unsafe characters');
  }
  const evidenceMimeType = nonblank(evidenceFile.mimetype, 'evidence_file MIME type', 100);
  const evidenceBytes = evidenceFile.buffer;
  const computedEvidenceHash = sha256(evidenceBytes);
  return withTransaction(async (connection) => {
    const batch = normalizeBatch(await one(connection,
      'SELECT * FROM snii_report_batches WHERE id = ? AND organization_id = ? FOR UPDATE',
      [id, organizationId]));
    if (!batch) throw new NotFoundError('SNII report batch');
    assertFilingTransition(batch, body.event_type);
    if (['submitted', 'corrected_submission'].includes(body.event_type)) {
      const exportedAt = new Date(batch.first_exported_at).getTime();
      if (!Number.isFinite(exportedAt) || occurredAt.getTime() < exportedAt) {
        throw new ConflictError('Submission cannot predate the completed artifact export');
      }
    }
    if (body.event_type === 'submitted' && attemptNo !== 1) {
      throw new ConflictError('The initial submitted event must be filing attempt 1');
    }
    if (body.event_type === 'corrected_submission') {
      const correctionRoot = await one(connection,
        `SELECT id, profile_id, period_start, period_end, filing_kind, filing_year,
                filing_window, filing_frequency, status, concession_title_id, electronic_folio
           FROM snii_report_batches
          WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE`,
        [batch.correction_root_batch_id, organizationId]);
      if (!correctionRoot || correctionRoot.status !== 'correction_required') {
        throw new ConflictError('The external correction root must remain correction_required');
      }
      if (Number(correctionRoot.profile_id) !== Number(batch.profile_id)
          || snapshotDate(correctionRoot.period_start) !== snapshotDate(batch.period_start)
          || snapshotDate(correctionRoot.period_end) !== snapshotDate(batch.period_end)
          || correctionRoot.filing_kind !== batch.filing_kind
          || Number(correctionRoot.filing_year) !== Number(batch.filing_year)
          || correctionRoot.filing_window !== batch.filing_window
          || correctionRoot.filing_frequency !== batch.filing_frequency
          || snapshotNumber(correctionRoot.concession_title_id)
            !== snapshotNumber(batch.concession_title_id)
          || correctionRoot.electronic_folio !== batch.electronic_folio) {
        throw new ConflictError('The correction revision no longer matches its root filing identity');
      }
      const correction = await one(connection,
        `SELECT id, attempt_no, occurred_at FROM snii_filing_events
          WHERE batch_id = ? AND organization_id = ?
            AND event_type IN ('rejected','correction_requested')
          ORDER BY occurred_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [batch.correction_root_batch_id, organizationId]);
      if (!correction || attemptNo !== Number(correction.attempt_no) + 1) {
        throw new ConflictError('Corrected submission attempt must follow the predecessor correction');
      }
      if (occurredAt.getTime() < new Date(correction.occurred_at).getTime()) {
        throw new ConflictError('Corrected submission cannot predate the predecessor correction');
      }
    }
    if (['acuse_received', 'accepted', 'rejected', 'correction_requested']
      .includes(body.event_type)) {
      const submission = await one(connection,
        `SELECT id, event_type, occurred_at FROM snii_filing_events
          WHERE batch_id = ? AND organization_id = ? AND attempt_no = ?
            AND event_type IN ('submitted','corrected_submission')
          ORDER BY occurred_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [id, organizationId, attemptNo]);
      if (!submission) {
        throw new ConflictError('Authority response requires a matching recorded submission attempt');
      }
      if (occurredAt.getTime() < new Date(submission.occurred_at).getTime()) {
        throw new ConflictError('Authority response cannot predate its submission attempt');
      }
      const latestEvent = await one(connection,
        `SELECT id, occurred_at FROM snii_filing_events
          WHERE batch_id = ? AND organization_id = ? AND attempt_no = ?
          ORDER BY occurred_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [id, organizationId, attemptNo]);
      if (latestEvent && occurredAt.getTime() < new Date(latestEvent.occurred_at).getTime()) {
        throw new ConflictError('Filing events must be recorded in chronological order');
      }
    }
    if (body.event_type === 'submitted' || body.event_type === 'corrected_submission') {
      const artifacts = await rows(connection,
        `SELECT DISTINCT element_type FROM snii_report_artifacts
          WHERE batch_id = ? AND organization_id = ?`, [id, organizationId]);
      const generated = new Set(artifacts.map(item => item.element_type));
      const missing = batch.element_types_snapshot.filter(type => !generated.has(type));
      if (missing.length) {
        throw new ConflictError(`Full-load artifacts are missing for: ${missing.join(', ')}`);
      }
    }
    const [uploadResult] = await execute(connection,
      `INSERT INTO snii_evidence_uploads
        (organization_id, file_name, mime_type, byte_size, content_sha256,
         evidence_content, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [organizationId, evidenceFileName, evidenceMimeType, evidenceBytes.length,
        computedEvidenceHash, evidenceBytes, actorId]);
    const eventData = {
      organization_id: organizationId,
      batch_id: id,
      event_type: body.event_type,
      attempt_no: attemptNo,
      occurred_at: occurredAt.toISOString(),
      occurred_timezone: timezone,
      authority_reference: nonblank(body.authority_reference, 'authority_reference', 191),
      evidence_upload_id: uploadResult.insertId,
      evidence_file_name: evidenceFileName,
      evidence_mime_type: evidenceMimeType,
      evidence_byte_size: evidenceBytes.length,
      evidence_sha256: computedEvidenceHash,
      notes: body.notes?.trim() || null,
      created_by: actorId,
    };
    const eventHash = sha256(stableStringify(eventData));
    let eventId;
    try {
      const [result] = await execute(connection,
        `INSERT INTO snii_filing_events
          (organization_id, batch_id, event_type, attempt_no, occurred_at,
           occurred_timezone, authority_reference, evidence_upload_id, evidence_file_name,
           evidence_mime_type, evidence_byte_size, evidence_content, evidence_sha256,
           notes, event_hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [organizationId, id, body.event_type, attemptNo, occurredAt, timezone,
          eventData.authority_reference, uploadResult.insertId, eventData.evidence_file_name,
          eventData.evidence_mime_type, evidenceBytes.length, evidenceBytes, computedEvidenceHash,
          eventData.notes, eventHash, actorId]);
      eventId = result.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ConflictError('Filing event already recorded');
      throw err;
    }
    const status = nextBatchStatus(body.event_type, batch.status);
    await execute(connection,
      'UPDATE snii_report_batches SET status = ? WHERE id = ? AND organization_id = ?',
      [status, id, organizationId]);
    await appendAudit(connection, { ...context, organizationId, actorId },
      'filing_event.recorded', 'filing_event', eventId, {
        batch_id: id,
        event_type: body.event_type,
        attempt_no: attemptNo,
        authority_reference: eventData.authority_reference,
        evidence_upload_id: uploadResult.insertId,
        evidence_sha256: computedEvidenceHash,
        resulting_batch_status: status,
      });
    return one(connection,
      `SELECT id, organization_id, batch_id, event_type, attempt_no, occurred_at,
              occurred_timezone, authority_reference, evidence_upload_id, evidence_file_name,
              evidence_mime_type, evidence_byte_size, evidence_sha256, notes, event_hash,
              created_by, created_at
         FROM snii_filing_events WHERE id = ? AND organization_id = ?`,
      [eventId, organizationId]);
  });
}

async function getFilingEvidenceForDownload(organizationId, actorId, filingEventId,
  context = {}) {
  const id = positiveId(filingEventId, 'filing event id');
  return withTransaction(async (connection) => {
    const evidence = await one(connection,
      `SELECT id, batch_id, evidence_file_name, evidence_mime_type,
              evidence_byte_size, evidence_sha256, evidence_content
         FROM snii_filing_events
        WHERE id = ? AND organization_id = ? LIMIT 1`,
      [id, organizationId]);
    if (!evidence) throw new NotFoundError('SNII filing evidence');
    const content = Buffer.isBuffer(evidence.evidence_content)
      ? evidence.evidence_content : Buffer.from(evidence.evidence_content || '');
    if (content.length !== Number(evidence.evidence_byte_size)
        || sha256(content) !== evidence.evidence_sha256) {
      throw new ConflictError('Immutable filing evidence failed its integrity check');
    }
    await appendAudit(connection, { ...context, organizationId, actorId },
      'filing_evidence.downloaded', 'filing_event', id, {
        batch_id: evidence.batch_id,
        evidence_file_name: evidence.evidence_file_name,
        evidence_byte_size: Number(evidence.evidence_byte_size),
        evidence_sha256: evidence.evidence_sha256,
      });
    return { ...evidence, evidence_content: content };
  });
}

async function listAuditEvents(organizationId, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const beforeId = query.before_id ? positiveId(query.before_id, 'before_id') : null;
  const conditions = ['organization_id = ?'];
  const params = [organizationId];
  if (beforeId) {
    conditions.push('id < ?');
    params.push(beforeId);
  }
  params.push(limit);
  const result = await rows(db,
    `SELECT * FROM snii_audit_events WHERE ${conditions.join(' AND ')}
      ORDER BY id DESC LIMIT ?`, params);
  return result.map(item => ({ ...item, details: parseJson(item.details, {}) }));
}

module.exports = {
  getCatalog,
  getProfile,
  getProfileEnvelope,
  upsertProfile,
  setSubjectApplicability,
  setApplicability,
  listCandidates,
  listAssets,
  getAssetDetail,
  createAsset,
  updateAsset,
  approveAsset,
  listBatches,
  createBatch,
  getBatch,
  validateBatch,
  approveBatch,
  generateArtifact,
  getArtifactForDownload,
  listFilingEvents,
  recordFilingEvent,
  getFilingEvidenceForDownload,
  listAuditEvents,
  _test: {
    stableStringify,
    sha256,
    buildReviewedPayload,
    validateWireRecord,
    duplicateOfficialCodeErrors,
    computeClassificationHash,
    toCsv,
    toKml,
    geoNumber,
    dueForWindow,
    computeBatchSnapshotHash,
    buildApplicabilitySnapshot,
    concessionTitleSnapshot,
  },
};
