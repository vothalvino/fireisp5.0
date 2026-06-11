// =============================================================================
// FireISP 5.0 — SubscriberCertificate Model
// =============================================================================

const BaseModel = require('./BaseModel');
const db = require('../config/database');

class SubscriberCertificate extends BaseModel {
  static get tableName() { return 'subscriber_certificates'; }

  static get hasOrgScope() { return true; }

  static get softDelete() { return false; }

  static get fillable() {
    return [
      'organization_id',
      'radius_account_id',
      'client_id',
      'common_name',
      'serial_number',
      'fingerprint_sha256',
      'valid_from',
      'valid_until',
      'status',
      'revoked_at',
      'revocation_reason',
    ];
  }

  /**
   * Find all certificates for a specific RADIUS account.
   */
  static async findByRadiusAccount(radiusAccountId) {
    const [rows] = await db.query(
      'SELECT * FROM subscriber_certificates WHERE radius_account_id = ? ORDER BY created_at DESC',
      [radiusAccountId],
    );
    return rows;
  }

  /**
   * Find all certificates for a specific client.
   */
  static async findByClient(clientId) {
    const [rows] = await db.query(
      'SELECT * FROM subscriber_certificates WHERE client_id = ? ORDER BY created_at DESC',
      [clientId],
    );
    return rows;
  }

  /**
   * Revoke a certificate by ID.
   */
  static async revoke(id, reason) {
    const [result] = await db.query(
      "UPDATE subscriber_certificates SET status = 'revoked', revoked_at = NOW(), revocation_reason = ? WHERE id = ?",
      [reason || null, id],
    );
    return result;
  }
}

module.exports = SubscriberCertificate;
