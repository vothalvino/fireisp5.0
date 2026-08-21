// =============================================================================
// FireISP 5.0 — Regulatory Compliance Routes (§16)
// Covers: subscriber_consents, dsar_requests, identity_verification_records,
//         gov_data_requests
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createConsent, createDsarRequest, resolveDsarRequest } = require('../middleware/schemas/regulatoryCompliance');
const { NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../utils/errors');
const auditLog = require('../services/auditLog');
const communicationPreferences = require('../services/clientCommunicationPreferenceService');
const { isGloballyRoutableIpv4, normalizeProtocol } = require('../services/cgnatAttributionService');
const {
  governmentRequestRowHash,
  governmentRequestRowHashMatches,
} = require('../utils/govDataRequestIntegrity');

const router = Router();

router.use(authenticate);
router.use(orgScope);

function requireInteractiveUser(req, _res, next) {
  if (req.user?.apiTokenId) return next(new ForbiddenError('Government request decisions require an interactive user session'));
  return next();
}

function nonblank(value, field, maximum) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be a non-empty string of at most ${maximum} characters` }]);
  }
  return value.trim();
}

function exactTimestamp(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be an ISO 8601 date-time with a timezone` }]);
  }
  const parsed = new Date(value);
  if (parsed.getTime() > Date.now() || parsed.getTime() < Date.UTC(1970, 0, 1)
      || parsed.getTime() > Date.UTC(2038, 0, 19, 3, 14, 7)) {
    throw new ValidationError(`Invalid ${field}`, [{ field, message: `${field} must be a past or present supported timestamp` }]);
  }
  return parsed;
}

function positiveId(value, field, { nullable = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw new ValidationError(`${field} is required`);
  }
  if (!Number.isSafeInteger(value) || value <= 0) throw new ValidationError(`Invalid ${field}`);
  return value;
}

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

