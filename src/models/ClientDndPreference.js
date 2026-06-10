// =============================================================================
// FireISP 5.0 — ClientDndPreference Model — §1.4
// =============================================================================

const BaseModel = require('./BaseModel');

class ClientDndPreference extends BaseModel {
  static get tableName() { return 'client_dnd_preferences'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'channel', 'opt_out',
      'quiet_hours_start', 'quiet_hours_end', 'reason',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = ClientDndPreference;
