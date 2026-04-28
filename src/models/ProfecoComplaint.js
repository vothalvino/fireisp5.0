// =============================================================================
// FireISP 5.0 — ProfecoComplaint Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ProfecoComplaint extends BaseModel {
  static get tableName() { return 'profeco_complaints'; }

  static get fillable() {
    return [
      'organization_id',
      'ticket_id',
      'client_id',
      'folio_profeco',
      'consumer_name',
      'consumer_email',
      'consumer_phone',
      'service_type',
      'category',
      'description',
      'resolution_requested',
      'company_response',
      'status',
      'reported_at',
      'resolved_at',
      'submitted_by',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = ProfecoComplaint;
