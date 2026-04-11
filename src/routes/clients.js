// =============================================================================
// FireISP 5.0 — Client Routes
// =============================================================================

const { Router } = require('express');
const Client = require('../models/Client');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Client);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('clients.view'), ctrl.list);
router.get('/:id', requirePermission('clients.view'), ctrl.get);
router.post('/', requirePermission('clients.create'), ctrl.create);
router.put('/:id', requirePermission('clients.update'), ctrl.update);
router.delete('/:id', requirePermission('clients.delete'), ctrl.destroy);

// Contacts sub-routes
router.get('/:id/contacts', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const contacts = await Client.getContacts(req.params.id);
    res.json({ data: contacts });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/contacts', requirePermission('clients.update'), async (req, res, next) => {
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

router.put('/:id/mx-profile', requirePermission('clients.update'), async (req, res, next) => {
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

module.exports = router;
