// =============================================================================
// MX registered contract-template bridge
// =============================================================================
// document_templates are the operational, placeholder-aware documents shown
// in the installation flow. contract_templates_mx is the authoritative
// registry of the exact adhesion-contract text and its registration metadata.
// This service keeps that bridge fail-closed and reusable by every activation
// entry point (template CRUD, generation, readiness and final activation).
// =============================================================================

const crypto = require('crypto');
const { ValidationError } = require('../utils/errors');

const SOURCE_FIELDS = [
  'template_name', 'ift_registration_number', 'registered_at',
  'version', 'template_body', 'document_file_id',
];
const FROZEN_STATUSES = new Set(['registered', 'expired', 'revoked']);

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

function registrationSnapshot(row) {
  return {
    contractTemplateMxId: Number(row.contract_template_mx_id ?? row.mx_id ?? row.id),
    registrationNumber: row.mx_registration_number ?? row.ift_registration_number,
    registeredAt: dateOnly(row.mx_registered_at ?? row.registered_at),
    version: row.mx_template_version ?? row.version,
    sourceSha256: sourceHash(row.mx_template_body ?? row.template_body),
  };
}

function assertRegisteredRecord(row, { orgId, bodyMd, context = 'MX activation contract' } = {}) {
  if (!row) {
    throw new ValidationError(`${context} must link an organization-owned registered MX contract template`);
  }
  const rowOrgId = row.mx_organization_id ?? row.organization_id;
  if (Number(rowOrgId) !== Number(orgId)) {
    throw new ValidationError(`${context} cannot use a registered template from another organization`);
  }
  if ((row.mx_status ?? row.status) !== 'registered') {
    throw new ValidationError(`${context} must link a contract template whose status is registered`);
  }
  const deletedAt = Object.prototype.hasOwnProperty.call(row, 'mx_deleted_at')
    ? row.mx_deleted_at
    : row.deleted_at;
  if (deletedAt) {
    throw new ValidationError(`${context} cannot use an archived registered template`);
  }
  const registrationNumber = row.mx_registration_number ?? row.ift_registration_number;
  const registeredAt = row.mx_registered_at ?? row.registered_at;
  if (!String(registrationNumber || '').trim() || !registeredAt) {
    throw new ValidationError(`${context} requires a registration number and registration date`);
  }
  const sourceBody = row.mx_template_body ?? row.template_body;
  if (!exactTextEquals(sourceBody, bodyMd)) {
    throw new ValidationError(
      `${context} text must exactly match the frozen text of its registered MX contract template`,
    );
  }
  return registrationSnapshot(row);
}

function snapshotMatchesRegisteredSource(row, snapshot) {
  return Boolean(snapshot)
    && Number(row.contract_template_mx_id) === snapshot.contractTemplateMxId
    && String(row.mx_registration_number || '') === String(snapshot.registrationNumber || '')
    && dateOnly(row.mx_registered_at) === dateOnly(snapshot.registeredAt)
    && String(row.mx_template_version || '') === String(snapshot.version || '')
    && row.mx_source_sha256 === snapshot.sourceSha256;
}

function assertActiveActivationTemplate(row, orgId) {
  if (row.template_type !== 'activation_contract' || Number(row.is_active) !== 1) return null;
  if (!row.contract_template_mx_id) {
    throw new ValidationError(
      `Active MX activation template "${row.name || row.id}" is not linked to a registered contract template`,
    );
  }
  return assertRegisteredRecord(row, {
    orgId,
    bodyMd: row.body_md,
    context: `Active MX activation template "${row.name || row.id}"`,
  });
}

