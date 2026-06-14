// =============================================================================
// FireISP 5.0 — Data Security Routes (§17)
// Covers: encryption_key_metadata, data_masking_rules, secure_deletion_log,
//         TLS configuration docs
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const securityService = require('../services/securityService');
const { NotFoundError } = require('../utils/errors');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Encryption Key Metadata
// ---------------------------------------------------------------------------

// GET /encryption-keys — list key metadata
router.get('/encryption-keys', requirePermission('encryption_keys.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM encryption_key_metadata WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /encryption-keys — register key metadata
// Accepts key_id (new schema name) or legacy key_alias for backward compat;
// accepts key_length_bits (new) or legacy key_size for backward compat.
router.post('/encryption-keys', requirePermission('encryption_keys.update'), async (req, res, next) => {
  try {
    const { key_id, key_alias, algorithm, key_length_bits, key_size, key_reference, purpose, status, version, expires_at, next_rotation_at, notes } = req.body;
    const keyIdValue = key_id ?? key_alias;
    const keyLenValue = key_length_bits ?? key_size ?? null;
    const [result] = await db.query(
      `INSERT INTO encryption_key_metadata
        (organization_id, key_id, purpose, algorithm, key_length_bits, key_reference, status, version, expires_at, next_rotation_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.orgId,
        keyIdValue || null,
        purpose || null,
        algorithm || null,
        keyLenValue,
        key_reference || null,
        status || 'active',
        version || 1,
        expires_at || null,
        next_rotation_at || null,
        notes || null,
      ],
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// PUT /encryption-keys/:id — update key metadata, supports rotate action
// Accepts key_id/key_alias and key_length_bits/key_size for backward compat.
router.put('/encryption-keys/:id', requirePermission('encryption_keys.update'), async (req, res, next) => {
  try {
    const { key_id, key_alias, algorithm, key_length_bits, key_size, key_reference, purpose, status, version, expires_at, next_rotation_at, notes, action } = req.body;

    const updates = [];
    const params = [];

    // Accept key_id (new) or key_alias (old) for backward compat
    const keyIdValue = key_id !== undefined ? key_id : key_alias;
    if (keyIdValue !== undefined) { updates.push('key_id = ?'); params.push(keyIdValue); }
    if (algorithm !== undefined) { updates.push('algorithm = ?'); params.push(algorithm); }
    // Accept key_length_bits (new) or key_size (old) for backward compat
    const keyLenValue = key_length_bits !== undefined ? key_length_bits : key_size;
    if (keyLenValue !== undefined) { updates.push('key_length_bits = ?'); params.push(keyLenValue); }
    if (key_reference !== undefined) { updates.push('key_reference = ?'); params.push(key_reference); }
    if (purpose !== undefined) { updates.push('purpose = ?'); params.push(purpose); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (version !== undefined) { updates.push('version = ?'); params.push(version); }
    if (expires_at !== undefined) { updates.push('expires_at = ?'); params.push(expires_at); }
    if (next_rotation_at !== undefined) { updates.push('next_rotation_at = ?'); params.push(next_rotation_at); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

    // Support rotate action: set rotated_at = NOW() and status = active
    if (action === 'rotate') {
      updates.push('rotated_at = NOW()');
      updates.push('status = ?');
      params.push('active');
    }

    updates.push('updated_at = NOW()');
    params.push(req.params.id, req.orgId);

    if (updates.length === 1) {
      // Only updated_at — still valid, just return success
      await db.query(
        'UPDATE encryption_key_metadata SET updated_at = NOW() WHERE id = ? AND organization_id = ?',
        [req.params.id, req.orgId],
      );
    } else {
      const [result] = await db.query(
        `UPDATE encryption_key_metadata SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`,
        params,
      );
      if (result.affectedRows === 0) throw new NotFoundError('Encryption key');
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Data Masking Rules
// ---------------------------------------------------------------------------

// GET /data-masking — list masking rules
router.get('/data-masking', requirePermission('data_masking.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM data_masking_rules WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// PUT /data-masking — upsert masking rule
// Accepts mask_type (new) or legacy masking_type; min_role_to_view_plain (new) or legacy roles_exempt.
router.put('/data-masking', requirePermission('data_masking.update'), async (req, res, next) => {
  try {
    const { table_name, column_name, mask_type, masking_type, mask_pattern, min_role_to_view_plain, roles_exempt, is_active, notes } = req.body;

    const maskTypeValue = mask_type ?? masking_type ?? null;
    // roles_exempt was a JSON array; min_role_to_view_plain is a single VARCHAR role name
    const minRoleValue = min_role_to_view_plain ?? (Array.isArray(roles_exempt) ? (roles_exempt[0] ?? 'admin') : roles_exempt) ?? 'admin';

    await db.query(
      `INSERT INTO data_masking_rules
        (organization_id, table_name, column_name, mask_type, mask_pattern, min_role_to_view_plain, is_active, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         mask_type = VALUES(mask_type),
         mask_pattern = VALUES(mask_pattern),
         min_role_to_view_plain = VALUES(min_role_to_view_plain),
         is_active = VALUES(is_active),
         notes = VALUES(notes),
         updated_at = NOW()`,
      [
        req.orgId,
        table_name || null,
        column_name || null,
        maskTypeValue,
        mask_pattern || null,
        minRoleValue,
        is_active !== false ? 1 : 0,
        notes || null,
        req.user.id,
      ],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Secure Deletion Log
// ---------------------------------------------------------------------------

// GET /secure-deletion-log — list secure deletion log
router.get('/secure-deletion-log', requirePermission('secure_deletion.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM secure_deletion_log WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /secure-deletion — run secure deletion of expired retention data
router.post('/secure-deletion', requirePermission('secure_deletion.run'), async (req, res, next) => {
  try {
    const stats = await securityService.runSecureDeletion(req.orgId);
    res.json({ success: true, ...stats });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// TLS Configuration Documentation
// ---------------------------------------------------------------------------

// GET /tls-config — return static TLS configuration documentation
router.get('/tls-config', async (req, res, next) => {
  try {
    res.json({
      data: {
        min_tls_version: 'TLSv1.2',
        recommended_tls_version: 'TLSv1.3',
        cipher_suites: [
          'TLS_AES_128_GCM_SHA256',
          'TLS_AES_256_GCM_SHA384',
          'TLS_CHACHA20_POLY1305_SHA256',
          'ECDHE-RSA-AES128-GCM-SHA256',
          'ECDHE-RSA-AES256-GCM-SHA384',
        ],
        deprecated_cipher_suites: [
          'RC4', 'DES', '3DES', 'MD5', 'SHA1',
          'EXPORT', 'NULL', 'anon',
        ],
        certificate_requirements: {
          min_key_size_rsa: 2048,
          min_key_size_ecdsa: 256,
          preferred_curve: 'P-256',
          max_validity_days: 398,
        },
        hsts: {
          enabled: true,
          max_age_seconds: 31536000,
          include_subdomains: true,
          preload: false,
        },
        notes: 'FireISP enforces TLSv1.2+ for all API endpoints. TLSv1.0 and TLSv1.1 are disabled.',
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
