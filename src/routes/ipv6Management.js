'use strict';

// =============================================================================
// FireISP 5.0 — IPv6 Management Routes (§5 Dual Stack)
// RA Guard policies + subnet planner + pool conflict detection
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { buildInsert, buildUpdate } = require('../utils/sqlBuild');
const subnetPlannerService = require('../services/subnetPlannerService');
const { createRaGuardPolicy, updateRaGuardPolicy } = require('../middleware/schemas/raGuardPolicies');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// RA Guard Policies CRUD  /ra-guard
// ---------------------------------------------------------------------------

router.get('/ra-guard', requirePermission('ra_guard.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM ra_guard_policies WHERE organization_id = ? AND deleted_at IS NULL';
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

router.get('/ra-guard/:id', requirePermission('ra_guard.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM ra_guard_policies WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/ra-guard', requirePermission('ra_guard.create'), validate(createRaGuardPolicy), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const { columns, placeholders, values } = buildInsert({ organization_id: req.orgId, ...fields });
    const [result] = await db.query(
      `INSERT INTO ra_guard_policies (${columns}) VALUES (${placeholders})`,
      values,
    );
    const [rows] = await db.query('SELECT * FROM ra_guard_policies WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/ra-guard/:id', requirePermission('ra_guard.update'), validate(updateRaGuardPolicy), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM ra_guard_policies WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    const { assignments, values } = buildUpdate(updateData);
    const setClause = assignments ? `${assignments}, updated_at = NOW()` : 'updated_at = NOW()';
    await db.query(
      `UPDATE ra_guard_policies SET ${setClause} WHERE id = ? AND organization_id = ?`,
      [...values, req.params.id, req.orgId],
    );
    const [rows] = await db.query('SELECT * FROM ra_guard_policies WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/ra-guard/:id', requirePermission('ra_guard.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM ra_guard_policies WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query(
      'UPDATE ra_guard_policies SET deleted_at = NOW() WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Subnet Planner  /subnet-plan
// ---------------------------------------------------------------------------

router.get('/subnet-plan', requirePermission('ipv6.management'), async (req, res, next) => {
  try {
    const { network, prefix_len, sub_prefix_len } = req.query;

    if (!network) {
      return res.status(422).json({ error: 'network is required' });
    }

    // prefix_len is optional: when omitted, derive it from the network CIDR
    // (e.g. "2001:db8::/32" -> 32). The /subnet-plan form supplies it as a
    // separate field, but a bare CIDR already encodes the parent prefix.
    let prefixLen = parseInt(prefix_len, 10);
    if (isNaN(prefixLen) && typeof network === 'string' && network.includes('/')) {
      prefixLen = parseInt(network.split('/')[1], 10);
    }
    if (isNaN(prefixLen)) {
      return res.status(422).json({ error: 'prefix_len is required when network has no CIDR suffix' });
    }

    // sub_prefix_len is optional: default to one nibble (16 bits) deeper than
    // the parent prefix, capped at 128, so a minimal request still returns a
    // sensible plan instead of a 422.
    let subPrefixLen = parseInt(sub_prefix_len, 10);
    if (isNaN(subPrefixLen)) {
      subPrefixLen = Math.min(prefixLen + 16, 128);
    }

    const subnets = subnetPlannerService.planSubnets(network, prefixLen, subPrefixLen);
    res.json({ data: subnets });
  } catch (err) {
    if (err.message && (err.message.includes('Too many') || err.message.includes('must be >='))) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Pool Conflict Detection  /pool-conflicts
// ---------------------------------------------------------------------------

router.get('/pool-conflicts', requirePermission('ipv6.management'), async (req, res, next) => {
  try {
    const conflicts = await subnetPlannerService.detectConflicts(req.orgId);
    res.json({ data: conflicts });
  } catch (err) { next(err); }
});

module.exports = router;
