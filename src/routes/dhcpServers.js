'use strict';

// =============================================================================
// FireISP 5.0 — DHCP Servers + Static Reservations Routes (§5 Dual Stack)
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createDhcpServer,
  updateDhcpServer,
  createDhcpReservation,
  updateDhcpReservation,
} = require('../middleware/schemas/dhcpServers');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// DHCP Servers CRUD
// ---------------------------------------------------------------------------

router.get('/', requirePermission('dhcp_servers.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM dhcp_servers WHERE organization_id = ? AND deleted_at IS NULL';
    const params = [req.orgId];
    if (status) { sql += ' AND status = ?'; params.push(status); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('dhcp_servers.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM dhcp_servers WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('dhcp_servers.create'), validate(createDhcpServer), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const [result] = await db.query(
      'INSERT INTO dhcp_servers SET ?',
      [{ organization_id: req.orgId, ...fields }],
    );
    const [rows] = await db.query('SELECT * FROM dhcp_servers WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('dhcp_servers.update'), validate(updateDhcpServer), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM dhcp_servers WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    await db.query(
      'UPDATE dhcp_servers SET ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [updateData, req.params.id, req.orgId],
    );
    const [rows] = await db.query('SELECT * FROM dhcp_servers WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('dhcp_servers.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM dhcp_servers WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query(
      'UPDATE dhcp_servers SET deleted_at = NOW() WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Static Reservations sub-resource  /:id/reservations
// ---------------------------------------------------------------------------

router.get('/:id/reservations', requirePermission('dhcp_reservations.view'), async (req, res, next) => {
  try {
    // Verify parent server belongs to org first
    const [serverRows] = await db.query(
      'SELECT id FROM dhcp_servers WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!serverRows.length) return res.status(404).json({ error: 'DHCP server not found' });

    const { page = 1, limit = 25 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    const countSql = 'SELECT COUNT(*) AS total FROM dhcp_static_reservations WHERE dhcp_server_id = ? AND organization_id = ? AND deleted_at IS NULL';
    const [countRows] = await db.query(countSql, [req.params.id, req.orgId]);
    const total = countRows[0].total;

    const [rows] = await db.query(
      `SELECT * FROM dhcp_static_reservations WHERE dhcp_server_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      [req.params.id, req.orgId],
    );
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

router.post('/:id/reservations', requirePermission('dhcp_reservations.create'), validate(createDhcpReservation), async (req, res, next) => {
  try {
    // Verify parent server belongs to org
    const [serverRows] = await db.query(
      'SELECT id FROM dhcp_servers WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!serverRows.length) return res.status(404).json({ error: 'DHCP server not found' });

    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const [result] = await db.query(
      'INSERT INTO dhcp_static_reservations SET ?',
      [{ organization_id: req.orgId, dhcp_server_id: req.params.id, ...fields }],
    );
    const [rows] = await db.query('SELECT * FROM dhcp_static_reservations WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Reservations direct  /reservations/:rid
// ---------------------------------------------------------------------------

router.put('/reservations/:rid', requirePermission('dhcp_reservations.update'), validate(updateDhcpReservation), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM dhcp_static_reservations WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.rid, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    await db.query(
      'UPDATE dhcp_static_reservations SET ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [updateData, req.params.rid, req.orgId],
    );
    const [rows] = await db.query('SELECT * FROM dhcp_static_reservations WHERE id = ?', [req.params.rid]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/reservations/:rid', requirePermission('dhcp_reservations.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM dhcp_static_reservations WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.rid, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query(
      'UPDATE dhcp_static_reservations SET deleted_at = NOW() WHERE id = ? AND organization_id = ?',
      [req.params.rid, req.orgId],
    );
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
