// =============================================================================
// FireISP 5.0 — DeviceConfigBackup Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DeviceConfigBackup extends BaseModel {
  static get tableName() { return 'device_config_backups'; }

  static get fillable() {
    return [
      // organization_id MUST be listed. crudController auto-injects req.orgId
      // only when hasOrgScope is true (crudController.js:123-125), but
      // BaseModel.create filters strictly to `fillable` — so omitting it here
      // would silently drop the injected value and write a NULL-org row that is
      // invisible to its own creator's list and 404s on update.
      'organization_id',
      'device_id', 'version', 'config_type', 'content', 'file_size',
      'checksum', 'change_summary', 'capture_method', 'captured_by_user_id',
      'notes',
    ];
  }

  // Migration 425 added organization_id (denormalised from devices), so org
  // scoping is ON. It was previously off with a comment claiming the parent
  // device provided tenant isolation — it did not: BaseModel.js:99 omits the
  // predicate SILENTLY when hasOrgScope is false, so list/get/update/delete/
  // restore all ran unscoped and every tenant could read and delete every other
  // tenant's device configs, which carry PPPoE/RADIUS secrets and WireGuard
  // keys. Scoping through a parent requires overriding all six operations; the
  // one model that tried (Radius) covered only the read paths.
  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = DeviceConfigBackup;
