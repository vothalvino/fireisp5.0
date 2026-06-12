// =============================================================================
// FireISP 5.0 — Rate Limit Template Routes (§10.2)
// =============================================================================

const { Router } = require('express');
const RateLimitTemplate = require('../models/RateLimitTemplate');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRateLimitTemplate, updateRateLimitTemplate } = require('../middleware/schemas/rateLimitTemplates');
const { buildRateString } = require('../services/qosService');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(RateLimitTemplate);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('rate_limit_templates.view'), ctrl.list);
router.get('/:id', requirePermission('rate_limit_templates.view'), ctrl.get);

router.post('/', requirePermission('rate_limit_templates.create'), validate(createRateLimitTemplate), async (req, res, next) => {
  try {
    // Compute and persist rendered rate_string on create
    const rateString = buildRateString({ radius_vendor: 'mikrotik', ...req.body });
    const data = { ...req.body, rate_string: rateString, organization_id: req.orgId };
    const [result] = await db.query(
      `INSERT INTO rate_limit_templates
        (organization_id, name, description, service_type, radius_vendor,
         download_mbps, upload_mbps, burst_download_mbps, burst_upload_mbps,
         burst_threshold_mbps, burst_time_seconds, rate_string, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.organization_id, data.name, data.description ?? null,
        data.service_type ?? 'pppoe', data.radius_vendor ?? 'mikrotik',
        data.download_mbps, data.upload_mbps,
        data.burst_download_mbps ?? null, data.burst_upload_mbps ?? null,
        data.burst_threshold_mbps ?? null, data.burst_time_seconds ?? null,
        data.rate_string, data.priority ?? 4, data.status ?? 'active',
      ],
    );
    const [rows] = await db.query('SELECT * FROM rate_limit_templates WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('rate_limit_templates.update'), validate(updateRateLimitTemplate), async (req, res, next) => {
  try {
    const existing = await RateLimitTemplate.findById(req.params.id, req.orgId);
    if (!existing) return res.status(404).json({ error: 'Rate limit template not found' });
    const merged = { ...existing, ...req.body };
    const rateString = buildRateString(merged);
    await db.query(
      `UPDATE rate_limit_templates
       SET name=?, description=?, service_type=?, radius_vendor=?,
           download_mbps=?, upload_mbps=?, burst_download_mbps=?, burst_upload_mbps=?,
           burst_threshold_mbps=?, burst_time_seconds=?, rate_string=?, priority=?, status=?
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [
        merged.name, merged.description ?? null,
        merged.service_type ?? 'pppoe', merged.radius_vendor ?? 'mikrotik',
        merged.download_mbps, merged.upload_mbps,
        merged.burst_download_mbps ?? null, merged.burst_upload_mbps ?? null,
        merged.burst_threshold_mbps ?? null, merged.burst_time_seconds ?? null,
        rateString, merged.priority ?? 4, merged.status ?? 'active',
        req.params.id, req.orgId,
      ],
    );
    const [rows] = await db.query('SELECT * FROM rate_limit_templates WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('rate_limit_templates.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('rate_limit_templates.update'), ctrl.restore);

// Preview the rendered rate string for a given set of params
router.post('/preview', requirePermission('rate_limit_templates.view'), async (req, res, next) => {
  try {
    const rateString = buildRateString({ radius_vendor: 'mikrotik', ...req.body });
    res.json({ data: { rate_string: rateString } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
