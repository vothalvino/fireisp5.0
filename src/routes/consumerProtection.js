// =============================================================================
// FireISP 5.0 — Consumer Protection Routes (§16.7)
// Covers: service_modification_notices, contract_templates_mx
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requireMxLocale } = require('../middleware/orgLocale');
const { requirePermission } = require('../middleware/rbac');
const ContractTemplateMx = require('../models/ContractTemplateMx');
const { crudController } = require('../controllers/crudController');
const mxRegisteredTemplateService = require('../services/mxRegisteredContractTemplateService');
const { AppError, ValidationError } = require('../utils/errors');

const router = Router();

function sameSourceValue(field, left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right;
  }
  if (field === 'registered_at') {
    return mxRegisteredTemplateService.dateOnly(left)
      === mxRegisteredTemplateService.dateOnly(right);
  }
  return String(left) === String(right);
}

function normalizeOfficialFields(record) {
  for (const field of ['ift_registration_number', 'registered_at']) {
    if (record[field] === '') record[field] = null;
  }
}

function assertSourceState(record) {
  if (!String(record.template_name || '').trim()) {
    throw new ValidationError('template_name is required');
  }
  const environment = mxRegisteredTemplateService.assertEnvironment(
    record.environment,
    'environment',
  );
  const status = record.status || 'draft';
  const sandboxStatuses = new Set(['draft', 'sandbox_ready']);
  const productionStatuses = new Set(['draft', 'submitted', 'registered', 'expired', 'revoked']);
  if (environment === 'sandbox' && !sandboxStatuses.has(status)) {
    throw new ValidationError("A sandbox source status must be 'draft' or 'sandbox_ready'");
  }
  if (environment === 'production' && !productionStatuses.has(status)) {
    throw new ValidationError(
      "A production source status must be 'draft', 'submitted', 'registered', 'expired', or 'revoked'",
    );
  }

  const hasOfficialNumber = Boolean(String(record.ift_registration_number || '').trim());
  const hasOfficialDate = Boolean(record.registered_at);
  if (environment === 'sandbox' && (hasOfficialNumber || hasOfficialDate)) {
    throw new ValidationError(
      'Sandbox contract sources cannot contain an official registration number or date',
    );
  }
  const readyStatus = mxRegisteredTemplateService.READY_STATUS_BY_ENVIRONMENT[environment];
  if (status === readyStatus
      && (!String(record.template_body || '').trim()
        || !String(record.version || '').trim())) {
    throw new ValidationError(`${readyStatus} requires exact contract text and a version`);
  }
  if (environment === 'production' && ['registered', 'expired', 'revoked'].includes(status)
      && (!hasOfficialNumber || !hasOfficialDate || !String(record.template_body || '').trim())) {
    throw new ValidationError(
      'A registered production source requires exact text, an official registration number, and registration date',
    );
  }
}

