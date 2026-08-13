// =============================================================================
// MX contract-source environment bridge
// =============================================================================
// document_templates are the operational, placeholder-aware documents shown
// in the installation flow. contract_templates_mx is the immutable source of
// the exact adhesion-contract text. Sources live in one of two independent
// lanes:
//
//   sandbox    locally simulated evidence; never PROFECO registration
//   production externally registered evidence with official number/date
//
// Both lanes may be configured at the same time. The organization switch only
// decides which lane NEW contracts use; contracts and signed documents freeze
// that decision so changing the switch can never relabel historical evidence.
// =============================================================================

const crypto = require('crypto');
const { ValidationError } = require('../utils/errors');

const CONTRACT_ENVIRONMENTS = new Set(['sandbox', 'production']);
const READY_STATUS_BY_ENVIRONMENT = Object.freeze({
  sandbox: 'sandbox_ready',
  production: 'registered',
});
const SOURCE_FIELDS = [
  'template_name', 'ift_registration_number', 'registered_at',
  'version', 'template_body', 'document_file_id', 'environment',
];
const FROZEN_STATUSES = new Set(['sandbox_ready', 'registered', 'expired', 'revoked']);

function exactTextEquals(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return Buffer.from(String(left), 'utf8').equals(Buffer.from(String(right), 'utf8'));
}

