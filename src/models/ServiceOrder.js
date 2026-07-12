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

  static get fillable() {
    return [
      'organization_id', 'order_number', 'client_id', 'lead_id', 'plan_id',
      'contract_id', 'order_type', 'status', 'assigned_to', 'address', 'notes',
      'approved_at', 'approved_by', 'activated_at', 'cancelled_at',
      'started_at', 'completed_at',
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
