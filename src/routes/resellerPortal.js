// =============================================================================
// FireISP 5.0 — Reseller Portal Routes (§19.3)
// =============================================================================
//
//  §19.3 Reseller Portal (admin-side endpoints; reseller_admin role consumes)
//  GET    /reseller-portal/:id/dashboard       aggregate stats for reseller
//  GET    /reseller-portal/:id/clients         list clients scoped to reseller
//  POST   /reseller-portal/:id/clients         create client under reseller
//  POST   /reseller-portal/:id/clients/:cId/suspend   suspend client
//  POST   /reseller-portal/:id/clients/:cId/cancel    cancel (set inactive) client
//  GET    /reseller-portal/:id/invoices        list invoices for reseller clients
//  GET    /reseller-portal/:id/inventory       list inventory scoped to reseller
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { NotFoundError, ValidationError } = require('../utils/errors');
const db = require('../config/database');
const resellerService = require('../services/resellerService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Helper — verify reseller belongs to current org
// ---------------------------------------------------------------------------
async function getResellerOrThrow(id, orgId) {
  const [[row]] = await db.query(
    'SELECT * FROM resellers WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [id, orgId],
  );
  if (!row) throw new NotFoundError('Reseller not found');
  return row;
}

// =============================================================================
// Dashboard (§19.3)
// =============================================================================

// GET /reseller-portal/:id/dashboard
router.get('/:id/dashboard', requirePermission('reseller_portal.dashboard'), async (req, res, next) => {
  try {
    await getResellerOrThrow(req.params.id, req.orgId);
    const dashboard = await resellerService.getResellerDashboard(
      parseInt(req.params.id, 10), req.orgId,
    );
    res.json({ data: dashboard });
  } catch (err) { next(err); }
});

// =============================================================================
// Customer Management (§19.3)
// =============================================================================

// GET /reseller-portal/:id/clients
router.get('/:id/clients', requirePermission('reseller_portal.manage_customers'), async (req, res, next) => {
  try {
    await getResellerOrThrow(req.params.id, req.orgId);
    const { page = 1, limit = 50, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const subtree = await resellerService.getResellerSubtree(
      [parseInt(req.params.id, 10)], req.orgId,
    );

    const conditions = ['organization_id = ? AND reseller_id IN (?) AND deleted_at IS NULL'];
    const params = [req.orgId, subtree];
    if (status) { conditions.push('status = ?'); params.push(status); }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT * FROM clients WHERE ${where} ORDER BY name ASC LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM clients WHERE ${where}`, params,
    );
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// POST /reseller-portal/:id/clients
router.post('/:id/clients', requirePermission('reseller_portal.manage_customers'), async (req, res, next) => {
  try {
    const reseller = await getResellerOrThrow(req.params.id, req.orgId);
    if (reseller.status !== 'active') {
      throw new ValidationError('Reseller is not active');
    }
    const { name, email, phone, client_type = 'personal', address, city, state, country, zip_code, notes } = req.body;
    if (!name) throw new ValidationError('name is required');

    const [result] = await db.query(
      `INSERT INTO clients
         (organization_id, reseller_id, name, email, phone, client_type, address, city, state, country, zip_code, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, req.params.id, name, email || null, phone || null,
        client_type, address || null, city || null, state || null,
        country || null, zip_code || null, notes || null],
    );
    const [[row]] = await db.query('SELECT * FROM clients WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// POST /reseller-portal/:id/clients/:cId/suspend
router.post('/:id/clients/:cId/suspend', requirePermission('reseller_portal.manage_customers'), async (req, res, next) => {
  try {
    await getResellerOrThrow(req.params.id, req.orgId);
    const [[client]] = await db.query(
      'SELECT id, status, reseller_id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.cId, req.orgId],
    );
    if (!client) throw new NotFoundError('Client not found');
    if (client.reseller_id !== parseInt(req.params.id, 10)) {
      throw new ValidationError('Client does not belong to this reseller');
    }
    const newStatus = client.status === 'suspended' ? 'active' : 'suspended';
    await db.query('UPDATE clients SET status = ? WHERE id = ?', [newStatus, req.params.cId]);
    res.json({ data: { id: parseInt(req.params.cId, 10), status: newStatus } });
  } catch (err) { next(err); }
});

// POST /reseller-portal/:id/clients/:cId/cancel
router.post('/:id/clients/:cId/cancel', requirePermission('reseller_portal.manage_customers'), async (req, res, next) => {
  try {
    await getResellerOrThrow(req.params.id, req.orgId);
    const [[client]] = await db.query(
      'SELECT id, reseller_id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.cId, req.orgId],
    );
    if (!client) throw new NotFoundError('Client not found');
    if (client.reseller_id !== parseInt(req.params.id, 10)) {
      throw new ValidationError('Client does not belong to this reseller');
    }
    await db.query('UPDATE clients SET status = ? WHERE id = ?', ['inactive', req.params.cId]);
    res.json({ data: { id: parseInt(req.params.cId, 10), status: 'inactive' } });
  } catch (err) { next(err); }
});

// =============================================================================
// Invoices (§19.3 — branded invoice list)
// =============================================================================

// GET /reseller-portal/:id/invoices
router.get('/:id/invoices', requirePermission('reseller_portal.invoices'), async (req, res, next) => {
  try {
    await getResellerOrThrow(req.params.id, req.orgId);
    const { page = 1, limit = 50, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const subtree = await resellerService.getResellerSubtree(
      [parseInt(req.params.id, 10)], req.orgId,
    );
    const clientIds = await resellerService.getResellerClientIds(subtree, req.orgId);

    if (clientIds.length === 0) {
      return res.json({ data: [], meta: { total: 0, page: pageNum, limit: limitNum } });
    }

    const conditions = ['i.client_id IN (?)'];
    const params = [clientIds];
    if (status) { conditions.push('i.status = ?'); params.push(status); }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT i.*, c.name AS client_name
       FROM invoices i
       LEFT JOIN clients c ON i.client_id = c.id
       WHERE ${where} ORDER BY i.issue_date DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM invoices i WHERE ${where}`, params,
    );
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// =============================================================================
// Inventory (§19.3 — reseller-assigned equipment from §14 inventory)
// =============================================================================

// GET /reseller-portal/:id/inventory
router.get('/:id/inventory', requirePermission('reseller_portal.inventory'), async (req, res, next) => {
  try {
    await getResellerOrThrow(req.params.id, req.orgId);
    // Reuse §14 inventory: assets assigned to clients that belong to this reseller
    const subtree = await resellerService.getResellerSubtree(
      [parseInt(req.params.id, 10)], req.orgId,
    );
    const clientIds = await resellerService.getResellerClientIds(subtree, req.orgId);
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    if (clientIds.length === 0) {
      return res.json({ data: [], meta: { total: 0, page: pageNum, limit: limitNum } });
    }

    const [rows] = await db.query(
      `SELECT aa.*, a.name AS asset_name, a.serial_number, a.model, a.manufacturer,
              c.name AS client_name
       FROM asset_assignments aa
       JOIN assets a ON aa.asset_id = a.id
       LEFT JOIN clients c ON aa.client_id = c.id
       WHERE aa.client_id IN (?) AND aa.returned_at IS NULL
       ORDER BY aa.assigned_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      [clientIds],
    );
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM asset_assignments aa WHERE aa.client_id IN (?) AND aa.returned_at IS NULL',
      [clientIds],
    );
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

module.exports = router;
