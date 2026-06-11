'use strict';

// =============================================================================
// FireISP 5.0 — IPv6 Transition Mechanism Routes (§5 Dual Stack)
// Covers: 6rd, DS-Lite, MAP-Rules, 464XLAT
// All sub-paths share transition_mechanisms.view/create/update/delete permissions.
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createTransitionMechanism,
  updateTransitionMechanism,
} = require('../middleware/schemas/transitionMechanisms');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Helper: inline CRUD for a single transition mechanism table
// ---------------------------------------------------------------------------

function listHandler(tableName) {
  return async (req, res, next) => {
    try {
      const { page = 1, limit = 25, status } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
      const offset = (pageNum - 1) * limitNum;

      let sql = `SELECT * FROM ${tableName} WHERE organization_id = ? AND deleted_at IS NULL`;
      const params = [req.orgId];
      if (status) { sql += ' AND status = ?'; params.push(status); }

      const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
      const [countRows] = await db.query(countSql, params);
      const total = countRows[0].total;

      sql += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
      const [rows] = await db.query(sql, params);
      res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
    } catch (err) { next(err); }
  };
}

function getOneHandler(tableName) {
  return async (req, res, next) => {
    try {
      const [rows] = await db.query(
        `SELECT * FROM ${tableName} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
        [req.params.id, req.orgId],
      );
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      res.json({ data: rows[0] });
    } catch (err) { next(err); }
  };
}

function createHandler(tableName) {
  return async (req, res, next) => {
    try {
      const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
      const [result] = await db.query(
        `INSERT INTO ${tableName} SET ?`,
        [{ organization_id: req.orgId, ...fields }],
      );
      const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [result.insertId]);
      res.status(201).json({ data: rows[0] });
    } catch (err) { next(err); }
  };
}

function updateHandler(tableName) {
  return async (req, res, next) => {
    try {
      const [check] = await db.query(
        `SELECT id FROM ${tableName} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
        [req.params.id, req.orgId],
      );
      if (!check.length) return res.status(404).json({ error: 'Not found' });
      const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
      await db.query(
        `UPDATE ${tableName} SET ?, updated_at = NOW() WHERE id = ? AND organization_id = ?`,
        [updateData, req.params.id, req.orgId],
      );
      const [rows] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [req.params.id]);
      res.json({ data: rows[0] });
    } catch (err) { next(err); }
  };
}

function deleteHandler(tableName) {
  return async (req, res, next) => {
    try {
      const [check] = await db.query(
        `SELECT id FROM ${tableName} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
        [req.params.id, req.orgId],
      );
      if (!check.length) return res.status(404).json({ error: 'Not found' });
      await db.query(
        `UPDATE ${tableName} SET deleted_at = NOW() WHERE id = ? AND organization_id = ?`,
        [req.params.id, req.orgId],
      );
      res.status(204).send();
    } catch (err) { next(err); }
  };
}

// ---------------------------------------------------------------------------
// 6rd  — tunnel_6rd_configs
// ---------------------------------------------------------------------------

router.get('/6rd', requirePermission('transition_mechanisms.view'), listHandler('tunnel_6rd_configs'));
router.get('/6rd/:id', requirePermission('transition_mechanisms.view'), getOneHandler('tunnel_6rd_configs'));
router.post('/6rd', requirePermission('transition_mechanisms.create'), validate(createTransitionMechanism), createHandler('tunnel_6rd_configs'));
router.put('/6rd/:id', requirePermission('transition_mechanisms.update'), validate(updateTransitionMechanism), updateHandler('tunnel_6rd_configs'));
router.delete('/6rd/:id', requirePermission('transition_mechanisms.delete'), deleteHandler('tunnel_6rd_configs'));

// ---------------------------------------------------------------------------
// DS-Lite  — ds_lite_configs
// ---------------------------------------------------------------------------

router.get('/ds-lite', requirePermission('transition_mechanisms.view'), listHandler('ds_lite_configs'));
router.get('/ds-lite/:id', requirePermission('transition_mechanisms.view'), getOneHandler('ds_lite_configs'));
router.post('/ds-lite', requirePermission('transition_mechanisms.create'), validate(createTransitionMechanism), createHandler('ds_lite_configs'));
router.put('/ds-lite/:id', requirePermission('transition_mechanisms.update'), validate(updateTransitionMechanism), updateHandler('ds_lite_configs'));
router.delete('/ds-lite/:id', requirePermission('transition_mechanisms.delete'), deleteHandler('ds_lite_configs'));

// ---------------------------------------------------------------------------
// MAP-Rules  — map_rules
// ---------------------------------------------------------------------------

router.get('/map-rules', requirePermission('transition_mechanisms.view'), listHandler('map_rules'));
router.get('/map-rules/:id', requirePermission('transition_mechanisms.view'), getOneHandler('map_rules'));
router.post('/map-rules', requirePermission('transition_mechanisms.create'), validate(createTransitionMechanism), createHandler('map_rules'));
router.put('/map-rules/:id', requirePermission('transition_mechanisms.update'), validate(updateTransitionMechanism), updateHandler('map_rules'));
router.delete('/map-rules/:id', requirePermission('transition_mechanisms.delete'), deleteHandler('map_rules'));

// ---------------------------------------------------------------------------
// 464XLAT  — xlat464_configs
// ---------------------------------------------------------------------------

router.get('/464xlat', requirePermission('transition_mechanisms.view'), listHandler('xlat464_configs'));
router.get('/464xlat/:id', requirePermission('transition_mechanisms.view'), getOneHandler('xlat464_configs'));
router.post('/464xlat', requirePermission('transition_mechanisms.create'), validate(createTransitionMechanism), createHandler('xlat464_configs'));
router.put('/464xlat/:id', requirePermission('transition_mechanisms.update'), validate(updateTransitionMechanism), updateHandler('xlat464_configs'));
router.delete('/464xlat/:id', requirePermission('transition_mechanisms.delete'), deleteHandler('xlat464_configs'));

module.exports = router;