router.post('/consent', requirePermission('subscriber_consents.create'), validate(createConsent), async (req, res, next) => {
  let conn;
  try {
    const {
      client_id, consent_version, purpose, channel, communication_channel,
      document_hash, notes,
    } = req.body;
    if (purpose === 'marketing' && !communication_channel) {
      throw new ValidationError('communication_channel is required for marketing consent');
    }
    if (purpose !== 'marketing' && communication_channel) {
      throw new ValidationError('communication_channel is only valid for marketing consent');
    }

    // client_id is caller-supplied: without this check a staff user could file
    // a consent row against ANOTHER org's client (cross-tenant write).
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [clientRows] = await conn.execute(
      `SELECT id, status, email_contact_epoch, phone_contact_epoch FROM clients
        WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [client_id, req.orgId],
    );
    if (clientRows.length === 0) throw new NotFoundError('Client');
    if (clientRows[0].status === 'inactive') {
      throw new ValidationError('Marketing consent cannot be granted for an inactive client');
    }

    // A new affirmative marketing choice supersedes older active proof for
    // the same channel. Keeping multiple live rows makes a later withdrawal
    // ambiguous and can silently reactivate an older grant.
    if (purpose === 'marketing') {
      await conn.execute(
        `UPDATE subscriber_consents
            SET withdrawn_at = COALESCE(withdrawn_at, NOW())
          WHERE organization_id <=> ? AND client_id = ?
            AND purpose = 'marketing' AND communication_channel = ?
            AND withdrawn_at IS NULL`,
        [req.orgId, client_id, communication_channel],
      );
    }

    const [result] = await conn.execute(
      `INSERT INTO subscriber_consents
         (organization_id, client_id, consent_version, purpose, channel,
          communication_channel, document_hash, notes, ip_address,
          source_context, captured_by, communication_contact_epoch, given_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?, NOW())`,
      [
        req.orgId, client_id, consent_version, purpose, channel,
        communication_channel || null, document_hash || null, notes || null,
        req.ip || null, req.user?.id || null,
        purpose !== 'marketing'
          ? 0
          : (communication_channel === 'email'
            ? clientRows[0].email_contact_epoch
            : clientRows[0].phone_contact_epoch),
      ],
    );

    if (purpose === 'marketing') {
      // Positive consent and the mutable DND veto move together. This is the
      // only staff opt-in path; merely clearing a DND row never manufactures
      // marketing consent.
      await communicationPreferences.writePreferenceWithRun(conn.execute.bind(conn), {
        organizationId: req.orgId,
        clientId: client_id,
        channel: communication_channel,
        optOut: false,
        reason: 'Marketing consent granted by client',
      });
    }

    await conn.commit();

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

router.put('/consent/:id/withdraw', requirePermission('subscriber_consents.manage'), async (req, res, next) => {
  let conn;
  try {
    const { id } = req.params;

    conn = await db.getConnection();
    await conn.beginTransaction();

    // Resolve the owner without taking a consent-row lock, then use the same
    // client -> consent -> DND lock order as every opt-in/opt-out mutation.
    // A consistent order prevents concurrent grant/withdraw operations from
    // deadlocking each other.
    const [rows] = await conn.execute(
      `SELECT id, client_id, purpose, communication_channel
         FROM subscriber_consents
        WHERE id = ? AND organization_id = ?`,
      [id, req.orgId],
    );
    const consent = rows[0];
    if (!consent) throw new NotFoundError('Consent');

    const [clientRows] = await conn.execute(
      `SELECT id FROM clients
        WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [consent.client_id, req.orgId],
    );
    if (!clientRows[0]) throw new NotFoundError('Client');

    // Re-read the exact ledger row after acquiring the client lock. A delete
    // or concurrent withdrawal between the initial resolution and this lock
    // cannot redirect the operation to another client/channel.
    const [lockedRows] = await conn.execute(
      `SELECT id, client_id, purpose, communication_channel
         FROM subscriber_consents
        WHERE id = ? AND organization_id = ? AND client_id = ?
        FOR UPDATE`,
      [id, req.orgId, consent.client_id],
    );
    if (!lockedRows[0]) throw new NotFoundError('Consent');

    if (consent.purpose === 'marketing' && consent.communication_channel) {
      await conn.execute(
        `UPDATE subscriber_consents
            SET withdrawn_at = NOW()
          WHERE organization_id = ? AND client_id = ?
            AND purpose = 'marketing' AND communication_channel = ?
            AND withdrawn_at IS NULL`,
        [req.orgId, consent.client_id, consent.communication_channel],
      );

      // Consent is the positive permission and DND is the mutable safety veto.
      // Write both sides atomically so every email/SMS/WhatsApp transport sees
      // the withdrawal, not only the campaign subsystem.
      await communicationPreferences.writePreferenceWithRun(conn.execute.bind(conn), {
        organizationId: req.orgId,
        clientId: consent.client_id,
        channel: consent.communication_channel,
        optOut: true,
        reason: 'Marketing consent withdrawn',
      });
    } else {
      // Non-marketing consent keeps its existing per-ledger-entry withdrawal
      // behavior and must not alter communication suppression preferences.
      await conn.execute(
        `UPDATE subscriber_consents
            SET withdrawn_at = NOW()
          WHERE id = ? AND organization_id = ? AND withdrawn_at IS NULL`,
        [id, req.orgId],
      );
    }

    await conn.commit();

    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    next(err);
  } finally {
    if (conn) conn.release();
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

router.post('/dsar-requests', requirePermission('dsar_requests.create'), validate(createDsarRequest), async (req, res, next) => {
  try {
    const { client_id, request_type, notes } = req.body;

    // client_id is caller-supplied: without this a staff user could open a DSAR
    // against ANOTHER org's client. Same check the consent route got.
    const [clientRows] = await db.query(
      'SELECT id FROM clients WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL LIMIT 1',
      [client_id, req.orgId],
    );
    if (clientRows.length === 0) throw new NotFoundError('Client not found');

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

router.put('/dsar-requests/:id/fulfill', requirePermission('dsar_requests.manage'), validate(resolveDsarRequest), async (req, res, next) => {
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

router.put('/dsar-requests/:id/reject', requirePermission('dsar_requests.manage'), validate(resolveDsarRequest), async (req, res, next) => {
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

    const statuses = ['received', 'processing', 'fulfilled', 'rejected', 'pending_legal_review'];
    const types = ['ip_traceability', 'cdr_export', 'subscriber_data', 'other'];
    if (status) {
      if (!statuses.includes(status)) throw new ValidationError('Invalid status filter');
      conditions.push('status = ?'); params.push(status);
    }
    if (request_type) {
      if (!types.includes(request_type)) throw new ValidationError('Invalid request_type filter');
      conditions.push('request_type = ?'); params.push(request_type);
    }

    const where = conditions.join(' AND ');
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const safeOffset = (safePage - 1) * safeLimit;

    const [rows] = await db.query(
      `SELECT * FROM gov_data_requests WHERE ${where} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM gov_data_requests WHERE ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: safePage, limit: safeLimit } });
  } catch (err) {
    next(err);
  }
});

router.post('/gov-data-requests', requireInteractiveUser, requirePermission('gov_data_requests.create'), async (req, res, next) => {
  try {
    const allowed = new Set(['authority_name', 'authority_ref', 'request_type', 'client_id',
      'contract_id', 'ip_address', 'public_port', 'protocol', 'observed_at',
      'date_from', 'date_to', 'legal_basis', 'notes']);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new ValidationError('Invalid request body');
    const unknown = Object.keys(req.body).filter(key => !allowed.has(key));
    if (unknown.length) throw new ValidationError('Unknown government request fields', unknown.map(field => ({ field, message: 'field is not allowed' })));
    const authority_name = nonblank(req.body.authority_name, 'authority_name', 255);
    const authority_ref = nonblank(req.body.authority_ref, 'authority_ref', 100);
    const legal_basis = nonblank(req.body.legal_basis, 'legal_basis', 5000);
    const request_type = nonblank(req.body.request_type, 'request_type', 50);
    if (request_type === 'traffic_mirror') {
      throw new ValidationError('traffic_mirror requests are not supported by the IP-attribution response workflow');
    }
    if (!['ip_traceability', 'cdr_export', 'subscriber_data', 'other'].includes(request_type)) {
      throw new ValidationError('Invalid request_type');
    }
    const client_id = positiveId(req.body.client_id, 'client_id');
    const contract_id = positiveId(req.body.contract_id, 'contract_id');
    if (client_id) {
      const [clients] = await db.query('SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL LIMIT 1', [client_id, req.orgId]);
      if (clients.length !== 1) throw new ValidationError('client_id does not belong to this organization');
    }
    if (contract_id) {
      const [contracts] = await db.query('SELECT id, client_id FROM contracts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL LIMIT 1', [contract_id, req.orgId]);
      if (contracts.length !== 1 || (client_id && Number(contracts[0].client_id) !== client_id)) {
        throw new ValidationError('contract_id does not belong to this organization/client');
      }
    }

    const ip_address = req.body.ip_address || null;
    let public_port = null;
    let protocol = null;
    let observed_at = null;
    if (request_type === 'ip_traceability') {
      if (typeof ip_address !== 'string' || !isGloballyRoutableIpv4(ip_address)) {
        throw new ValidationError('ip_address must be a globally routable IPv4 address');
      }
      const hasPort = req.body.public_port !== undefined && req.body.public_port !== null && req.body.public_port !== '';
      const hasProtocol = req.body.protocol !== undefined && req.body.protocol !== null && req.body.protocol !== '';
      if (hasPort !== hasProtocol) throw new ValidationError('public_port and protocol must be supplied together or both omitted');
      if (hasPort) {
        public_port = positiveId(req.body.public_port, 'public_port', { nullable: false });
        if (public_port > 65535) throw new ValidationError('public_port must be from 1 to 65535');
        const protocolNumber = normalizeProtocol(req.body.protocol);
        protocol = protocolNumber === 6 ? 'tcp' : 'udp';
      }
      observed_at = exactTimestamp(req.body.observed_at, 'observed_at');
    } else if (req.body.observed_at !== undefined || req.body.public_port !== undefined || req.body.protocol !== undefined) {
      throw new ValidationError('Exact IP tuple/time fields are only valid for ip_traceability requests');
    }

    const notes = req.body.notes === undefined || req.body.notes === null
      ? null : nonblank(req.body.notes, 'notes', 10000);
    const date_from = req.body.date_from || null;
    const date_to = req.body.date_to || null;

    // gov_data_requests.created_at is TIMESTAMP(0); hash exactly the precision
    // persisted by MySQL/MariaDB so a stored-row verification is reproducible.
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const row_hash = governmentRequestRowHash({
      organization_id: req.orgId, authority_name, authority_ref,
      request_type, client_id, contract_id, ip_address, public_port, protocol,
      observed_at, legal_basis, created_at: createdAt,
    });

    const [result] = await db.query(
      `INSERT INTO gov_data_requests
        (organization_id, authority_name, authority_ref, request_type, client_id,
         contract_id, ip_address, public_port, protocol, observed_at, date_from,
         date_to, status, legal_basis, notes, row_hash, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_legal_review', ?, ?, ?, ?, ?)`,
      [req.orgId, authority_name, authority_ref, request_type, client_id,
        contract_id, ip_address, public_port, protocol, observed_at, date_from,
        date_to, legal_basis, notes, row_hash, req.user.id, createdAt],
    );
    await auditLog.log({ userId: req.user.id, organizationId: req.orgId,
      action: 'create', tableName: 'gov_data_requests', recordId: result.insertId,
      newValues: { request_type, authority_ref, status: 'pending_legal_review', row_hash } });
    res.status(201).json({ id: result.insertId, row_hash });
  } catch (err) {
    next(err);
  }
});

router.put('/gov-data-requests/:id/process', requireInteractiveUser,
  requirePermission('gov_data_requests.manage'), async (req, res, next) => {
    try {
      const id = positiveId(Number(req.params.id), 'id', { nullable: false });
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          'SELECT * FROM gov_data_requests WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE',
          [id, req.orgId],
        );
        const row = rows[0];
        if (!row) throw new NotFoundError('Government data request');
        if (!['received', 'pending_legal_review'].includes(row.status)) throw new ConflictError('Only received or pending-review requests can enter processing');
        if (!String(row.authority_name || '').trim()
            || !String(row.authority_ref || '').trim()
            || !String(row.legal_basis || '').trim()) {
          throw new ValidationError('Government request has incomplete authority reference or legal basis');
        }
        if (!governmentRequestRowHashMatches(row)) {
          throw new ConflictError('Government request consistency marker does not match the stored request');
        }
        let reviewedClient = null;
        if (row.client_id !== null) {
          const [clients] = await connection.execute(
            `SELECT id FROM clients WHERE id = ? AND organization_id = ?
              AND deleted_at IS NULL LIMIT 2`, [row.client_id, req.orgId],
          );
          if (clients.length !== 1) throw new ValidationError('Government request client is not owned by this organization');
          reviewedClient = Number(clients[0].id);
        }
        if (row.contract_id !== null) {
          const [contracts] = await connection.execute(
            `SELECT id, client_id FROM contracts WHERE id = ? AND organization_id = ?
              AND deleted_at IS NULL LIMIT 2`, [row.contract_id, req.orgId],
          );
          if (contracts.length !== 1
              || (reviewedClient !== null && Number(contracts[0].client_id) !== reviewedClient)) {
            throw new ValidationError('Government request contract is not owned by this organization or subject');
          }
        }
        if (row.request_type === 'traffic_mirror') throw new ValidationError('traffic_mirror is not supported by this workflow');
        if (row.request_type === 'ip_traceability'
            && (!isGloballyRoutableIpv4(row.ip_address) || !row.observed_at || !row.row_hash
              || ((row.public_port === null) !== (row.protocol === null)))) {
          throw new ValidationError('IP traceability request has incomplete exact-tuple scope');
        }
        if (row.request_type === 'ip_traceability' && row.protocol !== null) normalizeProtocol(row.protocol);
        const [updated] = await connection.execute(
          `UPDATE gov_data_requests SET status = 'processing', legal_reviewed_at = NOW(3),
              legal_reviewed_by = ? WHERE id = ? AND organization_id = ?
              AND status IN ('received','pending_legal_review')`,
          [req.user.id, id, req.orgId],
        );
        if (Number(updated.affectedRows) !== 1) throw new ConflictError('Government request status changed during review');
        await connection.commit();
      } catch (error) {
        await connection.rollback(); throw error;
      } finally { connection.release(); }
      await auditLog.log({ userId: req.user.id, organizationId: req.orgId,
        action: 'approve_processing', tableName: 'gov_data_requests', recordId: id,
        newValues: { status: 'processing' } });
      res.json({ success: true, status: 'processing' });
    } catch (err) { next(err); }
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

router.put('/gov-data-requests/:id/fulfill', requireInteractiveUser, requirePermission('gov_data_requests.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      `UPDATE gov_data_requests SET status = 'fulfilled', fulfilled_at = NOW(), fulfilled_by = ?
        WHERE id = ? AND organization_id = ? AND status = 'processing'`,
      [req.user.id, id, req.orgId],
    );
    if (Number(result.affectedRows) !== 1) throw new ConflictError('Only a processing request can be fulfilled');
    await auditLog.log({ userId: req.user.id, organizationId: req.orgId,
      action: 'fulfill', tableName: 'gov_data_requests', recordId: Number(id),
      newValues: { status: 'fulfilled' } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/gov-data-requests/:id/reject', requireInteractiveUser, requirePermission('gov_data_requests.manage'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const reason = nonblank(req.body?.reason, 'reason', 500);
    const [result] = await db.query(
      `UPDATE gov_data_requests SET status = 'rejected', rejected_at = NOW(3),
          rejected_by = ?, rejection_reason = ? WHERE id = ? AND organization_id = ?
        AND status NOT IN ('fulfilled','rejected')`,
      [req.user.id, reason, id, req.orgId],
    );
    if (Number(result.affectedRows) !== 1) throw new ConflictError('Request was not found or is already terminal');
    await auditLog.log({ userId: req.user.id, organizationId: req.orgId,
      action: 'reject', tableName: 'gov_data_requests', recordId: Number(id),
      newValues: { status: 'rejected', reason } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/gov-data-requests/:id/release-evidence-hold', requireInteractiveUser,
  requirePermission('gov_data_requests.manage'), async (req, res, next) => {
    try {
      const id = positiveId(Number(req.params.id), 'id', { nullable: false });
      const reason = nonblank(req.body?.reason, 'reason', 500);
      const [[request]] = await db.query(
        'SELECT status FROM gov_data_requests WHERE id = ? AND organization_id = ? LIMIT 1',
        [id, req.orgId],
      );
      if (!request) throw new NotFoundError('Government data request');
      if (!['fulfilled', 'rejected'].includes(request.status)) throw new ConflictError('Evidence holds can be released only after the case is terminal');
      const [result] = await db.query(
        `UPDATE ip_attribution_case_evidence SET hold_released_at = NOW(3),
            hold_released_by = ?, hold_release_reason = ?
          WHERE organization_id = ? AND gov_data_request_id = ? AND hold_released_at IS NULL`,
        [req.user.id, reason, req.orgId, id],
      );
      await auditLog.log({ userId: req.user.id, organizationId: req.orgId,
        action: 'release_evidence_hold', tableName: 'gov_data_requests', recordId: id,
        newValues: { released_evidence_rows: Number(result.affectedRows), reason } });
      res.json({ success: true, released_evidence_rows: Number(result.affectedRows) });
    } catch (err) { next(err); }
  });

module.exports = router;
