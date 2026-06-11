// =============================================================================
// FireISP 5.0 — Billing Dispute Routes
// =============================================================================

const fs = require('fs');
const { Router } = require('express');
const db = require('../config/database');
const BillingDispute = require('../models/BillingDispute');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { uploadSingle } = require('../middleware/upload');
const { NotFoundError, ValidationError } = require('../utils/errors');
const {
  createBillingDisputeSchema,
  updateBillingDisputeSchema,
  transitionBillingDisputeSchema,
} = require('../middleware/schemas/billingDisputes');

const router = Router();
const ctrl = crudController(BillingDispute);

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

// List disputes
router.get('/', requirePermission('billing_disputes.view'), ctrl.list);

// Get one dispute
router.get('/:id', requirePermission('billing_disputes.view'), ctrl.get);

// Create dispute
router.post('/', requirePermission('billing_disputes.create'), validate(createBillingDisputeSchema), async (req, res, next) => {
  try {
    const dispute = await BillingDispute.create({
      organization_id: req.orgId || null,
      client_id: req.body.client_id,
      invoice_id: req.body.invoice_id || null,
      payment_id: req.body.payment_id || null,
      type: req.body.type,
      description: req.body.description,
      status: 'open',
      opened_by: req.user.id,
    });
    res.status(201).json({ data: dispute });
  } catch (err) {
    next(err);
  }
});

// Update dispute fields
router.put('/:id', requirePermission('billing_disputes.update'), validate(updateBillingDisputeSchema), async (req, res, next) => {
  try {
    const updated = await BillingDispute.update(req.params.id, req.body, req.orgId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// Soft delete
router.delete('/:id', requirePermission('billing_disputes.update'), ctrl.destroy);

// ---------------------------------------------------------------------------
// Status transition
// ---------------------------------------------------------------------------

const RESOLVED_STATUSES = ['resolved_favor_client', 'resolved_favor_company'];

router.post('/:id/transition', requirePermission('billing_disputes.update'), validate(transitionBillingDisputeSchema), async (req, res, next) => {
  try {
    const dispute = await BillingDispute.findByIdOrFail(req.params.id, req.orgId);

    const updateData = {
      status: req.body.status,
      resolution_notes: req.body.resolution_notes || dispute.resolution_notes,
    };

    if (RESOLVED_STATUSES.includes(req.body.status)) {
      updateData.resolved_by = req.user.id;
      updateData.resolved_at = new Date();
    }

    const updated = await BillingDispute.update(req.params.id, updateData, req.orgId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Evidence management
// ---------------------------------------------------------------------------

// List evidence for a dispute
router.get('/:id/evidence', requirePermission('billing_disputes.view'), async (req, res, next) => {
  try {
    // Confirm dispute exists and belongs to org
    await BillingDispute.findByIdOrFail(req.params.id, req.orgId);

    const [rows] = await db.query(
      `SELECT * FROM dispute_evidence
       WHERE dispute_id = ?
         AND (organization_id = ? OR organization_id IS NULL)
       ORDER BY id ASC`,
      [req.params.id, req.orgId || null],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// Upload evidence file (multipart/form-data, field: "file")
router.post('/:id/evidence', requirePermission('billing_disputes.create'), (req, res, next) => {
  uploadSingle(req, res, async (uploadErr) => {
    if (uploadErr) return next(uploadErr);

    try {
      await BillingDispute.findByIdOrFail(req.params.id, req.orgId);

      if (!req.file) {
        throw new ValidationError('No file uploaded');
      }

      const [result] = await db.query(
        `INSERT INTO dispute_evidence
           (organization_id, dispute_id, filename, stored_path, mime_type, size_bytes, uploaded_by, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.orgId || null,
          req.params.id,
          req.file.originalname,
          req.file.path,
          req.file.mimetype,
          req.file.size,
          req.user.id,
          req.body.note || null,
        ],
      );

      const [rows] = await db.query(
        'SELECT * FROM dispute_evidence WHERE id = ?',
        [result.insertId],
      );

      res.status(201).json({ data: rows[0] });
    } catch (err) {
      next(err);
    }
  });
});

// Download evidence file
router.get('/:id/evidence/:evidenceId/download', requirePermission('billing_disputes.view'), async (req, res, next) => {
  try {
    await BillingDispute.findByIdOrFail(req.params.id, req.orgId);

    const [rows] = await db.query(
      `SELECT * FROM dispute_evidence
       WHERE id = ? AND dispute_id = ?
         AND (organization_id = ? OR organization_id IS NULL)
       LIMIT 1`,
      [req.params.evidenceId, req.params.id, req.orgId || null],
    );

    const evidence = rows[0];
    if (!evidence) throw new NotFoundError('dispute_evidence');

    if (!fs.existsSync(evidence.stored_path)) {
      throw new NotFoundError('evidence file');
    }

    res.download(evidence.stored_path, evidence.filename);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
