'use strict';

// =============================================================================
// FireISP 5.0 — NAT Pool Management Routes (§5 Dual Stack)
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { buildInsert, buildUpdate } = require('../utils/sqlBuild');
const { createNatPool, updateNatPool } = require('../middleware/schemas/natPools');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('nat_pools.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM nat_pools WHERE organization_id = ? AND deleted_at IS NULL';
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

router.get('/:id', requirePermission('nat_pools.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM nat_pools WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('nat_pools.create'), validate(createNatPool), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const { columns, placeholders, values } = buildInsert({ organization_id: req.orgId, ...fields });
    const [result] = await db.query(
      `INSERT INTO nat_pools (${columns}) VALUES (${placeholders})`,
      values,
    );
    const [rows] = await db.query('SELECT * FROM nat_pools WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('nat_pools.update'), validate(updateNatPool), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM nat_pools WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    const { assignments, values } = buildUpdate(updateData);
    const setClause = assignments ? `${assignments}, updated_at = NOW()` : 'updated_at = NOW()';
    await db.query(
      `UPDATE nat_pools SET ${setClause} WHERE id = ? AND organization_id = ?`,
      [...values, req.params.id, req.orgId],
    );
    const [rows] = await db.query('SELECT * FROM nat_pools WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('nat_pools.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM nat_pools WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query(
      'UPDATE nat_pools SET deleted_at = NOW() WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
