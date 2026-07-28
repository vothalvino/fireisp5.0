// =============================================================================
// FireISP 5.0 — Tax Rule Routes
// =============================================================================

const { Router } = require('express');
const TaxRule = require('../models/TaxRule');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createTaxRule, updateTaxRule } = require('../middleware/schemas/taxRules');
const Organization = require('../models/Organization');
const { AppError } = require('../utils/errors');

const router = Router();

/**
 * A Mexican postal code (código postal) is ALWAYS exactly five digits. So in an
 * MX-locale org, anything else in postal_codes is a data-entry error — and a
 * silent one: `0801` or `K1A*` would save happily, match no client ever, and
 * leave the operator wondering why their border rule never applies. Rules that
 * never fire are how a 16% invoice quietly goes out to an 8% subscriber.
 *
 * Enforced per-org rather than in the validation schema because validate() is
 * static and cannot see which organization is calling. Only MX is constrained:
 * a Panama org keeps 4-digit codes, Canada keeps K1A*, and a US org keeps its
 * own 5-digit ZIPs — the shared format check in schemas/taxRules.js still
 * applies to everyone.
 */
async function assertPostalShapeForLocale(req) {
  const spec = req.body?.postal_codes;
  if (spec === undefined || spec === null || String(spec).trim() === '') return;
  if ((await Organization.getLocale(req.orgId)) !== 'MX') return;

  const bad = [];
  for (const partRaw of String(spec).split(',')) {
    const part = partRaw.trim().replace(/\s+/g, '');
    if (!part) continue;
    // Both a bare code and each end of a range must be exactly five digits.
    const ok = /^\d{5}$/.test(part) || /^\d{5}-\d{5}$/.test(part);
    if (!ok) bad.push(part);
  }
  if (bad.length) {
    throw new AppError(
      `A Mexican código postal is exactly 5 digits. Not valid here: ${bad.join(', ')}. `
      + 'Use 5-digit codes or 5-digit ranges, e.g. "21000-22999,88000".',
      422, 'POSTAL_CODE_FORMAT_MX',
    );
  }
}

const ctrl = crudController(TaxRule, {
  beforeCreate: assertPostalShapeForLocale,
  beforeUpdate: (_old, req) => assertPostalShapeForLocale(req),
});

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('tax_rules.view'), ctrl.list);
router.get('/:id', requirePermission('tax_rules.view'), ctrl.get);
router.post('/', requirePermission('tax_rules.create'), validate(createTaxRule), ctrl.create);
router.put('/:id', requirePermission('tax_rules.update'), validate(updateTaxRule), ctrl.update);
router.delete('/:id', requirePermission('tax_rules.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('tax_rules.update'), ctrl.restore);

module.exports = router;
