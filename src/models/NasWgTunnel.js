// =============================================================================
// FireISP 5.0 — NasWgTunnel Model
// =============================================================================
// Represents a WireGuard tunnel record for a NAS device (1:1 with nas).
// The FireISP host is the hub (wg-fireisp); the NAS dials out as a peer.
// Private key is stored AES-256-GCM encrypted via src/utils/encryption.js.
// =============================================================================

const BaseModel = require('./BaseModel');

class NasWgTunnel extends BaseModel {
  static get tableName() { return 'nas_wg_tunnels'; }

  static get fillable() {
    return [
      'organization_id',
      'nas_id',
      'interface_name',
      'tunnel_address',
      'nas_public_key',
      'nas_private_key_encrypted',
      'nas_config_method',
      'routed_subnets',
      'state',
      'server_peer_synced',
      'last_handshake_at',
      'last_error',
      'provisioned_at',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = NasWgTunnel;
