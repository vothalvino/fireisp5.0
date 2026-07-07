// =============================================================================
// FireISP 5.0 — MessageTemplate Model
// =============================================================================

const BaseModel = require('./BaseModel');

/**
 * Serialize a value destined for the `variables` JSON column into the
 * JSON-array string MySQL requires. Accepts an array or a comma-separated
 * string, and passes an existing JSON-array string through unchanged so an
 * edit round-trip does not double-encode. Without this, a plain string bound
 * straight into the JSON `variables` column fails the INSERT with
 * "Invalid JSON text".
 * @param {string|string[]} v
 * @returns {string|undefined|null} JSON-array string (or v unchanged if null/undefined)
 */
function toJsonList(v) {
  if (v === undefined || v === null) return v;
  if (Array.isArray(v)) return JSON.stringify(v.map(e => String(e).trim()).filter(Boolean));
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return JSON.stringify([]);
    if (t.startsWith('[')) {
      try { const p = JSON.parse(t); if (Array.isArray(p)) return t; } catch (_e) { /* fall through */ }
    }
    return JSON.stringify(t.split(',').map(s => s.trim()).filter(Boolean));
  }
  return JSON.stringify(v);
}

class MessageTemplate extends BaseModel {
  static get tableName() { return 'message_templates'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'channel', 'subject', 'body', 'variables',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  // The `variables` JSON column requires a JSON-array string, not the raw
  // string the validator accepts. mysql2 auto-parses JSON columns back into
  // arrays on read, so no read-side handling is needed.
  static normalizeInput(data) {
    const out = { ...data };
    if (out.variables !== undefined) out.variables = toJsonList(out.variables);
    return out;
  }

  static async create(data) { return super.create(this.normalizeInput(data)); }

  static async update(id, data, orgId = null) { return super.update(id, this.normalizeInput(data), orgId); }
}

module.exports = MessageTemplate;
