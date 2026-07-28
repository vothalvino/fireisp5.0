// =============================================================================
// FireISP 5.0 — Suspension Workflow Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const suspensionSchemas = require('../middleware/schemas/suspension');
const suspensionController = require('../controllers/suspensionController');

const db = require('../config/database');

const router = Router();
router.use(authenticate);
router.use(orgScope);

/**
 * GET /suspension/logs — what the engine actually did, and to whom.
 *
 * The auto-suspension engine had no read surface at all: an operator could
 * enable a rule and then had no record of who it suspended or why. On the one
 * feature most likely to anger a paying customer if it misfires, that is the
 * gap that matters most.
 *
 * ORG-SCOPED THROUGH contracts. suspension_logs carries no organization_id of
 * its own, so the JOIN is the only thing scoping it — without one, any tenant
 * could read every other tenant's disconnection history. Same shape the
 * technician GPS history needed (#561).
 *
 * `<=>` rather than `=` on the org predicate: contracts.organization_id is
 * 'NULL = single-tenant deployment', and a plain `=` never matches NULL, which
 * would make this endpoint return nothing at all on a single-tenant install.
 *
 * performed_by_name is CONCAT(first_name, last_name): the users table has no
 * `name` column, and guessing one would have been a 500 on a page whose entire
 * job is auditing.
 */
router.get('/logs', requirePermission('contracts.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const conditions = ['c.organization_id <=> ?'];
    const params = [req.orgId];
    if (req.query.contract_id) { conditions.push('sl.contract_id = ?'); params.push(req.query.contract_id); }
    if (req.query.action) { conditions.push('sl.action = ?'); params.push(req.query.action); }
    // 'system' vs 'manual' is the question an operator actually asks after a
    // bad run: did the ENGINE do this, or did somebody?
    if (req.query.triggered_by) { conditions.push('sl.triggered_by = ?'); params.push(req.query.triggered_by); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const [rows] = await db.query(
      `SELECT sl.id, sl.contract_id, sl.client_id, sl.suspension_rule_id, sl.action,
              sl.reason, sl.triggered_by, sl.performed_by_user_id,
              sl.radius_coa_sent, sl.radius_coa_response, sl.related_invoice_id,
              sl.suspended_at, sl.restored_at,
              cl.name AS client_name, r.name AS rule_name,
              CONCAT(u.first_name, ' ', u.last_name) AS performed_by_name
         FROM suspension_logs sl
         JOIN contracts c ON c.id = sl.contract_id
         LEFT JOIN clients cl ON cl.id = sl.client_id
         LEFT JOIN users u ON u.id = sl.performed_by_user_id
         LEFT JOIN suspension_rules r ON r.id = sl.suspension_rule_id
        ${where}
        ORDER BY sl.suspended_at DESC, sl.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM suspension_logs sl
         JOIN contracts c ON c.id = sl.contract_id ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

router.post('/evaluate',
  requirePermission('contracts.view'),
  suspensionController.evaluate,
);

router.post('/suspend',
  requirePermission('contracts.update'),
  validate(suspensionSchemas.suspend),
  suspensionController.suspend,
);

router.post('/reconnect',
  requirePermission('contracts.update'),
  validate(suspensionSchemas.reconnect),
  suspensionController.reconnect,
);

router.post('/run-auto',
  requirePermission('contracts.update'),
  suspensionController.runAuto,
);

module.exports = router;
