// =============================================================================
// FireISP 5.0 — Late Fee Rules Routes
// =============================================================================
// GET    /late-fee-rules           — list rules
// POST   /late-fee-rules           — create rule
// GET    /late-fee-rules/:id       — get rule
// PUT    /late-fee-rules/:id       — update rule
// DELETE /late-fee-rules/:id       — delete rule
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { AppError } = require('../utils/errors');
const lateFeeService = require('../services/lateFeeService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/',
  requirePermission('late_fees.view'),
  async (req, res, next) => {
    try {
      const rules = await lateFeeService.getLateFeeRules(req.orgId);
      res.json({ data: rules });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/',
  requirePermission('late_fees.manage'),
  async (req, res, next) => {
    try {
      const rule = await lateFeeService.createLateFeeRule(req.orgId, req.body);
      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  },
);

router.get('/:id',
  requirePermission('late_fees.view'),
  async (req, res, next) => {
    try {
      const rule = await lateFeeService.getLateFeeRuleById(req.orgId, req.params.id);
      if (!rule) return next(new AppError('Late fee rule not found', 404));
      res.json(rule);
    } catch (err) {
      next(err);
    }
  },
);

router.put('/:id',
  requirePermission('late_fees.manage'),
  async (req, res, next) => {
    try {
      const rule = await lateFeeService.updateLateFeeRule(req.orgId, req.params.id, req.body);
      if (!rule) return next(new AppError('Late fee rule not found', 404));
      res.json(rule);
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:id',
  requirePermission('late_fees.manage'),
  async (req, res, next) => {
    try {
      const deleted = await lateFeeService.deleteLateFeeRule(req.orgId, req.params.id);
      if (!deleted) return next(new AppError('Late fee rule not found', 404));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
