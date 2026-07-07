// =============================================================================
// FireISP 5.0 — SAT Catalog Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();

router.use(authenticate);
router.use(orgScope);

router.get('/regimen-fiscal', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM sat_regimen_fiscal');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/uso-cfdi', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM sat_uso_cfdi');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/forma-pago', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM sat_forma_pago');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/metodo-pago', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM sat_metodo_pago');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/tipo-comprobante', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM sat_tipo_comprobante');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/moneda', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM sat_moneda');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/clave-prod-serv', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM sat_clave_prod_serv';
    const params = [];
    if (search) {
      sql += ' WHERE description LIKE ? OR code LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/clave-unidad', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM sat_clave_unidad';
    const params = [];
    if (search) {
      sql += ' WHERE description LIKE ? OR code LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
