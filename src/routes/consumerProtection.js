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
const { ValidationError } = require('../utils/errors');

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

function assertRegistrationComplete(record) {
  if (!String(record.template_name || '').trim()) {
    throw new ValidationError('template_name is required');
  }
  if (record.status !== 'registered') return;
  if (!String(record.ift_registration_number || '').trim()
      || !record.registered_at
      || !String(record.template_body || '').trim()) {
    throw new ValidationError(
      'A registered MX contract template requires its exact text, registration number, and registration date',
    );
  }
}

const ctrl = crudController(ContractTemplateMx, {
  // Once registration has legal effect, the source text and official metadata
  // are evidence, not editable configuration. transactionalWrites locks that
  // row while checking downstream links, closing edit-vs-activation races.
  transactionalWrites: true,
  beforeCreate: async (req) => {
    assertRegistrationComplete({ status: 'draft', ...req.body });
  },
  beforeUpdate: async (old, req, exec) => {
    const next = { ...old, ...req.body };
    assertRegistrationComplete(next);

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
});

router.use(authenticate);
router.use(orgScope);
router.use(requireMxLocale);

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
