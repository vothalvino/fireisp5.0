// =============================================================================
// FireISP 5.0 — Network Security Routes (§17)
// Covers: firewall_rules, ddos_protection_rules, blackhole_routes,
//         dns_blocklists, cpe_security_scans
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createFirewallRule,
  createDdosRule,
  createBlackholeRoute,
  createDnsBlocklist,
  triggerCpeScan,
} = require('../middleware/schemas/security');
const { ValidationError, NotFoundError } = require('../utils/errors');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Firewall Rules
// ---------------------------------------------------------------------------

// GET /firewall-rules
router.get('/firewall-rules', requirePermission('firewall_rules.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM firewall_rules WHERE organization_id = ? AND deleted_at IS NULL ORDER BY priority ASC, id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /firewall-rules
router.post('/firewall-rules', requirePermission('firewall_rules.create'), validate(createFirewallRule), async (req, res, next) => {
  try {
    const { name, description, action, protocol, src_ip, src_port, dst_ip, dst_port, priority, direction } = req.body;
    const [result] = await db.query(
      `INSERT INTO firewall_rules
        (organization_id, name, description, action, protocol, src_ip, src_port, dst_ip, dst_port, priority, direction, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        req.orgId,
        name || null,
        description || null,
        action,
        protocol,
        src_ip || null,
        src_port || null,
        dst_ip || null,
        dst_port || null,
        priority !== undefined ? priority : 100,
        direction || 'both',
      ],
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// PUT /firewall-rules/:id
router.put('/firewall-rules/:id', requirePermission('firewall_rules.update'), async (req, res, next) => {
  try {
    const { name, description, action, protocol, src_ip, src_port, dst_ip, dst_port, priority, is_active, direction } = req.body;
    const [result] = await db.query(
      `UPDATE firewall_rules SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         action = COALESCE(?, action),
         protocol = COALESCE(?, protocol),
         src_ip = ?,
         src_port = ?,
         dst_ip = ?,
         dst_port = ?,
         priority = COALESCE(?, priority),
         is_active = COALESCE(?, is_active),
         direction = COALESCE(?, direction),
         updated_at = NOW()
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [
        name || null, description || null, action || null, protocol || null,
        src_ip !== undefined ? src_ip : null,
        src_port !== undefined ? src_port : null,
        dst_ip !== undefined ? dst_ip : null,
        dst_port !== undefined ? dst_port : null,
        priority !== undefined ? priority : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        direction || null,
        req.params.id, req.orgId,
      ],
    );
    if (result.affectedRows === 0) throw new NotFoundError('Firewall rule');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /firewall-rules/:id
router.delete('/firewall-rules/:id', requirePermission('firewall_rules.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE firewall_rules SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('Firewall rule');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DDoS Protection Rules
// ---------------------------------------------------------------------------

// GET /ddos-protection
router.get('/ddos-protection', requirePermission('ddos_protection.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM ddos_protection_rules WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /ddos-protection
router.post('/ddos-protection', requirePermission('ddos_protection.create'), validate(createDdosRule), async (req, res, next) => {
  try {
    const { name, rule_type, target_prefix, action, threshold_pps, threshold_bps, notes } = req.body;
    const [result] = await db.query(
      `INSERT INTO ddos_protection_rules
        (organization_id, name, rule_type, target_prefix, action, threshold_pps, threshold_bps, is_active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [req.orgId, name || null, rule_type, target_prefix, action, threshold_pps || null, threshold_bps || null, notes || null],
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// PUT /ddos-protection/:id
router.put('/ddos-protection/:id', requirePermission('ddos_protection.update'), async (req, res, next) => {
  try {
    const { name, rule_type, target_prefix, action, threshold_pps, threshold_bps, is_active, notes } = req.body;
    const [result] = await db.query(
      `UPDATE ddos_protection_rules SET
         name = COALESCE(?, name),
         rule_type = COALESCE(?, rule_type),
         target_prefix = COALESCE(?, target_prefix),
         action = COALESCE(?, action),
         threshold_pps = COALESCE(?, threshold_pps),
         threshold_bps = COALESCE(?, threshold_bps),
         is_active = COALESCE(?, is_active),
         notes = COALESCE(?, notes),
         updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [
        name || null, rule_type || null, target_prefix || null, action || null,
        threshold_pps !== undefined ? threshold_pps : null,
        threshold_bps !== undefined ? threshold_bps : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        notes || null,
        req.params.id, req.orgId,
      ],
    );
    if (result.affectedRows === 0) throw new NotFoundError('DDoS protection rule');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /ddos-protection/:id
router.delete('/ddos-protection/:id', requirePermission('ddos_protection.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM ddos_protection_rules WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('DDoS protection rule');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /ddos-protection/:id/activate
router.post('/ddos-protection/:id/activate', requirePermission('ddos_protection.update'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE ddos_protection_rules SET is_active = 1, triggered_at = NOW(), updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('DDoS protection rule');
    res.json({ success: true, activated_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// POST /ddos-protection/:id/deactivate
router.post('/ddos-protection/:id/deactivate', requirePermission('ddos_protection.update'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE ddos_protection_rules SET is_active = 0, deactivated_at = NOW(), updated_at = NOW() WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('DDoS protection rule');
    res.json({ success: true, deactivated_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Blackhole Routes
// ---------------------------------------------------------------------------

// GET /blackhole-routes
router.get('/blackhole-routes', requirePermission('blackhole_routes.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM blackhole_routes WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /blackhole-routes — create/trigger
router.post('/blackhole-routes', requirePermission('blackhole_routes.create'), validate(createBlackholeRoute), async (req, res, next) => {
  try {
    const { target_prefix, reason, next_hop, notes } = req.body;
    const [result] = await db.query(
      `INSERT INTO blackhole_routes
        (organization_id, target_prefix, reason, next_hop, is_active, triggered_by, triggered_at, notes)
       VALUES (?, ?, ?, ?, 1, ?, NOW(), ?)`,
      [req.orgId, target_prefix, reason, next_hop || null, req.user.id, notes || null],
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// DELETE /blackhole-routes/:id
router.delete('/blackhole-routes/:id', requirePermission('blackhole_routes.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM blackhole_routes WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('Blackhole route');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /blackhole-routes/:id/release — release/deactivate
router.post('/blackhole-routes/:id/release', requirePermission('blackhole_routes.update'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE blackhole_routes SET is_active = 0, released_at = NOW(), updated_at = NOW() WHERE id = ? AND organization_id = ? AND is_active = 1',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('Blackhole route');
    res.json({ success: true, released_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DNS Blocklists
// ---------------------------------------------------------------------------

// GET /dns-blocklists
router.get('/dns-blocklists', requirePermission('dns_blocklists.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM dns_blocklists WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /dns-blocklists
router.post('/dns-blocklists', requirePermission('dns_blocklists.create'), validate(createDnsBlocklist), async (req, res, next) => {
  try {
    const { domain, category, reason, source } = req.body;
    const [result] = await db.query(
      `INSERT INTO dns_blocklists (organization_id, domain, category, reason, source, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [req.orgId, domain, category, reason || null, source || null],
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// PUT /dns-blocklists/:id
router.put('/dns-blocklists/:id', requirePermission('dns_blocklists.update'), async (req, res, next) => {
  try {
    const { domain, category, reason, source, is_active, expires_at } = req.body;
    const [result] = await db.query(
      `UPDATE dns_blocklists SET
         domain = COALESCE(?, domain),
         category = COALESCE(?, category),
         reason = COALESCE(?, reason),
         source = COALESCE(?, source),
         is_active = COALESCE(?, is_active),
         expires_at = ?,
         updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [
        domain || null, category || null, reason || null, source || null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        expires_at || null,
        req.params.id, req.orgId,
      ],
    );
    if (result.affectedRows === 0) throw new NotFoundError('DNS blocklist entry');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /dns-blocklists/:id
router.delete('/dns-blocklists/:id', requirePermission('dns_blocklists.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM dns_blocklists WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('DNS blocklist entry');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// CPE Security Scans
// ---------------------------------------------------------------------------

// GET /cpe-security-scans — list scans
router.get('/cpe-security-scans', requirePermission('cpe_security_scans.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM cpe_security_scans WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /cpe-security-scans — trigger scan (stub: set status=pending)
router.post('/cpe-security-scans', requirePermission('cpe_security_scans.create'), validate(triggerCpeScan), async (req, res, next) => {
  try {
    const { scan_type, device_id, cpe_device_id } = req.body;

    if (!device_id && !cpe_device_id) {
      throw new ValidationError('Either device_id or cpe_device_id must be provided');
    }

    const [result] = await db.query(
      `INSERT INTO cpe_security_scans
        (organization_id, device_id, cpe_device_id, scan_type, status, triggered_by, started_at)
       VALUES (?, ?, ?, ?, 'pending', ?, NOW())`,
      [req.orgId, device_id || null, cpe_device_id || null, scan_type, req.user.id],
    );

    // Stub: actual scan dispatch would be enqueued here (e.g., BullMQ job)
    // For now, just return the created record with pending status

    const [[row]] = await db.query(
      'SELECT * FROM cpe_security_scans WHERE id = ?',
      [result.insertId],
    );

    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

// GET /cpe-security-scans/:id — get scan details
router.get('/cpe-security-scans/:id', requirePermission('cpe_security_scans.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT * FROM cpe_security_scans WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!row) throw new NotFoundError('CPE security scan');
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
