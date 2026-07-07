// =============================================================================
// FireISP 5.0 — ConcessionTitle Model
// =============================================================================

const BaseModel = require('./BaseModel');

/**
 * Serialize a value destined for a JSON-array column (services_authorized,
 * spectrum_bands) into the JSON-array string MySQL requires. Accepts an array
 * or a comma-separated string, and passes an existing JSON-array string through
 * unchanged so an edit round-trip does not double-encode. Without this, a plain
 * string bound straight into the `services_authorized` JSON NOT NULL column
 * fails the INSERT with "Invalid JSON text".
 * @param {string|string[]} v
 * @returns {string|undefined|null} JSON-array string (or v unchanged if null/undefined)
 */
function toJsonList(v) {
  if (v === undefined || v === null) return v;
  if (Array.isArray(v)) return JSON.stringify(v.map(e => String(e).trim()).filter(Boolean));
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) {
      try { const p = JSON.parse(t); if (Array.isArray(p)) return t; } catch (_e) { /* fall through */ }
    }
    return JSON.stringify(t.split(',').map(s => s.trim()).filter(Boolean));
  }
  return JSON.stringify(v);
}

class ConcessionTitle extends BaseModel {
  static get tableName() { return 'concession_titles'; }

  static get fillable() {
    return [
      'organization_id', 'title_number', 'concession_type',
      'services_authorized', 'geographic_scope', 'spectrum_bands',
      'granted_date', 'expiration_date', 'renewal_filed_at',
      'regulatory_body', 'document_file_id', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  // services_authorized (JSON NOT NULL) and spectrum_bands (JSON) require a
  // JSON-array string, not the raw string the validator accepts.
  static normalizeInput(data) {
    const out = { ...data };
    if (out.services_authorized !== undefined) out.services_authorized = toJsonList(out.services_authorized);
    if (out.spectrum_bands !== undefined) out.spectrum_bands = toJsonList(out.spectrum_bands);
    return out;
  }

  static async create(data) { return super.create(this.normalizeInput(data)); }

  static async update(id, data, orgId = null) { return super.update(id, this.normalizeInput(data), orgId); }
}

module.exports = ConcessionTitle;
