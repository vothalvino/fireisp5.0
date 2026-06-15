// =============================================================================
// FireISP 5.0 — Factura Pública Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createFacturaPublica, updateFacturaPublica, addFacturaPublicaItem } = require('../middleware/schemas/facturasPublicas');
const db = require('../config/database');

const router = Router();

const ALLOWED_COLUMNS = [
  'cfdi_document_id', 'periodicidad', 'meses', 'anio',
  'subtotal', 'total_impuestos', 'total', 'status',
];

const ALLOWED_ITEM_COLUMNS = [
  'invoice_id',
];

router.use(authenticate);
router.use(orgScope);

// List facturas públicas
router.get('/', requirePermission('facturas_publicas.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT * FROM factura_publica_invoices WHERE organization_id = ? ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      [req.orgId],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM factura_publica_invoices WHERE organization_id = ?',
      [req.orgId],
    );
    const total = countResult[0].total;

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
});

// Get a single factura pública
router.get('/:id', requirePermission('facturas_publicas.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM factura_publica_invoices WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Factura pública not found' } });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Create a factura pública
router.post('/', requirePermission('facturas_publicas.create'), validate(createFacturaPublica), async (req, res, next) => {
  try {
    const safe = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => ALLOWED_COLUMNS.includes(k)),
    );
    safe.organization_id = req.orgId;
    const columns = Object.keys(safe);
    const placeholders = columns.map(() => '?').join(', ');
    const [result] = await db.query(
      `INSERT INTO factura_publica_invoices (${columns.join(', ')}) VALUES (${placeholders})`,
      Object.values(safe),
    );
    const [rows] = await db.query('SELECT * FROM factura_publica_invoices WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Update a factura pública
router.put('/:id', requirePermission('facturas_publicas.update'), validate(updateFacturaPublica), async (req, res, next) => {
  try {
    const safe = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => ALLOWED_COLUMNS.includes(k)),
    );
    const columns = Object.keys(safe).map((col) => `${col} = ?`).join(', ');
    await db.query(
      `UPDATE factura_publica_invoices SET ${columns} WHERE id = ? AND organization_id = ?`,
      [...Object.values(safe), req.params.id, req.orgId],
    );
    const [rows] = await db.query(
      'SELECT * FROM factura_publica_invoices WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Factura pública not found' } });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// List linked invoices for a factura pública
router.get('/:id/items', requirePermission('facturas_publicas.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT * FROM factura_publica_invoice_items WHERE factura_publica_invoice_id = ? ORDER BY id LIMIT ${limitNum} OFFSET ${offset}`,
      [req.params.id],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM factura_publica_invoice_items WHERE factura_publica_invoice_id = ?',
      [req.params.id],
    );
    const total = countResult[0].total;

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
});

// Link an invoice to a factura pública
router.post('/:id/items', requirePermission('facturas_publicas.update'), validate(addFacturaPublicaItem), async (req, res, next) => {
  try {
    const safe = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => ALLOWED_ITEM_COLUMNS.includes(k)),
    );
    safe.factura_publica_invoice_id = req.params.id;
    const columns = Object.keys(safe);
    const placeholders = columns.map(() => '?').join(', ');
    const [result] = await db.query(
      `INSERT INTO factura_publica_invoice_items (${columns.join(', ')}) VALUES (${placeholders})`,
      Object.values(safe),
    );
    const [rows] = await db.query('SELECT * FROM factura_publica_invoice_items WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
