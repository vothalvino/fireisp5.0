// =============================================================================
// FireISP 5.0 — Site Routes
// =============================================================================

const { Router } = require('express');
const Site = require('../models/Site');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSite, updateSite, patchSite } = require('../middleware/schemas/sites');
const { httpCache } = require('../middleware/httpCache');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Site, { cacheResource: 'sites' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('sites.view'), httpCache('sites', 300), ctrl.list);

// GET /sites/:id/timeline — unified activity feed for a site/tower: work
// orders + outages + maintenance windows, newest first. This is the "what has
// happened to tower X" view; previously the answer lived in three separate
// screens. (outages has no organization_id column — the site is org-verified
// first, then outages are scoped through it.)
router.get('/:id/timeline', requirePermission('sites.view'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const [[site]] = await db.query(
      'SELECT id, name FROM sites WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const [rows] = await db.query(
      `SELECT * FROM (
         SELECT 'work_order' AS event_type, wo.id, wo.title, wo.work_type AS subtype,
                wo.status, wo.assigned_to, COALESCE(wo.scheduled_at, wo.created_at) AS occurred_at
         FROM work_orders wo
         WHERE wo.site_id = ? AND wo.organization_id = ? AND wo.deleted_at IS NULL

         UNION ALL

         SELECT 'outage', o.id, o.title, o.outage_type, o.status, NULL, o.started_at
         FROM outages o
         WHERE o.site_id = ? AND o.deleted_at IS NULL

         UNION ALL

         SELECT 'maintenance_window', mw.id, mw.name, NULL, mw.status, NULL, mw.starts_at
         FROM maintenance_windows mw
         WHERE mw.site_id = ? AND mw.organization_id = ? AND mw.deleted_at IS NULL
       ) ev
       ORDER BY occurred_at DESC
       LIMIT ${limit}`,
      [req.params.id, req.orgId, req.params.id, req.params.id, req.orgId],
    );
    res.json({ data: { site_id: site.id, site_name: site.name, events: rows } });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('sites.view'), ctrl.get);
router.post('/', requirePermission('sites.create'), validate(createSite), ctrl.create);
router.put('/:id', requirePermission('sites.update'), validate(updateSite), ctrl.update);
router.patch('/:id', requirePermission('sites.update'), validate(patchSite), ctrl.partialUpdate);
router.delete('/:id', requirePermission('sites.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('sites.update'), ctrl.restore);

module.exports = router;
