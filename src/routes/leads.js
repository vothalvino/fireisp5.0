// =============================================================================
// FireISP 5.0 — Lead Routes (prospect pipeline) — §1.2
// =============================================================================

const { Router } = require('express');
const Lead = require('../models/Lead');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createLead, updateLead, patchLead, convertLead } = require('../middleware/schemas/leads');
const lifecycleService = require('../services/lifecycleService');
const auditLog = require('../services/auditLog');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Lead, { cacheResource: 'leads' });

router.use(authenticate);
router.use(orgScope);

// List leads, with an optional free-text `search` (partial name/email/phone/
// company, exact numeric id) for the create-service-order lead picker. Falls
// through to the generic crudController list — unchanged, zero regression
// risk — whenever `search` is absent, so callers relying on order_by/order/
// filters/pagination keep their existing behaviour exactly.
router.get('/', requirePermission('leads.view'), async (req, res, next) => {
  const term = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (!term) return ctrl.list(req, res, next);

  try {
    const { page = 1, limit = 50 } = req.query;
    const conditions = [];
    const params = [];
    if (Lead.hasOrgScope && req.orgId) {
      conditions.push('organization_id = ?');
      params.push(req.orgId);
    }
    conditions.push('deleted_at IS NULL');
    // Partial match on name/email/phone/company; exact match on the numeric id
    // — mirrors routes/clients.js's search handler.
    conditions.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ? OR CAST(id AS CHAR) = ?)');
    params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, term);

    const where = `WHERE ${conditions.join(' AND ')}`;
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `SELECT * FROM leads ${where} ORDER BY id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM leads ${where}`,
      params,
    );

    res.json({
      data: rows,
      meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    });
  } catch (err) { next(err); }
});

// Pipeline stage counts — must precede '/:id'
router.get('/pipeline', requirePermission('leads.view'), async (req, res, next) => {
  try {
    const counts = await Lead.pipelineCounts(req.orgId);
    res.json({ data: counts });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('leads.view'), ctrl.get);
router.post('/', requirePermission('leads.create'), validate(createLead), ctrl.create);
router.put('/:id', requirePermission('leads.update'), validate(updateLead), ctrl.update);
router.patch('/:id', requirePermission('leads.update'), validate(patchLead), ctrl.partialUpdate);
router.delete('/:id', requirePermission('leads.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('leads.update'), ctrl.restore);

// Convert a lead into a client (creates the client, marks the lead won)
router.post('/:id/convert', requirePermission('clients.create'), validate(convertLead), async (req, res, next) => {
  try {
    const result = await lifecycleService.convertLead(req.params.id, req.orgId, req.body || {});
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'convert',
      tableName: 'leads',
      recordId: parseInt(req.params.id, 10),
      newValues: { converted_client_id: result.client.id },
    }).catch(() => {});
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

module.exports = router;
