// =============================================================================
// FireISP 5.0 — Numbering Management Routes (§16.4)
// Covers: phone_number_inventory, number_portability_records, numbering_blocks
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// =============================================================================
// Phone Numbers — /phone-numbers
// =============================================================================

router.get('/phone-numbers', requirePermission('phone_number_inventory.view'), async (req, res, next) => {
  try {
    const { status, number_type, client_id, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (number_type) { conditions.push('number_type = ?'); params.push(number_type); }
    if (client_id) { conditions.push('client_id = ?'); params.push(client_id); }

    const where = conditions.join(' AND ');
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows] = await db.query(
      `SELECT * FROM phone_number_inventory WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset],
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM phone_number_inventory WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/phone-numbers', requirePermission('phone_number_inventory.manage'), async (req, res, next) => {
  try {
    const { phone_number, number_type, lada, status, client_id, contract_id, block_id, notes } = req.body;

    const [result] = await db.query(
      `INSERT INTO phone_number_inventory (organization_id, phone_number, number_type, lada, status, client_id, contract_id, block_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, phone_number, number_type || null, lada || null, status || 'available', client_id || null, contract_id || null, block_id || null, notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.get('/phone-numbers/:id', requirePermission('phone_number_inventory.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM phone_number_inventory WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/phone-numbers/:id', requirePermission('phone_number_inventory.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { phone_number, number_type, lada, status, client_id, contract_id, block_id, notes } = req.body;

    await db.query(
      `UPDATE phone_number_inventory SET phone_number = ?, number_type = ?, lada = ?, status = ?, client_id = ?, contract_id = ?, block_id = ?, notes = ?, updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [phone_number, number_type || null, lada || null, status || 'available', client_id || null, contract_id || null, block_id || null, notes || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/phone-numbers/:id', requirePermission('phone_number_inventory.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE phone_number_inventory SET status = \'blocked\', updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Number Portability — /portability
// =============================================================================

router.get('/portability', requirePermission('number_portability.view'), async (req, res, next) => {
  try {
    const { port_type, status, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (port_type) { conditions.push('port_type = ?'); params.push(port_type); }
    if (status) { conditions.push('status = ?'); params.push(status); }

    const where = conditions.join(' AND ');
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows] = await db.query(
      `SELECT * FROM number_portability_records WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset],
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM number_portability_records WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/portability', requirePermission('number_portability.manage'), async (req, res, next) => {
  try {
    const { phone_number, port_type, donor_carrier, recipient_carrier, ifetel_reference, client_id, notes } = req.body;

    const [result] = await db.query(
      `INSERT INTO number_portability_records (organization_id, phone_number, port_type, donor_carrier, recipient_carrier, ifetel_reference, client_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, phone_number, port_type, donor_carrier || null, recipient_carrier || null, ifetel_reference || null, client_id || null, notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.get('/portability/:id', requirePermission('number_portability.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM number_portability_records WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/portability/:id', requirePermission('number_portability.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    await db.query(
      'UPDATE number_portability_records SET status = ?, notes = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [status, notes || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/portability/:id/complete', requirePermission('number_portability.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE number_portability_records SET status = \'completed\', ported_at = NOW(), updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Numbering Blocks — /numbering-blocks
// =============================================================================

router.get('/numbering-blocks', requirePermission('numbering_blocks.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows] = await db.query(
      'SELECT * FROM numbering_blocks WHERE organization_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.orgId, parseInt(limit, 10), offset],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM numbering_blocks WHERE organization_id = ?',
      [req.orgId],
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/numbering-blocks', requirePermission('numbering_blocks.manage'), async (req, res, next) => {
  try {
    const { block_start, block_end, lada, cnmc_reference, status, notes } = req.body;

    const [result] = await db.query(
      `INSERT INTO numbering_blocks (organization_id, block_start, block_end, lada, cnmc_reference, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, block_start, block_end, lada || null, cnmc_reference || null, status || 'active', notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.get('/numbering-blocks/:id', requirePermission('numbering_blocks.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM numbering_blocks WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/numbering-blocks/:id', requirePermission('numbering_blocks.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { block_start, block_end, lada, cnmc_reference, status, notes } = req.body;

    await db.query(
      `UPDATE numbering_blocks SET block_start = ?, block_end = ?, lada = ?, cnmc_reference = ?, status = ?, notes = ?, updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [block_start, block_end, lada || null, cnmc_reference || null, status || 'active', notes || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
