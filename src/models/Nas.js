// =============================================================================
// FireISP 5.0 — NAS Model
// =============================================================================

const BaseModel = require('./BaseModel');
const db = require('../config/database');

class Nas extends BaseModel {
  static get tableName() { return 'nas'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'ip_address', 'ipv6_address',
      'secret', 'type', 'ports', 'coa_port', 'location', 'site_id',
      'secondary_nas_id', 'health_status', 'last_health_check_at',
      'description', 'status',
      // RouterOS direct-provisioning API connection (migration 360)
      'api_port', 'api_username', 'api_password_encrypted', 'api_use_tls',
      // Per-NAS connectivity mode (migration 371)
      'access_mode',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Create a NAS, or RESTORE+UPDATE an existing soft-deleted row that shares the
   * same (ip_address, organization_id) — keeping the original id/history instead
   * of orphaning the archived row. Since migration 361 the ip_address unique key
   * ignores soft-deleted rows, so a plain insert over a soft-deleted IP would
   * otherwise succeed and leave the old row stranded. The lookup is org-scoped so
   * one ISP can never restore another's row. `data.organization_id` is injected
   * by crudController.create. Distinct from POST /:id/restore (restore by known id).
   */
  static async createOrRestore(data) {
    const ip = data.ip_address;
    const orgId = data.organization_id ?? null;
    if (ip && orgId !== null) {
      const [rows] = await db.query(
        'SELECT id FROM `nas` WHERE ip_address = ? AND organization_id = ? AND deleted_at IS NOT NULL ORDER BY id DESC LIMIT 1',
        [ip, orgId],
      );
      if (rows.length) {
        const id = rows[0].id;
        const filtered = {};
        for (const key of this.fillable) {
          if (data[key] !== undefined) filtered[key] = data[key];
        }
        const cols = Object.keys(filtered);
        const setClauses = [...cols.map((c) => `\`${c}\` = ?`), 'deleted_at = NULL'].join(', ');
        // Conditional restore: only revive a row that is STILL soft-deleted, so a
        // concurrent restore / hard-delete can't be clobbered.
        const [result] = await db.query(
          `UPDATE \`nas\` SET ${setClauses} WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL`,
          [...cols.map((c) => filtered[c]), id, orgId],
        );
        // Return the restored row only if the UPDATE actually hit it; otherwise
        // fall through to a normal insert below.
        if (result.affectedRows > 0) return this.findById(id, orgId);
      }
    }
    return super.create(data);
  }
}

module.exports = Nas;
