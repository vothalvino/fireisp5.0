// =============================================================================
// FireISP 5.0 — SNMP Trap Routes
// =============================================================================
// REST endpoints for browsing, acknowledging, and clearing SNMP trap records
// stored by the snmpTrapReceiver service.
//
//   GET  /api/v1/snmp-traps                  — paginated trap log
//   GET  /api/v1/snmp-traps/:id              — single trap detail
//   POST /api/v1/snmp-traps/:id/acknowledge  — mark acknowledged
//   POST /api/v1/snmp-traps/:id/clear        — delete (dismiss) a trap
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// GET /snmp-traps — list traps for the current organisation
// ---------------------------------------------------------------------------
router.get('/', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, device_id, trap_type, from, to } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 200);
    const offset   = (pageNum - 1) * limitNum;

    const filters = ['t.organization_id = ?'];
    const params  = [req.orgId];

    if (device_id) {
      filters.push('t.device_id = ?');
      params.push(device_id);
    }
    if (trap_type) {
      filters.push('t.trap_type = ?');
      params.push(trap_type);
    }
    if (from) {
      filters.push('t.received_at >= ?');
      params.push(from);
    }
    if (to) {
      filters.push('t.received_at <= ?');
      params.push(to);
    }

    const where = filters.join(' AND ');

    const [rows] = await db.query(
      `SELECT t.id, t.organization_id, t.device_id, d.name AS device_name,
              t.source_ip, t.trap_type, t.trap_oid, t.varbinds, t.community,
              t.snmp_version, t.is_acknowledged, t.acknowledged_by,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS acknowledged_by_name,
              t.acknowledged_at, t.received_at
       FROM snmp_traps t
       LEFT JOIN devices d ON d.id = t.device_id
       LEFT JOIN users   u ON u.id = t.acknowledged_by
       WHERE ${where}
       ORDER BY t.received_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );

    // Parse varbinds JSON for each row if stored as a string
    for (const row of rows) {
      if (typeof row.varbinds === 'string') {
        try { row.varbinds = JSON.parse(row.varbinds); } catch (_) { /* leave as-is */ }
      }
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM snmp_traps t WHERE ${where}`,
      params,
    );

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /snmp-traps/:id — single trap with full varbinds
// ---------------------------------------------------------------------------
router.get('/:id', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, d.name AS device_name,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS acknowledged_by_name
       FROM snmp_traps t
       LEFT JOIN devices d ON d.id = t.device_id
       LEFT JOIN users   u ON u.id = t.acknowledged_by
       WHERE t.id = ? AND t.organization_id = ?`,
      [req.params.id, req.orgId],
    );

    if (!rows.length) {
      return res.status(404).json({ error: { message: 'SNMP trap not found' } });
    }

    const trap = rows[0];
    // Parse varbinds JSON if stored as a string (MySQL may return a string)
    if (typeof trap.varbinds === 'string') {
      try { trap.varbinds = JSON.parse(trap.varbinds); } catch (_) { /* leave as-is */ }
    }

    res.json({ data: trap });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /snmp-traps/:id/acknowledge — mark a trap as acknowledged
// ---------------------------------------------------------------------------
router.post('/:id/acknowledge', requirePermission('devices.update'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      `UPDATE snmp_traps
       SET is_acknowledged = 1,
           acknowledged_by = ?,
           acknowledged_at = NOW()
       WHERE id = ? AND organization_id = ? AND is_acknowledged = 0`,
      [req.user.id, req.params.id, req.orgId],
    );

    if (result.affectedRows === 0) {
      // Either not found or already acknowledged — fetch current state
      const [rows] = await db.query(
        'SELECT id, is_acknowledged FROM snmp_traps WHERE id = ? AND organization_id = ?',
        [req.params.id, req.orgId],
      );
      if (!rows.length) {
        return res.status(404).json({ error: { message: 'SNMP trap not found' } });
      }
      return res.json({ data: { acknowledged: true } }); // already acknowledged
    }

    res.json({ data: { acknowledged: true } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /snmp-traps/:id/clear — permanently delete (dismiss) a trap record
// ---------------------------------------------------------------------------
router.post('/:id/clear', requirePermission('devices.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM snmp_traps WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: { message: 'SNMP trap not found' } });
    }

    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
