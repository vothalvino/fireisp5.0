// =============================================================================
// FireISP 5.0 — Credit Note Routes
// =============================================================================

const { Router } = require('express');
const CreditNote = require('../models/CreditNote');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(CreditNote);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('credit_notes.view'), ctrl.list);
router.get('/:id', requirePermission('credit_notes.view'), ctrl.get);
router.post('/', requirePermission('credit_notes.create'), async (req, res, next) => {
  try {
    req.body.organization_id = req.orgId;
    const creditNote = await CreditNote.create(req.body);

    // Credit client balance ledger
    if (creditNote.client_id && creditNote.total) {
      await db.query(
        `INSERT INTO client_balance_ledger (client_id, organization_id, entry_type, amount, currency, reference_type, reference_id, description)
         VALUES (?, ?, 'credit', ?, ?, 'credit_note', ?, ?)`,
        [creditNote.client_id, req.orgId, creditNote.total, creditNote.currency || 'USD',
          creditNote.id, `Credit Note ${creditNote.credit_note_number || creditNote.id}`],
      );
    }

    res.status(201).json({ data: creditNote });
  } catch (err) {
    next(err);
  }
});
router.put('/:id', requirePermission('credit_notes.update'), ctrl.update);
router.delete('/:id', requirePermission('credit_notes.delete'), ctrl.destroy);

// Credit note line items
router.get('/:id/items', requirePermission('credit_notes.view'), async (req, res, next) => {
  try {
    const items = await CreditNote.getItems(req.params.id);
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items', requirePermission('credit_notes.update'), async (req, res, next) => {
  try {
    const item = await CreditNote.addItem({ credit_note_id: req.params.id, ...req.body });
    res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
