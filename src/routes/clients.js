// =============================================================================
// FireISP 5.0 — Client Routes
// =============================================================================

const { Router } = require('express');
const Client = require('../models/Client');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createClient, updateClient, patchClient, createContact, updateMxProfile } = require('../middleware/schemas/clients');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Client);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('clients.view'), ctrl.list);
router.get('/:id', requirePermission('clients.view'), ctrl.get);
router.post('/', requirePermission('clients.create'), validate(createClient), ctrl.create);
router.put('/:id', requirePermission('clients.update'), validate(updateClient), ctrl.update);
router.patch('/:id', requirePermission('clients.update'), validate(patchClient), ctrl.partialUpdate);
router.delete('/:id', requirePermission('clients.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('clients.update'), ctrl.restore);

// Contacts sub-routes
router.get('/:id/contacts', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const contacts = await Client.getContacts(req.params.id);
    res.json({ data: contacts });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/contacts', requirePermission('clients.update'), validate(createContact), async (req, res, next) => {
  try {
    const { name, email, phone, role } = req.body;
    const [result] = await db.query(
      'INSERT INTO contacts (client_id, name, email, phone, role) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, name, email, phone, role],
    );
    const [rows] = await db.query('SELECT * FROM contacts WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// MX Profile sub-routes
router.get('/:id/mx-profile', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const profile = await Client.getMxProfile(req.params.id);
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/mx-profile', requirePermission('clients.update'), validate(updateMxProfile), async (req, res, next) => {
  try {
    const { rfc, curp, razon_social, regimen_fiscal, codigo_postal_fiscal } = req.body;
    const existing = await Client.getMxProfile(req.params.id);

    if (existing) {
      await db.query(
        `UPDATE client_mx_profiles SET rfc = ?, curp = ?, razon_social = ?,
         regimen_fiscal = ?, codigo_postal_fiscal = ? WHERE client_id = ?`,
        [rfc, curp, razon_social, regimen_fiscal, codigo_postal_fiscal, req.params.id],
      );
    } else {
      await db.query(
        `INSERT INTO client_mx_profiles (client_id, rfc, curp, razon_social, regimen_fiscal, codigo_postal_fiscal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.params.id, rfc, curp, razon_social, regimen_fiscal, codigo_postal_fiscal],
      );
    }

    const profile = await Client.getMxProfile(req.params.id);
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
});

// Client contracts
router.get('/:id/contracts', requirePermission('contracts.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM contracts WHERE client_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Client invoices
router.get('/:id/invoices', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM invoices WHERE client_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Client balance ledger
router.get('/:id/balance-ledger', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM client_balance_ledger WHERE client_id = ? AND organization_id = ? ORDER BY created_at DESC',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Set / reset portal password for a client (admin action)
router.put('/:id/portal-password', requirePermission('clients.update'), async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'password must be at least 8 characters' } });
    }
    const portalAuthService = require('../services/portalAuthService');
    // Verify this client belongs to this org
    const [rows] = await db.query(
      'SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });

    await portalAuthService.setPassword(req.params.id, password);
    res.json({ message: 'Portal password updated' });
  } catch (err) { next(err); }
});

module.exports = router;
