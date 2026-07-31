// =============================================================================
// FireISP 5.0 — Outage Routes
// =============================================================================

const { Router } = require('express');
const Outage = require('../models/Outage');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createOutage, updateOutage } = require('../middleware/schemas/outages');
const db = require('../config/database');
const eventBus = require('../services/eventBus');
const logger = require('../utils/logger').child({ service: 'routes/outages' });

const router = Router();

// Fire-and-forget: mirrors workOrders.js's emitAssigned pattern — never
// allowed to delay or fail the HTTP response.
//
// The ROW's organization_id is the routing key, not req.orgId. Those are the
// same thing now that writes are org-scoped, but using the row's value states
// the intent: the notification belongs to whoever owns the outage. Before
// migration 437 a tenant could resolve another tenant's outage and this
// emitted into the EDITING org's channel, so the owning NOC never heard.
function emitReported(organizationId, outage) {
  Promise.resolve(eventBus.emit('outage.reported', { organizationId, outage }))
    .catch(err => logger.warn({ err: err.message, outageId: outage.id }, 'outage.reported emit failed'));
}

function emitResolved(organizationId, outage) {
  Promise.resolve(eventBus.emit('outage.resolved', { organizationId, outage }))
    .catch(err => logger.warn({ err: err.message, outageId: outage.id }, 'outage.resolved emit failed'));
}

const ctrl = crudController(Outage, {
  afterCreate: async (record, req) => {
    emitReported(req.orgId, record);
  },
  // Stash the pre-update status so afterUpdate can tell whether this PUT is
  // the transition INTO 'resolved' (vs. e.g. an unrelated edit to an
  // already-resolved outage, which must NOT re-emit).
  beforeUpdate: async (old, req) => {
    req._priorOutageStatus = old.status;
  },
  afterUpdate: async (record, req) => {
    if (req._priorOutageStatus !== 'resolved' && record.status === 'resolved') {
      emitResolved(req.orgId, record);
    }
  },
});

router.use(authenticate);
router.use(orgScope);

/**
 * An outage the tenant may act on: theirs, or an unattributed legacy row.
 *
 * BaseModel cannot express this — with hasOrgScope true it emits a bare
 * `organization_id = ?`, which HIDES every NULL-org row. That is the anti-fix
 * #582 rejected for scheduled_tasks: an operator sees an empty page and
 * concludes nothing is wrong, which is worse than the leak it replaces.
 */
const VISIBLE = '(o.organization_id = ? OR o.organization_id IS NULL)';

router.get('/', requirePermission('outages.view'), async (req, res, next) => {
  try {
    const { status, site_id, device_id, page = 1, limit = 50 } = req.query;
    const where = [VISIBLE, 'o.deleted_at IS NULL'];
    const params = [req.orgId];
    if (status) { where.push('o.status = ?'); params.push(status); }
    if (site_id) { where.push('o.site_id = ?'); params.push(site_id); }
    if (device_id) { where.push('o.device_id = ?'); params.push(device_id); }

    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const clause = `WHERE ${where.join(' AND ')}`;

    // is_unattributed tells the UI why a row it can see has no owner, and is
    // the same idea as is_shared (#566) and is_global (#582).
    const [rows] = await db.query(
      `SELECT o.*, (o.organization_id IS NULL) AS is_unattributed
         FROM outages o ${clause}
        ORDER BY o.started_at DESC
        LIMIT ${safeLimit} OFFSET ${(safePage - 1) * safeLimit}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM outages o ${clause}`, params,
    );
    res.json({
      data: rows,
      meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('outages.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT o.*, (o.organization_id IS NULL) AS is_unattributed
         FROM outages o WHERE o.id = ? AND ${VISIBLE} AND o.deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (!rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outage not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * An outage cannot be moved between tenants.
 *
 * organization_id must be fillable (create injects it, and adoption sets it),
 * and the update schema does not declare it — and validate() IGNORES
 * undeclared fields rather than stripping them. Without this a PUT could hand
 * an outage to another org, or NULL it and make it unattributed again.
 */
function rejectOrgReassignment(req, res, next) {
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'organization_id')) {
    return res.status(422).json({
      error: { code: 'ORG_IMMUTABLE', message: 'An outage cannot be moved to another organization.' },
    });
  }
  next();
}

/**
 * Let the first tenant that writes to an unattributed legacy row ADOPT it.
 *
 * Without this, the strict write predicate makes those rows permanently
 * un-editable: a legacy 'ongoing' outage would sit on every tenant's NOC
 * dashboard with no way to resolve it. Adoption also closes the set — from
 * migration 437 on nothing new is unattributed, so this can only shrink.
 *
 * Runs BEFORE the write so BaseModel's `organization_id = ?` then matches.
 */
async function adoptUnattributed(req, res, next) {
  try {
    const [rows] = await db.query(
      'SELECT organization_id FROM outages WHERE id = ? LIMIT 1', [req.params.id],
    );
    if (rows[0] && rows[0].organization_id === null && req.orgId) {
      await db.query(
        'UPDATE outages SET organization_id = ? WHERE id = ? AND organization_id IS NULL',
        [req.orgId, req.params.id],
      );
      logger.info({ outageId: req.params.id, organizationId: req.orgId },
        'Adopted an unattributed outage into the acting organization');
    }
    next();
  } catch (err) { next(err); }
}

router.post('/', requirePermission('outages.create'), validate(createOutage), ctrl.create);
router.put('/:id', requirePermission('outages.update'), rejectOrgReassignment, adoptUnattributed, validate(updateOutage), ctrl.update);
router.delete('/:id', requirePermission('outages.delete'), adoptUnattributed, ctrl.destroy);
router.post('/:id/restore', requirePermission('outages.update'), adoptUnattributed, ctrl.restore);

module.exports = router;
