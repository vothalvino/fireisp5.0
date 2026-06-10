// =============================================================================
// FireISP 5.0 — Cash Reconciliation Service
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'cashReconciliation' });
const { NotFoundError, ValidationError } = require('../utils/errors');

/**
 * Open a new reconciliation session for an agent.
 * Agent must not already have an open session for the same org.
 */
async function openSession({ organizationId, agentUserId, notes }) {
  // Check for an existing open session
  const [existing] = await db.query(
    `SELECT id FROM cash_reconciliation_sessions
     WHERE organization_id = ? AND agent_user_id = ? AND status = 'open' AND deleted_at IS NULL`,
    [organizationId, agentUserId],
  );
  if (existing.length > 0) {
    throw new ValidationError('Agent already has an open reconciliation session');
  }

  const [result] = await db.query(
    `INSERT INTO cash_reconciliation_sessions
       (organization_id, agent_user_id, opened_at, status, notes)
     VALUES (?, ?, NOW(), 'open', ?)`,
    [organizationId, agentUserId, notes || null],
  );

  const [rows] = await db.query(
    'SELECT * FROM cash_reconciliation_sessions WHERE id = ?',
    [result.insertId],
  );
  logger.info({ sessionId: result.insertId, agentUserId }, 'Reconciliation session opened');
  return rows[0];
}

/**
 * Close a session: compute expected_total from cash payments made by the agent
 * during the session window. Set variance = counted_total - expected_total.
 */
async function closeSession(sessionId, orgId, countedTotal) {
  const [sessionRows] = await db.query(
    `SELECT * FROM cash_reconciliation_sessions
     WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [sessionId, orgId],
  );
  const session = sessionRows[0];
  if (!session) throw new NotFoundError('cash_reconciliation_sessions');

  if (session.status !== 'open') {
    throw new ValidationError('Session is not open');
  }

  // Compute expected_total from cash payments in the session window
  const [sumRows] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS expected_total
     FROM payments
     WHERE organization_id = ?
       AND payment_method = 'cash'
       AND created_by = ?
       AND payment_date BETWEEN ? AND NOW()
       AND deleted_at IS NULL`,
    [orgId, session.agent_user_id, session.opened_at],
  );
  const expectedTotal = parseFloat(sumRows[0].expected_total);
  const variance = Math.round((countedTotal - expectedTotal) * 100) / 100;

  const [result] = await db.query(
    `UPDATE cash_reconciliation_sessions
       SET expected_total = ?, counted_total = ?, variance = ?,
           status = 'closed', closed_at = NOW()
     WHERE id = ? AND organization_id = ?`,
    [expectedTotal, countedTotal, variance, sessionId, orgId],
  );

  if (result.affectedRows === 0) throw new NotFoundError('cash_reconciliation_sessions');

  logger.info({ sessionId, expectedTotal, countedTotal, variance }, 'Reconciliation session closed');

  const [updated] = await db.query(
    'SELECT * FROM cash_reconciliation_sessions WHERE id = ?',
    [sessionId],
  );
  return updated[0];
}

/**
 * Approve a session (supervisor action).
 */
async function approveSession(sessionId, orgId, approverUserId) {
  const [sessionRows] = await db.query(
    `SELECT * FROM cash_reconciliation_sessions
     WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [sessionId, orgId],
  );
  const session = sessionRows[0];
  if (!session) throw new NotFoundError('cash_reconciliation_sessions');

  if (session.status !== 'closed') {
    throw new ValidationError('Session must be closed before it can be approved');
  }

  const [result] = await db.query(
    `UPDATE cash_reconciliation_sessions
       SET status = 'approved', approved_by = ?, approved_at = NOW()
     WHERE id = ? AND organization_id = ?`,
    [approverUserId, sessionId, orgId],
  );

  if (result.affectedRows === 0) throw new NotFoundError('cash_reconciliation_sessions');

  logger.info({ sessionId, approverUserId }, 'Reconciliation session approved');

  const [updated] = await db.query(
    'SELECT * FROM cash_reconciliation_sessions WHERE id = ?',
    [sessionId],
  );
  return updated[0];
}

/**
 * Get a session with its cash payments included.
 * Returns session + array of cash payments that fall within the session window.
 */
async function getSessionDetail(sessionId, orgId) {
  const [sessionRows] = await db.query(
    `SELECT * FROM cash_reconciliation_sessions
     WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [sessionId, orgId],
  );
  const session = sessionRows[0];
  if (!session) throw new NotFoundError('cash_reconciliation_sessions');

  const windowEnd = session.closed_at || new Date().toISOString();

  const [payments] = await db.query(
    `SELECT * FROM payments
     WHERE organization_id = ?
       AND payment_method = 'cash'
       AND created_by = ?
       AND payment_date BETWEEN ? AND ?
       AND deleted_at IS NULL
     ORDER BY payment_date ASC`,
    [orgId, session.agent_user_id, session.opened_at, windowEnd],
  );

  return { session, payments };
}

module.exports = { openSession, closeSession, approveSession, getSessionDetail };
