// =============================================================================
// FireISP 5.0 — Plan Availability Check
// =============================================================================
// Shared "is this plan selectable for a NEW or newly-moved assignment?" guard,
// used by routes/contracts.js (contract create + plan-move on PUT/PATCH/renew)
// and routes/serviceOrders.js (service-order create/update FK checks).
//
// A plan is selectable when it is LIVE (not archived/soft-deleted) and, when
// an active org context exists, either belongs to THIS organization or is a
// global plan (organization_id IS NULL). Archived plans keep billing their
// EXISTING contracts but cannot take on new ones; a plan scoped to a
// different organization must never be assignable cross-tenant (security
// hardening — see fix/network-authz-hardening).
//
// The org branch is skipped entirely when orgId is null/undefined
// (single-tenant / no active-org context), matching every other org-scoped
// lookup in this codebase (BaseModel.findById, etc.).
//
// lifecycleService.js#startOrder intentionally keeps its OWN inline copy of
// this exact check (see the comment there) to avoid a route->service import
// cycle; keep both in sync if this logic ever changes.
// =============================================================================

const { AppError } = require('../utils/errors');

/**
 * @param {object} executor - DB pool or transaction connection (exposes .query)
 * @param {number} planId
 * @param {number|null} [orgId]
 * @throws {AppError} 422 PLAN_ARCHIVED when the plan is archived, missing, or
 *   belongs to a different organization
 */
async function assertPlanSelectable(executor, planId, orgId = null) {
  let sql = 'SELECT id FROM plans WHERE id = ? AND deleted_at IS NULL';
  const params = [planId];
  if (orgId !== null && orgId !== undefined) {
    sql += ' AND (organization_id = ? OR organization_id IS NULL)';
    params.push(orgId);
  }
  const [rows] = await executor.query(sql, params);
  if (!rows[0]) {
    throw new AppError(
      'This plan is archived, unavailable, or belongs to a different organization; a contract cannot be assigned to it.',
      422, 'PLAN_ARCHIVED',
    );
  }
}

module.exports = { assertPlanSelectable };
