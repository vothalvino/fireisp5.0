// =============================================================================
// FireISP 5.0 — WgUserPeer Model
// =============================================================================
// One row per enrolled user VPN device (laptop, phone, etc.).
// User peers connect to the wg-clients interface on the FireISP hub.
// Both private_key_encrypted and preshared_key_encrypted are AES-256-GCM via
// src/utils/encryption.js. Private key is returned only to its owner on create
// and on the /config download endpoint — redactPeer() strips it everywhere else.
// =============================================================================

const BaseModel = require('./BaseModel');

class WgUserPeer extends BaseModel {
  static get tableName() { return 'wg_user_peers'; }

  static get fillable() {
    return [
      'organization_id',
      'user_id',
      'name',
      'public_key',
      'private_key_encrypted',
      'preshared_key_encrypted',
      'tunnel_address',
      'allowed_ips_snapshot',
      'endpoint_host',
      'server_peer_synced',
      'last_handshake_at',
      'rx_bytes',
      'tx_bytes',
      'revoked_at',
      'revoked_by',
      'last_error',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = WgUserPeer;