async function loadLinkedRecord(run, { orgId, contractTemplateMxId, lock = false }) {
  const [rows] = await run(
    `SELECT id, organization_id, template_name, ift_registration_number,
            registered_at, version, template_body, document_file_id, status, deleted_at
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
      throw new ValidationError('Only activation_contract templates may link an MX registered contract template');
    }
    return null;
  }
  if (!contractTemplateMxId) {
    if (isActive) {
      throw new ValidationError(
        'An active MX activation contract must explicitly link a registered contract template',
      );
    }
    return null;
  }
  const record = await loadLinkedRecord(run, { orgId, contractTemplateMxId, lock });
  if (!record) {
    throw new ValidationError('The linked MX contract template does not belong to this organization or is archived');
  }
  if (!exactTextEquals(record.template_body, bodyMd)) {
    throw new ValidationError(
      'Activation-contract text must exactly match the linked MX registered template text',
    );
  }
  // Expiring or revoking the authoritative registry row must fail closed for
  // generation and activation, but it must not trap an already-active
  // operational template in the active state. The route grants this exception
  // only for an exact active -> inactive transition with no body/link/name/type
  // change. New links, edits, and every active end state still take the strict
  // registered-record path below.
  if (allowTerminalSourceForDeactivation === true
      && isActive === false
      && FROZEN_STATUSES.has(record.status)
      && record.status !== 'registered') {
    return registrationSnapshot(record);
  }
  // A link itself carries a legal meaning, even before the operational
  // template is enabled. Draft/submitted registry rows must never masquerade
  // as the source of an activation document.
  return assertRegisteredRecord(record, { orgId, bodyMd });
}

async function validateContractSelection(run, { orgId, contractTemplateMxId }) {
  if (!contractTemplateMxId) return null;
  if (orgId === null || orgId === undefined) {
    throw new ValidationError('An MX registered contract template requires an organization');
  }
  const [organizations] = await run(
    'SELECT locale FROM organizations WHERE id = ? LIMIT 1',
    [orgId],
  );
  if (organizations[0]?.locale !== 'MX') {
    throw new ValidationError('Global contracts cannot use an MX registered contract template');
  }
  const record = await loadLinkedRecord(run, { orgId, contractTemplateMxId });
  return assertRegisteredRecord(record, {
    orgId,
    bodyMd: record?.template_body,
    context: 'Contract',
  });
}

/**
 * Resolve the only registered source that a newly-created/pending contract may
 * reference.  Contract selection is not an independent legal choice: it must
 * be the same source as every currently-active activation document, otherwise
 * the contract is guaranteed to fail the installation preparation gate later.
 *
 * `run` is deliberately injected so callers that are already in a transaction
 * keep every read and lock on that connection.  With `lock`, the organization
 * row serializes against document-template activation/deactivation and the
 * joined rows prevent a registry status transition from racing the decision.
 */
async function resolveActiveContractSource(run, {
  orgId, contractTemplateMxId = null, lock = false,
}) {
  if (orgId === null || orgId === undefined) {
    if (contractTemplateMxId !== null && contractTemplateMxId !== undefined) {
      throw new ValidationError('Global contracts cannot use an MX registered contract template');
    }
    return null;
  }

  const lockClause = lock ? ' FOR UPDATE' : '';
  const [organizations] = await run(
    `SELECT locale FROM organizations WHERE id = ? LIMIT 1${lockClause}`,
    [orgId],
  );
  if (!organizations[0]) {
    throw new ValidationError('Contract organization does not exist');
  }
  if (organizations[0].locale !== 'MX') {
    if (contractTemplateMxId !== null && contractTemplateMxId !== undefined) {
      throw new ValidationError('Global contracts cannot use an MX registered contract template');
    }
    return null;
  }

  const [activeTemplates] = await run(
    `SELECT dt.*${joinedRegistrationColumns('ctm')}
       FROM document_templates dt
       LEFT JOIN contract_templates_mx ctm ON ctm.id = dt.contract_template_mx_id
      WHERE dt.organization_id = ? AND dt.template_type = 'activation_contract'
        AND dt.is_active = 1 AND dt.deleted_at IS NULL
      ORDER BY dt.id${lockClause}`,
    [orgId],
  );
  if (!activeTemplates.length) {
    throw new ValidationError(
      'Configure and activate at least one reviewed MX activation-contract template before creating a contract',
    );
  }

  const snapshot = assertOneRegisteredSource(activeTemplates, orgId);
  if (contractTemplateMxId !== null
      && contractTemplateMxId !== undefined
      && Number(contractTemplateMxId) !== snapshot.contractTemplateMxId) {
    throw new ValidationError(
      'Contract must use the registered MX template referenced by the active activation document',
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
          ${alias}.status AS mx_status,
          ${alias}.deleted_at AS mx_deleted_at`;
}

function assertOneRegisteredSource(activeRows, orgId) {
  const snapshots = activeRows.map(row => assertActiveActivationTemplate(row, orgId));
  const ids = new Set(snapshots.filter(Boolean).map(snapshot => snapshot.contractTemplateMxId));
  if (activeRows.length && ids.size === 0) {
    throw new ValidationError('Active MX activation templates are missing registered-source evidence');
  }
  if (ids.size > 1) {
    throw new ValidationError(
      'All active MX activation documents must reference the same registered contract template',
    );
  }
  return snapshots.find(Boolean) || null;
}

module.exports = {
  SOURCE_FIELDS,
  FROZEN_STATUSES,
  exactTextEquals,
  sourceHash,
  dateOnly,
  registrationSnapshot,
  snapshotMatchesRegisteredSource,
  assertRegisteredRecord,
  assertActiveActivationTemplate,
  assertOneRegisteredSource,
  loadLinkedRecord,
  validateTemplateState,
  validateContractSelection,
  resolveActiveContractSource,
  joinedRegistrationColumns,
};
