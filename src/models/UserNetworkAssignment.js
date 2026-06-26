// =============================================================================
// FireISP 5.0 — UserNetworkAssignment Model
// =============================================================================
// Admin-granted VPN network scope (site or NAS grain) per user.
// Durable — NOT derived from work orders — to prevent privilege escalation via
// self-assignment of tickets (technicians hold jobs.create).
// scope_type='site'  → scope_id is sites.id  (grants access to all NASes at site)
// scope_type='nas'   → scope_id is nas.id    (grants access to single NAS subnets)
// =============================================================================

const BaseModel = require('./BaseModel');

class UserNetworkAssignment extends BaseModel {
  static get tableName() { return 'user_network_assignments'; }

  static get fillable() {
    return [
      'organization_id',
      'user_id',
      'scope_type',
      'scope_id',
      'created_by',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = UserNetworkAssignment;