function sourceHash(body) {
  return crypto.createHash('sha256').update(String(body), 'utf8').digest('hex');
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Resolve an environment from a source, contract, or signed-document row.
 * The inference branch is only for pre-migration/test fixtures: official
 * registration metadata unambiguously means the historical production lane.
 */
function contractEnvironment(row) {
  const explicit = row?.mx_contract_environment
    ?? row?.contract_environment
    ?? row?.mx_environment
    ?? row?.environment;
  if (CONTRACT_ENVIRONMENTS.has(explicit)) return explicit;
  const status = row?.mx_status ?? row?.status;
  if (status === 'sandbox_ready') return 'sandbox';
  const registrationNumber = row?.mx_registration_number ?? row?.ift_registration_number;
  const registeredAt = row?.mx_registered_at ?? row?.registered_at;
  if (registrationNumber || registeredAt || ['registered', 'expired', 'revoked'].includes(status)) {
    return 'production';
  }
  return null;
}

function assertEnvironment(value, field = 'contract_environment') {
  if (!CONTRACT_ENVIRONMENTS.has(value)) {
    throw new ValidationError(`${field} must be 'sandbox' or 'production'`);
  }
  return value;
}

function registrationSnapshot(row) {
  const environment = contractEnvironment(row);
  return {
    contractTemplateMxId: Number(row.contract_template_mx_id ?? row.mx_id ?? row.id),
    contractEnvironment: environment,
    // These are intentionally NULL for sandbox sources. A synthetic value must
    // never resemble or later become official registration evidence.
    registrationNumber: environment === 'production'
      ? row.mx_registration_number ?? row.ift_registration_number
      : null,
    registeredAt: environment === 'production'
      ? dateOnly(row.mx_registered_at ?? row.registered_at)
      : null,
    version: row.mx_template_version ?? row.version,
    sourceSha256: sourceHash(row.mx_template_body ?? row.template_body),
  };
}

/** Validate a source row against the immutable rules for its own lane. */
function assertReadyRecord(row, {
  orgId, bodyMd, context = 'MX activation contract', expectedEnvironment = null,
} = {}) {
  if (!row) {
    throw new ValidationError(`${context} must link an organization-owned MX contract source`);
  }
  const rowOrgId = row.mx_organization_id ?? row.organization_id;
  if (Number(rowOrgId) !== Number(orgId)) {
    throw new ValidationError(`${context} cannot use a contract source from another organization`);
  }
  const environment = contractEnvironment(row);
  assertEnvironment(environment, 'MX contract source environment');
  if (expectedEnvironment && environment !== expectedEnvironment) {
    throw new ValidationError(
      `${context} uses the ${environment} contract source, but this flow is frozen to ${expectedEnvironment}`,
    );
  }
  const status = row.mx_status ?? row.status;
  const readyStatus = READY_STATUS_BY_ENVIRONMENT[environment];
  if (status !== readyStatus) {
    throw new ValidationError(
      `${context} must link a ${environment} source whose status is ${readyStatus}`,
    );
  }
  const deletedAt = Object.prototype.hasOwnProperty.call(row, 'mx_deleted_at')
    ? row.mx_deleted_at
    : row.deleted_at;
  if (deletedAt) {
    throw new ValidationError(`${context} cannot use an archived contract source`);
  }

  const registrationNumber = row.mx_registration_number ?? row.ift_registration_number;
  const registeredAt = row.mx_registered_at ?? row.registered_at;
  if (environment === 'production') {
    if (!String(registrationNumber || '').trim() || !registeredAt) {
      throw new ValidationError(`${context} requires an official registration number and registration date`);
    }
  } else if (String(registrationNumber || '').trim() || registeredAt) {
    throw new ValidationError(
      `${context} is sandbox evidence and cannot carry an official registration number or date`,
    );
  }

  const sourceBody = row.mx_template_body ?? row.template_body;
  if (!String(sourceBody || '').trim()) {
    throw new ValidationError(`${context} requires exact source text`);
  }
  if (!String(row.mx_template_version ?? row.version ?? '').trim()) {
    throw new ValidationError(`${context} requires a source version`);
  }
  if (!exactTextEquals(sourceBody, bodyMd)) {
    throw new ValidationError(
      `${context} text must exactly match the frozen text of its ${environment} MX contract source`,
    );
  }
  return registrationSnapshot(row);
}

// Backward-compatible export name retained for callers/tests written before
// sandbox sources existed. It now validates either ready lane.
const assertRegisteredRecord = assertReadyRecord;

function snapshotMatchesRegisteredSource(row, snapshot) {
  if (!snapshot) return false;
  return Number(row.contract_template_mx_id) === snapshot.contractTemplateMxId
    && contractEnvironment(row) === snapshot.contractEnvironment
    && String(row.mx_registration_number || '') === String(snapshot.registrationNumber || '')
    && dateOnly(row.mx_registered_at) === dateOnly(snapshot.registeredAt)
    && String(row.mx_template_version || '') === String(snapshot.version || '')
    && row.mx_source_sha256 === snapshot.sourceSha256;
}

function assertActiveActivationTemplate(row, orgId, expectedEnvironment = null) {
  if (row.template_type !== 'activation_contract' || Number(row.is_active) !== 1) return null;
  if (!row.contract_template_mx_id) {
    throw new ValidationError(
      `Active MX activation template "${row.name || row.id}" is not linked to a contract source`,
    );
  }
  return assertReadyRecord(row, {
    orgId,
    bodyMd: row.body_md,
    context: `Active MX activation template "${row.name || row.id}"`,
    expectedEnvironment,
  });
}

async function loadLinkedRecord(run, { orgId, contractTemplateMxId, lock = false }) {
  const [rows] = await run(
    `SELECT id, organization_id, template_name, ift_registration_number,
            registered_at, version, template_body, document_file_id,
            environment, status, deleted_at
       FROM contract_templates_mx
      WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [contractTemplateMxId, orgId],
  );
  return rows[0] || null;
}

async function validateTemplateState(run, {
  orgId, templateType, bodyMd, isActive, contractTemplateMxId, lock = false,
  allowTerminalSourceForDeactivation = false,
}) {
  if (templateType !== 'activation_contract') {
    if (contractTemplateMxId !== null && contractTemplateMxId !== undefined) {
      throw new ValidationError('Only activation_contract templates may link an MX contract source');
    }
    return null;
  }
  if (!contractTemplateMxId) {
    if (isActive) {
      throw new ValidationError('An active MX activation contract must explicitly link a contract source');
    }
    return null;
  }
  const record = await loadLinkedRecord(run, { orgId, contractTemplateMxId, lock });
  if (!record) {
    throw new ValidationError('The linked MX contract source does not belong to this organization or is archived');
  }
  if (!exactTextEquals(record.template_body, bodyMd)) {
    throw new ValidationError('Activation-contract text must exactly match the linked MX contract source text');
  }
  // Terminal production rows may still be deactivated, but cannot be linked,
  // edited, or enabled. This prevents a revoked source trapping its operational
  // template in the active state.
  if (allowTerminalSourceForDeactivation === true
      && isActive === false
      && FROZEN_STATUSES.has(record.status)
      && !Object.values(READY_STATUS_BY_ENVIRONMENT).includes(record.status)) {
    return registrationSnapshot(record);
  }
  return assertReadyRecord(record, { orgId, bodyMd });
}

/** Read locale + current lane. Real migrated rows always return an environment. */
async function loadOrganizationContractEnvironment(run, { orgId, lock = false }) {
  const [organizations] = await run(
    `SELECT o.locale,
            CASE
              WHEN omp.contract_environment IS NOT NULL THEN omp.contract_environment
              WHEN EXISTS (
                SELECT 1 FROM contract_templates_mx legacy_source
                 WHERE legacy_source.organization_id = o.id
                   AND legacy_source.environment = 'production'
              ) THEN 'production'
              ELSE 'sandbox'
            END AS contract_environment,
            omp.id AS mx_profile_id
       FROM organizations o
       LEFT JOIN organization_mx_profiles omp
         ON omp.organization_id = o.id AND omp.deleted_at IS NULL
      WHERE o.id = ?
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [orgId],
  );
  const row = organizations[0] || null;
  if (!row) return null;
  // `production` is a compatibility fallback only for old unit fixtures that
  // mock SELECT locale without the new alias. The real CASE above always
  // yields sandbox or production. Its EXISTS arm deliberately includes
  // archived rows: archiving/restoring historical pre-452 evidence must not
  // itself flip the inferred lane. Create/restore guards prevent profile-less
  // operators from using that compatibility inference as a mode-switch path.
  // The arm preserves a pre-452 MX setup that has registry sources but no
  // fiscal-profile row; an actually
  // unconfigured organization still enters sandbox and must configure its
  // source/template explicitly.
  return { ...row, contract_environment: row.contract_environment || 'production' };
}

/**
 * Validate immutable legal provenance before a contract returns to pending
 * commissioning or live service.  Two independent fail-closed rules apply:
 *
 *   - Once an organization is Mexican, a source-free legacy/global contract
 *     cannot be renewed under that new jurisdiction.  The operator must create
 *     a newly classified MX contract instead of retroactively relabelling it.
 *   - Sandbox evidence is test-only and cannot resume after an MX organization
 *     enters production. Production contracts remain usable while the switch
 *     is temporarily in sandbox; that rule is intentionally asymmetric.
 *
 * The database status-FSM trigger is the final concurrency/direct-SQL guard.
 * Callers use this helper before external or provisioning side effects so the
 * operator receives an actionable validation error instead of a raw trigger
 * failure whenever the conflict is already visible.
 */
async function assertSandboxContractCanResume(run, {
  contract, context = 'Contract', lock = false, organizationLocale = null,
} = {}) {
  const environment = contractEnvironment(contract);
  const sourceId = contract?.contract_template_mx_id ?? contract?.mx_id ?? null;

  // A complete production snapshot is valid history regardless of which lane
  // is selected for new contracts, so it needs no current-organization read.
  if (environment === 'production' && sourceId !== null && sourceId !== undefined) return null;

  const incompleteSnapshot = sourceId === null || sourceId === undefined || environment === null;
  if (organizationLocale === 'MX' && incompleteSnapshot) {
    throw new ValidationError(
      `${context} has no complete frozen MX contract source/environment snapshot and cannot return to pending or active service; create a new classified MX contract instead`,
    );
  }
  if (organizationLocale && organizationLocale !== 'MX' && incompleteSnapshot) return null;

  let orgId = contract?.organization_id;
  if ((orgId === null || orgId === undefined) && contract?.client_id) {
    const [owners] = await run(
      'SELECT organization_id FROM clients WHERE id = ? LIMIT 1',
      [contract.client_id],
    );
    orgId = owners[0]?.organization_id ?? null;
  }
  if (orgId === null || orgId === undefined) {
    if (environment === 'sandbox') {
      throw new ValidationError(`${context} has sandbox evidence without an owning organization`);
    }
    // A genuinely single-tenant/global legacy row has no MX organization to
    // classify against and retains its existing renewal behavior.
    return null;
  }
  const organization = await loadOrganizationContractEnvironment(run, { orgId, lock });
  if (!organization) throw new ValidationError(`${context} organization does not exist`);
  if (organization.locale === 'MX' && incompleteSnapshot) {
    throw new ValidationError(
      `${context} has no complete frozen MX contract source/environment snapshot and cannot return to pending or active service; create a new classified MX contract instead`,
    );
  }
  if (environment === 'sandbox'
      && organization.locale === 'MX'
      && organization.contract_environment === 'production') {
    throw new ValidationError(
      `${context} uses sandbox contract evidence and cannot return to pending or active service while the organization uses production contracts; create a new production contract instead`,
    );
  }
  return organization;
}

async function validateContractSelection(run, {
  orgId, contractTemplateMxId, contractEnvironment: expectedEnvironment = null,
}) {
  if (!contractTemplateMxId) return null;
  if (orgId === null || orgId === undefined) {
    throw new ValidationError('An MX contract source requires an organization');
  }
  const organization = await loadOrganizationContractEnvironment(run, { orgId });
  if (organization?.locale !== 'MX') {
    throw new ValidationError('Global contracts cannot use an MX contract source');
  }
  const record = await loadLinkedRecord(run, { orgId, contractTemplateMxId });
  return assertReadyRecord(record, {
    orgId,
    bodyMd: record?.template_body,
    context: 'Contract',
    expectedEnvironment,
  });
}

/**
 * Resolve the one source active for a given environment. Opposite-lane active
 * templates deliberately coexist and are ignored. An unlinked active legacy
 * row is still included and fails closed instead of disappearing behind the
 * environment filter.
 */
async function resolveActiveContractSource(run, {
  orgId, contractTemplateMxId = null, contractEnvironment: requestedEnvironment = null,
  lock = false,
}) {
  if (orgId === null || orgId === undefined) {
    if (contractTemplateMxId !== null && contractTemplateMxId !== undefined) {
      throw new ValidationError('Global contracts cannot use an MX contract source');
    }
    return null;
  }

  const organization = await loadOrganizationContractEnvironment(run, { orgId, lock });
  if (!organization) throw new ValidationError('Contract organization does not exist');
  if (organization.locale !== 'MX') {
    if (contractTemplateMxId !== null && contractTemplateMxId !== undefined) {
      throw new ValidationError('Global contracts cannot use an MX contract source');
    }
    return null;
  }
  const environment = assertEnvironment(
    requestedEnvironment || organization.contract_environment,
  );
  const lockClause = lock ? ' FOR UPDATE' : '';
  const [activeTemplates] = await run(
    `SELECT dt.*${joinedRegistrationColumns('ctm')}
       FROM document_templates dt
       LEFT JOIN contract_templates_mx ctm ON ctm.id = dt.contract_template_mx_id
      WHERE dt.organization_id = ? AND dt.template_type = 'activation_contract'
        AND dt.is_active = 1 AND dt.deleted_at IS NULL
        AND (ctm.id IS NULL OR ctm.environment = ?)
      ORDER BY dt.id${lockClause}`,
    [orgId, environment],
  );
  if (!activeTemplates.length) {
    throw new ValidationError(
      `Configure and activate at least one reviewed MX ${environment} activation-contract template before creating a contract`,
    );
  }

  const snapshot = assertOneRegisteredSource(activeTemplates, orgId, environment);
  if (contractTemplateMxId !== null
      && contractTemplateMxId !== undefined
      && Number(contractTemplateMxId) !== snapshot.contractTemplateMxId) {
    throw new ValidationError(
      `Contract must use the MX ${environment} source referenced by the active activation document`,
    );
  }
  return snapshot;
}

function joinedRegistrationColumns(alias = 'ctm') {
  return `,
          ${alias}.id AS mx_id,
          ${alias}.organization_id AS mx_organization_id,
          ${alias}.ift_registration_number AS mx_registration_number,
          ${alias}.registered_at AS mx_registered_at,
          ${alias}.version AS mx_template_version,
          ${alias}.template_body AS mx_template_body,
          ${alias}.environment AS mx_contract_environment,
          ${alias}.status AS mx_status,
          ${alias}.deleted_at AS mx_deleted_at`;
}

function assertOneRegisteredSource(activeRows, orgId, expectedEnvironment = null) {
  const snapshots = activeRows.map(row => (
    assertActiveActivationTemplate(row, orgId, expectedEnvironment)
  ));
  const ids = new Set(snapshots.filter(Boolean).map(snapshot => snapshot.contractTemplateMxId));
  if (activeRows.length && ids.size === 0) {
    throw new ValidationError('Active MX activation templates are missing contract-source evidence');
  }
  if (ids.size > 1) {
    throw new ValidationError(
      'All active MX activation documents in one environment must reference the same contract source',
    );
  }
  return snapshots.find(Boolean) || null;
}

module.exports = {
  CONTRACT_ENVIRONMENTS,
  READY_STATUS_BY_ENVIRONMENT,
  SOURCE_FIELDS,
  FROZEN_STATUSES,
  exactTextEquals,
  sourceHash,
  dateOnly,
  contractEnvironment,
  assertEnvironment,
  registrationSnapshot,
  snapshotMatchesRegisteredSource,
  assertReadyRecord,
  assertRegisteredRecord,
  assertActiveActivationTemplate,
  assertOneRegisteredSource,
  loadLinkedRecord,
  loadOrganizationContractEnvironment,
  assertSandboxContractCanResume,
  validateTemplateState,
  validateContractSelection,
  resolveActiveContractSource,
  joinedRegistrationColumns,
};
