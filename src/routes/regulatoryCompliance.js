// =============================================================================
// FireISP 5.0 — Regulatory Compliance Routes (§16)
// Covers: subscriber_consents, dsar_requests, identity_verification_records,
//         gov_data_requests
// =============================================================================

const { Router } = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// CURP validation helper
// ---------------------------------------------------------------------------

function validateCurp(curp) {
  if (!curp || curp.length !== 18) return false;
  const pattern = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9][0-9]$/;
  if (!pattern.test(curp)) return false;
  // checksum: chars 0-16 weighted, digit 17 is check
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += chars.indexOf(curp[i]) * (18 - i);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(curp[17], 10);
}

// =============================================================================
// Subscriber Consents — /consent
// =============================================================================

router.get('/consent', requirePermission('subscriber_consents.view'), async (req, res, next) => {
  try {
    const { client_id, purpose, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (client_id) { conditions.push('client_id = ?'); params.push(client_id); }
    if (purpose) { conditions.push('purpose = ?'); params.push(purpose); }

    const where = conditions.join(' AND ');
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (parseInt(page, 10) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM subscriber_consents WHERE ${where} ORDER BY given_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM subscriber_consents WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/consent', requirePermission('subscriber_consents.create'), async (req, res, next) => {
  try {
    const { client_id, consent_version, purpose, channel, document_hash, notes } = req.body;

    const [result] = await db.query(
      `INSERT INTO subscriber_consents (organization_id, client_id, consent_version, purpose, channel, document_hash, notes, given_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [req.orgId, client_id, consent_version, purpose, channel, document_hash || null, notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.put('/consent/:id/withdraw', requirePermission('subscriber_consents.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE subscriber_consents SET withdrawn_at = NOW() WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/consent/client/:clientId', requirePermission('subscriber_consents.view'), async (req, res, next) => {
  try {
    const { clientId } = req.params;

    const [rows] = await db.query(
      'SELECT * FROM subscriber_consents WHERE client_id = ? AND organization_id = ? ORDER BY given_at DESC',
      [clientId, req.orgId],
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// DSAR Requests — /dsar-requests
// =============================================================================

router.get('/dsar-requests', requirePermission('dsar_requests.view'), async (req, res, next) => {
  try {
    const { status, request_type, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (request_type) { conditions.push('request_type = ?'); params.push(request_type); }

    const where = conditions.join(' AND ');
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (parseInt(page, 10) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM dsar_requests WHERE ${where} ORDER BY requested_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM dsar_requests WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/dsar-requests', requirePermission('dsar_requests.create'), async (req, res, next) => {
  try {
    const { client_id, request_type, notes } = req.body;

    const [result] = await db.query(
      `INSERT INTO dsar_requests (organization_id, client_id, request_type, notes, due_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [req.orgId, client_id, request_type, notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.get('/dsar-requests/:id', requirePermission('dsar_requests.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM dsar_requests WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/dsar-requests/:id/fulfill', requirePermission('dsar_requests.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    await db.query(
      'UPDATE dsar_requests SET status = \'fulfilled\', fulfilled_at = NOW(), fulfilled_by = ?, notes = ? WHERE id = ? AND organization_id = ?',
      [req.user.id, notes || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/dsar-requests/:id/reject', requirePermission('dsar_requests.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    await db.query(
      'UPDATE dsar_requests SET status = \'rejected\', notes = ? WHERE id = ? AND organization_id = ?',
      [notes || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/dsar-requests/:id/legal-hold', requirePermission('dsar_requests.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { legal_hold_reason } = req.body;

    await db.query(
      'UPDATE dsar_requests SET status = \'legal_hold\', legal_hold = 1, legal_hold_reason = ? WHERE id = ? AND organization_id = ?',
      [legal_hold_reason || null, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Identity Verification — /identity-verification
// =============================================================================

router.get('/identity-verification', requirePermission('identity_verification.view'), async (req, res, next) => {
  try {
    const { client_id, status, id_type, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (client_id) { conditions.push('client_id = ?'); params.push(client_id); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (id_type) { conditions.push('id_type = ?'); params.push(id_type); }

    const where = conditions.join(' AND ');
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (parseInt(page, 10) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM identity_verification_records WHERE ${where} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM identity_verification_records WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/identity-verification', requirePermission('identity_verification.create'), async (req, res, next) => {
  try {
    const { client_id, id_type, id_number, verification_method, notes } = req.body;

    if (id_type === 'CURP' && !validateCurp(id_number)) {
      return res.status(422).json({ error: 'CURP_INVALID' });
    }

    const [result] = await db.query(
      `INSERT INTO identity_verification_records (organization_id, client_id, id_type, id_number, verification_method, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.orgId, client_id, id_type, id_number, verification_method, notes || null],
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.get('/identity-verification/:id', requirePermission('identity_verification.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM identity_verification_records WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/identity-verification/:id/verify', requirePermission('identity_verification.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE identity_verification_records SET status = \'verified\', verified_at = NOW(), verified_by = ? WHERE id = ? AND organization_id = ?',
      [req.user.id, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/identity-verification/:id/reject', requirePermission('identity_verification.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE identity_verification_records SET status = \'rejected\' WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Government Data Requests — /gov-data-requests
// =============================================================================

router.get('/gov-data-requests', requirePermission('gov_data_requests.view'), async (req, res, next) => {
  try {
    const { status, request_type, page = 1, limit = 50 } = req.query;
    const conditions = ['organization_id = ?'];
    const params = [req.orgId];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (request_type) { conditions.push('request_type = ?'); params.push(request_type); }

    const where = conditions.join(' AND ');
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (parseInt(page, 10) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM gov_data_requests WHERE ${where} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM gov_data_requests WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

router.post('/gov-data-requests', requirePermission('gov_data_requests.create'), async (req, res, next) => {
  try {
    const { authority_name, authority_ref, request_type, client_id, ip_address, date_from, date_to, legal_basis, notes } = req.body;

    const createdAt = new Date().toISOString();
    const row_hash = crypto.createHash('sha256')
      .update((authority_name || '') + (authority_ref || '') + (request_type || '') + createdAt)
      .digest('hex');

    const [result] = await db.query(
      `INSERT INTO gov_data_requests (organization_id, authority_name, authority_ref, request_type, client_id, ip_address, date_from, date_to, legal_basis, notes, row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, authority_name, authority_ref, request_type, client_id || null, ip_address || null, date_from || null, date_to || null, legal_basis || null, notes || null, row_hash],
    );

    res.status(201).json({ id: result.insertId, row_hash });
  } catch (err) {
    next(err);
  }
});

router.get('/gov-data-requests/:id', requirePermission('gov_data_requests.view'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[row]] = await db.query(
      'SELECT * FROM gov_data_requests WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.put('/gov-data-requests/:id/fulfill', requirePermission('gov_data_requests.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE gov_data_requests SET status = \'fulfilled\', fulfilled_at = NOW(), fulfilled_by = ? WHERE id = ? AND organization_id = ?',
      [req.user.id, id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/gov-data-requests/:id/reject', requirePermission('gov_data_requests.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    await db.query(
      'UPDATE gov_data_requests SET status = \'rejected\' WHERE id = ? AND organization_id = ?',
      [id, req.orgId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
