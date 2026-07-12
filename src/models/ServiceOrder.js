// =============================================================================
// FireISP 5.0 — ServiceOrder Model
// =============================================================================
// Simplified service order workflow — new → in_process → done, or cancelled
// (reachable from new/in_process) (§1.2 Customer Lifecycle). See migration
// 193, simplified in migration 380.
// =============================================================================

const BaseModel = require('./BaseModel');

class ServiceOrder extends BaseModel {
  static get tableName() { return 'service_orders'; }

  // `status` and every lifecycle timestamp/approval column (approved_at,
  // approved_by, activated_at, cancelled_at, started_at, completed_at) are
  // deliberately EXCLUDED here. None of the schemas in
  // middleware/schemas/serviceOrders.js declare them, but validate() doesn't
  // strip undeclared fields — so with them fillable, a raw
  // PUT/PATCH /service-orders/:id {status:'done'} could write the column
  // directly and bypass lifecycleService's entire FSM (row locking, contract
  // activation, invoicing). The only legitimate writers are the raw SQL in
  // lifecycleService.js#startOrder/completeOrder/cancelOrder (status,
  // started_at, completed_at, cancelled_at) and the schema's own DEFAULT
  // 'new' on create (approved_at/approved_by/activated_at are pre-migration-380
  // columns kept only for historical/audit purposes — see migration 380's
  // comment — and are no longer written by anything).
  static get fillable() {
    return [
      'organization_id', 'order_number', 'client_id', 'lead_id', 'plan_id',
      'contract_id', 'order_type', 'assigned_to', 'address', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Valid status transitions for the service-order finite state machine.
   * Enforced in lifecycleService so failures surface as friendly API errors.
   */
  static get TRANSITIONS() {
    return {
      new:        ['in_process', 'cancelled'],
      in_process: ['done', 'cancelled'],
      done:       [],
      cancelled:  [],
    };
  }

  /**
   * Get the onboarding checklist tasks for an order.
   */
  static async getTasks(orderId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT id, task_key, label, is_done, completed_at, completed_by, sort_order, notes, created_at, updated_at
         FROM service_order_tasks
        WHERE service_order_id = ?
        ORDER BY sort_order, id`,
      [orderId],
    );
    return rows;
  }
}

module.exports = ServiceOrder;
