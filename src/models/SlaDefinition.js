// =============================================================================
// FireISP 5.0 — SlaDefinition Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SlaDefinition extends BaseModel {
  static get tableName() { return 'sla_definitions'; }

  static get fillable() {
    return [
      // MUST be listed — crudController injects req.orgId only when hasOrgScope
      // is true, and BaseModel.create filters strictly to `fillable`.
      'organization_id',
      'plan_id', 'name', 'description', 'uptime_pct',
      'max_response_minutes', 'max_resolution_minutes',
      'measurement_period', 'compensation_type', 'compensation_value',
      'exclude_maintenance', 'priority', 'status',
    ];
  }

  // The sla_definitions table has NO organization_id column (single-tenant
  // per ISP; see schema.sql / migration 063). Org-scoping would emit
  // "WHERE organization_id = ?" against a non-existent column → 500.
  // Migration 429 added organization_id (denormalised from plans). It was off,
  // and BaseModel omits the predicate SILENTLY when it is — so one ISP's uptime
  // commitments, response times and compensation rates were readable, editable
  // and deletable by every other tenant on the install.
  static get hasOrgScope() { return true; }

  // deleted_at column added by migration 151 — soft-delete is supported.
  static get softDelete() { return true; }
}

module.exports = SlaDefinition;
