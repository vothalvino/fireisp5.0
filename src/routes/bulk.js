// =============================================================================
// FireISP 5.0 — Bulk Operations Routes
// =============================================================================
// Endpoints for mass operations on clients, invoices, and contracts.
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const bulkSchemas = require('../middleware/schemas/bulk');
const logger = require('../utils/logger');
const eventBus = require('../services/eventBus');

const router = Router();

// All bulk routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// POST /bulk/invoices/generate — Mass-generate invoices
// ---------------------------------------------------------------------------
router.post('/invoices/generate', requirePermission('invoices.create'), validate(bulkSchemas.generateInvoices), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { contract_ids } = req.body;

    if (!Array.isArray(contract_ids) || contract_ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'contract_ids array is required' } });
    }

    if (contract_ids.length > 500) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Maximum 500 contracts per batch' } });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const contractId of contract_ids) {
      try {
        await db.query(
          `INSERT INTO billing_periods (contract_id, period_start, period_end, status, scheduled_at)
           SELECT ?, DATE_FORMAT(NOW(), '%Y-%m-01'), LAST_DAY(NOW()), 'pending', NOW()
           FROM dual WHERE NOT EXISTS (
             SELECT 1 FROM billing_periods WHERE contract_id = ? AND status = 'pending'
           )`,
          [contractId, contractId],
        );
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ contract_id: contractId, error: err.message });
      }
    }

    logger.info({ orgId, ...results }, 'Bulk invoice generation completed');
    eventBus.emit('bulk.invoices.generated', { organizationId: orgId, ...results });

    res.json({ data: results });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /bulk/suspend — Mass-suspend contracts
// ---------------------------------------------------------------------------
router.post('/suspend', requirePermission('contracts.update'), validate(bulkSchemas.suspend), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { contract_ids, reason } = req.body;

    if (!Array.isArray(contract_ids) || contract_ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'contract_ids array is required' } });
    }

    if (contract_ids.length > 500) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Maximum 500 contracts per batch' } });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const contractId of contract_ids) {
      try {
        const [rows] = await db.query(
          'UPDATE contracts SET status = ? WHERE id = ? AND organization_id = ? AND status = ?',
          ['suspended', contractId, orgId, 'active'],
        );
        if (rows.affectedRows > 0) {
          results.success++;
          eventBus.emit('contract.suspended', { organizationId: orgId, contractId, reason });
        } else {
          results.failed++;
          results.errors.push({ contract_id: contractId, error: 'Not found or already suspended' });
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ contract_id: contractId, error: err.message });
      }
    }

    logger.info({ orgId, ...results }, 'Bulk suspension completed');
    res.json({ data: results });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /bulk/email — Mass-send emails to clients
// ---------------------------------------------------------------------------
router.post('/email', requirePermission('clients.view'), validate(bulkSchemas.email), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { client_ids, subject, body } = req.body;

    if (!Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'client_ids array is required' } });
    }

    if (client_ids.length > 1000) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Maximum 1000 clients per batch' } });
    }

    // Fetch client emails
    const placeholders = client_ids.map(() => '?').join(',');
    const [clients] = await db.query(
      `SELECT id, email, first_name, last_name FROM clients WHERE id IN (${placeholders}) AND organization_id = ? AND deleted_at IS NULL`,
      [...client_ids, orgId],
    );

    const results = { queued: clients.length, not_found: client_ids.length - clients.length };

    // In a production system these would go to the job queue
    for (const client of clients) {
      eventBus.emit('bulk.email.queued', {
        organizationId: orgId,
        clientId: client.id,
        email: client.email,
        subject,
        body,
      });
    }

    logger.info({ orgId, ...results }, 'Bulk email queued');
    res.json({ data: results });
  } catch (err) { next(err); }
});

module.exports = router;