const ctrl = crudController(ContractTemplateMx, {
  // Once registration has legal effect, the source text and official metadata
  // are evidence, not editable configuration. transactionalWrites locks that
  // row while checking downstream links, closing edit-vs-activation races.
  transactionalWrites: true,
  beforeCreate: async (req) => {
    normalizeOfficialFields(req.body);
    if (req.body.environment === undefined) {
      throw new ValidationError(
        "environment is required and must be 'sandbox' or 'production'",
      );
    }
    const organization = await mxRegisteredTemplateService.loadOrganizationContractEnvironment(
      db.query.bind(db),
      { orgId: req.orgId },
    );
    // A production source makes a real legal-evidence lane available. Require
    // the org profile to exist first so staging the first production row cannot
    // change a profile-less sandbox org's effective mode through the legacy
    // inference branch. Pre-452 production rows remain readable and editable;
    // this applies only to new production configuration.
    if (req.body.environment === 'production' && !organization?.mx_profile_id) {
      throw new ValidationError(
        'Configure the organization MX profile before creating a production contract source',
      );
    }
    if (req.body.status === undefined) req.body.status = 'draft';
    assertSourceState(req.body);
  },
  beforeUpdate: async (old, req, exec) => {
    normalizeOfficialFields(req.body);
    const next = { ...old, ...req.body };
    if (req.body.environment !== undefined && req.body.environment !== old.environment) {
      throw new ValidationError(
        'A contract source environment is permanently immutable; create a separate source in the other environment',
      );
    }
    assertSourceState(next);

    if (old.status === 'sandbox_ready'
        && req.body.status !== undefined
        && req.body.status !== 'sandbox_ready') {
      throw new ValidationError(
        'A sandbox-ready source cannot be promoted or relabeled; create a separate production source',
      );
    }
    if (old.status === 'registered'
        && req.body.status !== undefined
        && !['registered', 'expired', 'revoked'].includes(req.body.status)) {
      throw new ValidationError('A registered MX contract template may only be expired or revoked; create a new version instead');
    }
    if (['expired', 'revoked'].includes(old.status)
        && req.body.status !== undefined
        && req.body.status !== old.status) {
      throw new ValidationError('An expired or revoked MX contract template cannot be reactivated; create a new version');
    }

    const changedSource = mxRegisteredTemplateService.SOURCE_FIELDS.filter(field => (
      req.body[field] !== undefined && !sameSourceValue(field, req.body[field], old[field])
    ));
    if (!changedSource.length) return;

    if (mxRegisteredTemplateService.FROZEN_STATUSES.has(old.status)) {
      throw new ValidationError(
        'Registered MX contract text and registration metadata are permanently immutable; create a new version',
      );
    }

    const [[references]] = await exec(
      `SELECT
         EXISTS(SELECT 1 FROM document_templates WHERE contract_template_mx_id = ? LIMIT 1) AS document_template_used,
         EXISTS(SELECT 1 FROM contracts WHERE contract_template_mx_id = ? LIMIT 1) AS contract_used,
         EXISTS(SELECT 1 FROM signed_documents WHERE contract_template_mx_id = ? LIMIT 1) AS signed_document_used`,
      [old.id, old.id, old.id],
    );
    if (Number(references?.document_template_used) === 1
        || Number(references?.contract_used) === 1
        || Number(references?.signed_document_used) === 1) {
      throw new ValidationError(
        'This MX contract template is already linked to installation evidence and cannot be rewritten; create a new version',
      );
    }
  },
  beforeDelete: async (old, _req, exec) => {
    const [[references]] = await exec(
      `SELECT
         EXISTS(SELECT 1 FROM document_templates WHERE contract_template_mx_id = ? LIMIT 1) AS document_template_used,
         EXISTS(SELECT 1 FROM contracts WHERE contract_template_mx_id = ? LIMIT 1) AS contract_used,
         EXISTS(SELECT 1 FROM signed_documents WHERE contract_template_mx_id = ? LIMIT 1) AS signed_document_used`,
      [old.id, old.id, old.id],
    );
    if (Number(references?.document_template_used) === 1
        || Number(references?.contract_used) === 1
        || Number(references?.signed_document_used) === 1) {
      throw new ValidationError(
        'This MX contract template is part of installation or contract history and cannot be archived',
      );
    }
  },
  beforeRestore: async (req, exec) => {
    const [sources] = await exec(
      `SELECT id, environment
         FROM contract_templates_mx
        WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL
        LIMIT 1 FOR UPDATE`,
      [req.params.id, req.orgId],
    );
    const source = sources[0];
    if (source?.environment !== 'production') return;
    const [profiles] = await exec(
      `SELECT id
         FROM organization_mx_profiles
        WHERE organization_id = ? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [req.orgId],
    );
    if (!profiles[0]) {
      throw new ValidationError(
        'Configure the organization MX profile before restoring a production contract source',
      );
    }
  },
});

router.use(authenticate);
router.use(orgScope);
router.use(requireMxLocale);

// =============================================================================
// Active MX contract environment — independent from PAC/CFDI environment
// =============================================================================

router.get('/contract-environment', requirePermission('contract_templates_mx.view'), async (req, res, next) => {
  try {
    const organization = await mxRegisteredTemplateService.loadOrganizationContractEnvironment(
      db.query.bind(db),
      { orgId: req.orgId },
    );
    res.json({ data: { contract_environment: organization?.contract_environment || 'sandbox' } });
  } catch (err) { next(err); }
});

router.put('/contract-environment', requirePermission('contract_templates_mx.update'), async (req, res, next) => {
  let conn;
  try {
    const target = mxRegisteredTemplateService.assertEnvironment(req.body?.contract_environment);
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [organizations] = await conn.query(
      `SELECT o.id, o.locale, omp.id AS profile_id,
              CASE
                WHEN omp.contract_environment IS NOT NULL THEN omp.contract_environment
                WHEN EXISTS (
                  SELECT 1 FROM contract_templates_mx legacy_source
                   WHERE legacy_source.organization_id = o.id
                     AND legacy_source.environment = 'production'
                ) THEN 'production'
                ELSE 'sandbox'
              END AS contract_environment
         FROM organizations o
         LEFT JOIN organization_mx_profiles omp
           ON omp.organization_id = o.id AND omp.deleted_at IS NULL
        WHERE o.id = ? LIMIT 1 FOR UPDATE`,
      [req.orgId],
    );
    const organization = organizations[0];
    if (!organization || organization.locale !== 'MX') {
      throw new AppError('Contract environments are available only to Mexican organizations.', 403, 'MX_ONLY');
    }
    const current = organization.contract_environment || 'sandbox';
    if (current === target) {
      await conn.commit();
      return res.json({ data: { contract_environment: current } });
    }
    if (!organization.profile_id) {
      throw new AppError(
        'Configure the organization MX profile before switching its contract environment.',
        422,
        'ORG_MX_PROFILE_MISSING',
      );
    }

    // Preflight the target lane under the same organization/profile lock. It
    // must have exact source text and at least one active operational template;
    // this never fabricates production registration evidence.
    const targetSource = await mxRegisteredTemplateService.resolveActiveContractSource(
      conn.query.bind(conn),
      { orgId: req.orgId, contractEnvironment: target, lock: true },
    );

    // A mode switch never rewrites in-flight rows. Refuse until the current
    // lane has no pending contract, open installation order, or pending signing
    // packet, so operators cannot strand a half-finished handoff between lanes.
    const [[inFlight]] = await conn.query(
      `SELECT
         EXISTS(
           SELECT 1 FROM contracts c
            WHERE c.organization_id = ?
              AND (c.mx_contract_environment = ? OR c.mx_contract_environment IS NULL)
              AND c.status = 'pending' AND c.deleted_at IS NULL
         ) AS pending_contract,
         EXISTS(
           SELECT 1 FROM service_orders so
           LEFT JOIN contracts c ON c.id = so.contract_id
            AND c.organization_id = so.organization_id AND c.deleted_at IS NULL
            WHERE so.organization_id = ?
              AND (
                so.contract_id IS NULL
                OR c.mx_contract_environment = ?
                OR c.mx_contract_environment IS NULL
              )
              AND so.order_type = 'new_install' AND so.status IN ('new','in_process')
              AND so.deleted_at IS NULL
         ) AS open_installation,
         EXISTS(
           SELECT 1 FROM signed_documents sd
            WHERE sd.organization_id = ? AND sd.mx_contract_environment = ?
              AND sd.status = 'pending' AND sd.deleted_at IS NULL
         ) AS pending_document`,
      [req.orgId, current, req.orgId, current, req.orgId, current],
    );
    if (Number(inFlight?.pending_contract) === 1
        || Number(inFlight?.open_installation) === 1
        || Number(inFlight?.pending_document) === 1) {
      throw new AppError(
        `Finish or cancel every nonterminal ${current} installation before switching contract environments.`,
        409,
        'CONTRACT_ENVIRONMENT_IN_FLIGHT',
      );
    }
    if (current === 'sandbox' && target === 'production') {
      const [[liveSandbox]] = await conn.query(
        `SELECT EXISTS(
           SELECT 1 FROM contracts c
            WHERE c.organization_id = ? AND c.mx_contract_environment = 'sandbox'
              AND c.status NOT IN ('cancelled','terminated','expired')
              AND c.deleted_at IS NULL
         ) AS live_contract`,
        [req.orgId],
      );
      if (Number(liveSandbox?.live_contract) === 1) {
        throw new AppError(
          'Cancel, terminate, or expire every sandbox contract before switching to production; test-only service cannot remain live in production.',
          409,
          'LIVE_SANDBOX_CONTRACTS',
        );
      }
    }

    const [updated] = await conn.query(
      `UPDATE organization_mx_profiles
          SET contract_environment = ?
        WHERE id = ? AND contract_environment = ? AND deleted_at IS NULL`,
      [target, organization.profile_id, current],
    );
    if (updated.affectedRows !== 1) {
      throw new AppError(
        'Contract environment changed concurrently; reload and retry.',
        409,
        'CONTRACT_ENVIRONMENT_CONFLICT',
      );
    }
    await conn.query(
      `INSERT INTO audit_logs
         (user_id, organization_id, action, entity_type, entity_id,
          summary, old_values, new_values)
       VALUES (?, ?, 'update', 'organization_mx_profiles', ?, ?, ?, ?)`,
      [
        req.user?.id || null,
        req.orgId,
        organization.profile_id,
        `Set MX contract environment to ${target}`,
        JSON.stringify({ contract_environment: current }),
        JSON.stringify({
          contract_environment: target,
          active_contract_source_id: targetSource.contractTemplateMxId,
        }),
      ],
    );
    await conn.commit();
    return res.json({
      data: {
        contract_environment: target,
        active_contract_source_id: targetSource.contractTemplateMxId,
      },
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    return next(err);
  } finally {
    if (conn) conn.release();
  }
});

// =============================================================================
// Service Modification Notices — /service-modifications
// =============================================================================

router.get('/service-modifications', requirePermission('service_modification_notices.view'), async (req, res, next) => {
  try {
    const { status, notice_type, client_id, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (notice_type) { conditions.push('notice_type = ?'); params.push(notice_type); }
    if (client_id) { conditions.push('client_id = ?'); params.push(client_id); }

    const where = conditions.join(' AND ');
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (parseInt(page, 10) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM service_modification_notices WHERE ${where} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM service_modification_notices WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/service-modifications', requirePermission('service_modification_notices.create'), async (req, res, next) => {
  try {
    const { notice_type, description, effective_date, notice_required_days, channel, client_id, contract_id, notes } = req.body;

    const [result] = await db.query(
      `INSERT INTO service_modification_notices (organization_id, notice_type, description, effective_date, notice_required_days, channel, client_id, contract_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, notice_type, description || null, effective_date || null, notice_required_days || null, channel || null, client_id || null, contract_id || null, notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.get('/service-modifications/:id', requirePermission('service_modification_notices.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM service_modification_notices WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/service-modifications/:id', requirePermission('service_modification_notices.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notice_type, description, effective_date, notice_required_days, channel, client_id, contract_id, status, notes } = req.body;

    await db.query(
      `UPDATE service_modification_notices SET notice_type = ?, description = ?, effective_date = ?, notice_required_days = ?, channel = ?, client_id = ?, contract_id = ?, status = ?, notes = ?, updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [notice_type, description || null, effective_date || null, notice_required_days || null, channel || null, client_id || null, contract_id || null, status || 'draft', notes || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/service-modifications/:id/send', requirePermission('service_modification_notices.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE service_modification_notices SET noticed_at = NOW(), status = \'sent\', updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Contract Templates MX — /contract-templates-mx
// =============================================================================

router.get('/contract-templates-mx', requirePermission('contract_templates_mx.view'), ctrl.list);
router.get('/contract-templates-mx/:id', requirePermission('contract_templates_mx.view'), ctrl.get);
router.post('/contract-templates-mx', requirePermission('contract_templates_mx.create'), ctrl.create);
router.put('/contract-templates-mx/:id', requirePermission('contract_templates_mx.update'), ctrl.update);
router.delete('/contract-templates-mx/:id', requirePermission('contract_templates_mx.delete'), ctrl.destroy);
router.post('/contract-templates-mx/:id/restore', requirePermission('contract_templates_mx.update'), ctrl.restore);

module.exports = router;
