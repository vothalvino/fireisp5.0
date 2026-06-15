// =============================================================================
// FireISP 5.0 — Consumer Protection Routes (§16.7)
// Covers: service_modification_notices, contract_templates_mx
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const ContractTemplateMx = require('../models/ContractTemplateMx');
const { crudController } = require('../controllers/crudController');

const router = Router();
const ctrl = crudController(ContractTemplateMx);

router.use(authenticate);
router.use(orgScope);

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
