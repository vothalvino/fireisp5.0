// =============================================================================
// FireISP 5.0 — Bandwidth Test Routes (§10.4)
// =============================================================================
// Covers: bandwidth test server registry and subscriber speed test jobs.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createBandwidthTestServer, updateBandwidthTestServer } = require('../middleware/schemas/bandwidthTestServers');
const { createSpeedTestJob } = require('../middleware/schemas/subscriberSpeedTestJobs');
const db = require('../config/database');

const router = Router();

router.use(['/bandwidth-test-servers', '/subscriber-speed-test-jobs'], authenticate, orgScope);

// ---------------------------------------------------------------------------
// Bandwidth Test Servers
// ---------------------------------------------------------------------------

// GET /bandwidth-test-servers
router.get('/bandwidth-test-servers', requirePermission('bandwidth_test_servers.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM bandwidth_test_servers
       WHERE (organization_id = ? OR organization_id IS NULL)
         AND deleted_at IS NULL
       ORDER BY name ASC`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /bandwidth-test-servers/:id
router.get('/bandwidth-test-servers/:id', requirePermission('bandwidth_test_servers.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      `SELECT * FROM bandwidth_test_servers
       WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL`,
      [req.params.id, req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'Bandwidth test server not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// POST /bandwidth-test-servers
router.post('/bandwidth-test-servers', requirePermission('bandwidth_test_servers.create'), validate(createBandwidthTestServer), async (req, res, next) => {
  try {
    const { name, description, host, port = 5201, protocol = 'iperf3', region, site_id, is_active = true, auth_token, max_bandwidth_mbps } = req.body;
    const [result] = await db.query(
      `INSERT INTO bandwidth_test_servers
         (organization_id, name, description, host, port, protocol, region, site_id, is_active, auth_token, max_bandwidth_mbps)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, name, description || null, host, port, protocol, region || null, site_id || null,
        is_active ? 1 : 0, auth_token || null, max_bandwidth_mbps || null],
    );
    const [[row]] = await db.query('SELECT * FROM bandwidth_test_servers WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

// PUT /bandwidth-test-servers/:id
router.put('/bandwidth-test-servers/:id', requirePermission('bandwidth_test_servers.update'), validate(updateBandwidthTestServer), async (req, res, next) => {
  try {
    const allowed = ['name','description','host','port','protocol','region','site_id','is_active','auth_token','max_bandwidth_mbps'];
    const fields = [];
    const params = [];
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) { fields.push(`${k} = ?`); params.push(v); }
    }
    if (!fields.length) return res.status(400).json({ error: 'No updatable fields provided' });
    params.push(req.params.id, req.orgId);
    await db.query(
      `UPDATE bandwidth_test_servers SET ${fields.join(', ')}
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      params,
    );
    const [[row]] = await db.query('SELECT * FROM bandwidth_test_servers WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Bandwidth test server not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// DELETE /bandwidth-test-servers/:id
router.delete('/bandwidth-test-servers/:id', requirePermission('bandwidth_test_servers.delete'), async (req, res, next) => {
  try {
    await db.query(
      'UPDATE bandwidth_test_servers SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /bandwidth-test-servers/:id/restore
router.post('/bandwidth-test-servers/:id/restore', requirePermission('bandwidth_test_servers.update'), async (req, res, next) => {
  try {
    await db.query(
      'UPDATE bandwidth_test_servers SET deleted_at = NULL WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    const [[row]] = await db.query('SELECT * FROM bandwidth_test_servers WHERE id = ?', [req.params.id]);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Subscriber Speed Test Jobs
// ---------------------------------------------------------------------------

// GET /subscriber-speed-test-jobs
router.get('/subscriber-speed-test-jobs', requirePermission('subscriber_speed_tests.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
    const offset = (page - 1) * limit;
    let where = 'j.organization_id = ?';
    const params = [req.orgId];
    if (req.query.contract_id) { where += ' AND j.contract_id = ?'; params.push(req.query.contract_id); }
    if (req.query.status) { where += ' AND j.status = ?'; params.push(req.query.status); }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM subscriber_speed_test_jobs j WHERE ${where}`, params);
    const [rows] = await db.query(
      `SELECT j.*, s.name AS server_name
       FROM subscriber_speed_test_jobs j
       LEFT JOIN bandwidth_test_servers s ON j.test_server_id = s.id
       WHERE ${where}
       ORDER BY j.scheduled_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

// GET /subscriber-speed-test-jobs/:id
router.get('/subscriber-speed-test-jobs/:id', requirePermission('subscriber_speed_tests.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      `SELECT j.*, s.name AS server_name
       FROM subscriber_speed_test_jobs j
       LEFT JOIN bandwidth_test_servers s ON j.test_server_id = s.id
       WHERE j.id = ? AND j.organization_id = ?`,
      [req.params.id, req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'Speed test job not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// POST /subscriber-speed-test-jobs
router.post('/subscriber-speed-test-jobs', requirePermission('subscriber_speed_tests.create'), validate(createSpeedTestJob), async (req, res, next) => {
  try {
    const { contract_id, test_server_id, scheduled_at, notes } = req.body;
    const [result] = await db.query(
      `INSERT INTO subscriber_speed_test_jobs
         (organization_id, contract_id, test_server_id, requested_by, scheduled_at, notes)
       VALUES (?, ?, ?, 'admin', ?, ?)`,
      [req.orgId, contract_id, test_server_id || null, scheduled_at || new Date(), notes || null],
    );
    const [[row]] = await db.query('SELECT * FROM subscriber_speed_test_jobs WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

// POST /subscriber-speed-test-jobs/:id/cancel
router.post('/subscriber-speed-test-jobs/:id/cancel', requirePermission('subscriber_speed_tests.update'), async (req, res, next) => {
  try {
    await db.query(
      `UPDATE subscriber_speed_test_jobs SET status = 'cancelled'
       WHERE id = ? AND organization_id = ? AND status IN ('queued','running')`,
      [req.params.id, req.orgId],
    );
    const [[row]] = await db.query('SELECT * FROM subscriber_speed_test_jobs WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Speed test job not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
