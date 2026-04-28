// =============================================================================
// FireISP 5.0 — PROFECO Complaint Routes (P3.12)
// =============================================================================
// Provides CRUD management and export of PROFECO (Procuraduría Federal del
// Consumidor) consumer complaints.  Mexican ISPs must maintain a complaint
// register and produce quarterly exports for regulatory review.
//
// Endpoints:
//   GET    /api/v1/profeco-complaints            — paginated list (filterable)
//   GET    /api/v1/profeco-complaints/export      — CSV or JSON bulk export
//   GET    /api/v1/profeco-complaints/:id         — single complaint
//   POST   /api/v1/profeco-complaints             — log new complaint
//   PUT    /api/v1/profeco-complaints/:id         — full update
//   PATCH  /api/v1/profeco-complaints/:id         — partial update
//   DELETE /api/v1/profeco-complaints/:id         — soft delete
//   POST   /api/v1/profeco-complaints/:id/restore — restore soft-deleted
// =============================================================================

const { Router }  = require('express');
const ProfecoComplaint = require('../models/ProfecoComplaint');
const { crudController } = require('../controllers/crudController');
const { authenticate }   = require('../middleware/auth');
const { orgScope }       = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate }       = require('../middleware/validate');
const { createProfecoComplaint, updateProfecoComplaint, patchProfecoComplaint } = require('../middleware/schemas/profeco');
const { buildReport }    = require('../services/profecoService');

const router = Router();
const ctrl   = crudController(ProfecoComplaint);

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Export endpoint — must be declared before /:id to avoid routing conflicts
// ---------------------------------------------------------------------------

/**
 * GET /export
 * Query params:
 *   date_from  — ISO date (e.g. 2026-01-01)
 *   date_to    — ISO date (e.g. 2026-03-31)
 *   status     — filter by status
 *   format     — 'json' (default) | 'csv'
 */
router.get('/export', requirePermission('tickets.view'), async (req, res, next) => {
  try {
    const { date_from, date_to, status, format } = req.query;
    const report = await buildReport(req.orgId, {
      dateFrom: date_from || undefined,
      dateTo:   date_to   || undefined,
      status:   status    || undefined,
      format:   format    || 'json',
    });

    res.set('Content-Type', report.contentType);
    res.set('Content-Disposition', `attachment; filename="${report.filename}"`);

    if (report.format === 'csv') {
      res.send(report.data);
    } else {
      res.json(report.data);
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Standard CRUD
// ---------------------------------------------------------------------------

router.get('/',       requirePermission('tickets.view'),   ctrl.list);
router.get('/:id',    requirePermission('tickets.view'),   ctrl.get);
router.post('/',      requirePermission('tickets.create'),
  validate(createProfecoComplaint),
  async (req, res, next) => {
    // Automatically stamp submitted_by from the authenticated user
    req.body.submitted_by = req.user.id;
    next();
  },
  ctrl.create,
);
router.put('/:id',    requirePermission('tickets.update'), validate(updateProfecoComplaint),  ctrl.update);
router.patch('/:id',  requirePermission('tickets.update'), validate(patchProfecoComplaint),   ctrl.partialUpdate);
router.delete('/:id', requirePermission('tickets.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('tickets.update'), ctrl.restore);

module.exports = router;
