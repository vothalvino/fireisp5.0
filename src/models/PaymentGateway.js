// =============================================================================
// FireISP 5.0 — PaymentGateway Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PaymentGateway extends BaseModel {
  static get tableName() { return 'payment_gateways'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'provider', 'environment', 'public_key',
      'secret_key_encrypted', 'webhook_secret_encrypted', 'is_default',
      'config_json', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  // config_json is a JSON column. The validator accepts a string; make sure
  // whatever reaches the column is valid JSON (stringify an object, or wrap a
  // non-JSON string) so a stray value can't fail the INSERT with "Invalid JSON".
  static normalizeInput(data) {
    const out = { ...data };
    if (out.config_json !== undefined && out.config_json !== null && out.config_json !== '') {
      if (typeof out.config_json === 'object') {
        out.config_json = JSON.stringify(out.config_json);
      } else if (typeof out.config_json === 'string') {
        try { JSON.parse(out.config_json); } catch (_e) { out.config_json = JSON.stringify(out.config_json); }
      }
    }
    return out;
  }

  static async create(data) { return super.create(this.normalizeInput(data)); }

  static async update(id, data, orgId = null) { return super.update(id, this.normalizeInput(data), orgId); }
}

module.exports = PaymentGateway;
