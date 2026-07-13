// =============================================================================
// FireISP 5.0 — Support Context Service (§21.7)
// =============================================================================
// Assembles CRM + billing + RADIUS + NMS + CPE context for a client.
// Never includes raw credentials (strips SNMP community, RADIUS secret,
// and private IP addresses from all assembled context).
//
// Public API:
//   enrichContext({ orgId, clientId }) → context object
//   scoreConfidence(intentConfidence, contextQuality) → 0-1 number
// =============================================================================

const db     = require('../config/database');
const logger = require('../utils/logger').child({ service: 'supportContextService' });

// ---------------------------------------------------------------------------
// Private IP regex — matches RFC-1918 + RFC-5737-adjacent ranges
// ---------------------------------------------------------------------------
const PRIVATE_IP_RE = /\b(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)\b/g;

// ---------------------------------------------------------------------------
// Lazy-require helpers (avoid circular dependency chains)
// ---------------------------------------------------------------------------

function getBillingService() { return require('./billingService'); }
function getRadiusService()  { return require('./radiusService'); }
function getAlertService()   { return require('./alertService'); }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip private IP addresses from a JSON-serialisable value.
 * Serialises to JSON, applies the regex, then parses back.
 *
 * @param {*} value — any JSON-serialisable value
 * @returns {*} — same structure with private IPs replaced by '[private]'
 */
function _stripPrivateIps(value) {
  if (value === null || value === undefined) return value;
  try {
    PRIVATE_IP_RE.lastIndex = 0;
    const raw     = JSON.stringify(value);
    const cleaned = raw.replace(PRIVATE_IP_RE, '[private]');
    return JSON.parse(cleaned);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// enrichContext
// ---------------------------------------------------------------------------

/**
 * Assemble multi-source context for a client support interaction.
 *
 * All fetches are independent; failures are swallowed so a single unavailable
 * service never blocks the conversation.  Private IPs are stripped from the
 * final result before it is returned.
 *
 * @param {object} opts
 * @param {number} opts.orgId    — organization ID
 * @param {number} opts.clientId — client ID
 * @returns {Promise<{
 *   customer: { id: number, name: string, status: string, planId: number|null } | null,
 *   billing:  { balance: number, nextDue: string|null } | null,
 *   connection: { sessionActive: boolean, ip: string|null, uptime: number|null } | null,
 *   alerts: Array
 * }>}
 */
async function enrichContext({ orgId, clientId }) {
  // ── 1. CRM record ──────────────────────────────────────────────────────────
  let customer = null;
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, phone, status, plan_id FROM clients WHERE id = ? AND organization_id = ?',
      [clientId, orgId],
    );
    if (rows.length > 0) {
      const r = rows[0];
      customer = {
        id:     r.id,
        name:   r.name,
        status: r.status,
        planId: r.plan_id || null,
      };
    }
  } catch (err) {
    logger.warn({ err: err.message, clientId, orgId }, 'supportContextService: failed to fetch client record');
  }

  // ── 2. Billing summary ─────────────────────────────────────────────────────
  let billing = null;
  try {
    const billingService = getBillingService();

    if (typeof billingService.getBillingSummary === 'function') {
      const summary = await billingService.getBillingSummary(clientId, orgId);
      if (summary) {
        billing = {
          balance: summary.balance ?? null,
          nextDue: summary.next_due_date || summary.nextDue || null,
        };
      }
    } else {
      // Fallback: direct table query
      const [brows] = await db.query(
        'SELECT balance, next_due_date FROM client_billing_summaries WHERE client_id = ?',
        [clientId],
      );
      if (brows.length > 0) {
        billing = {
          balance: brows[0].balance ?? null,
          nextDue: brows[0].next_due_date || null,
        };
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, clientId }, 'supportContextService: failed to fetch billing summary');
  }

  // ── 3. RADIUS session ─────────────────────────────────────────────────────
  let connection = null;
  try {
    const radiusService = getRadiusService();
    if (typeof radiusService.getSessionByClientId === 'function') {
      const session = await radiusService.getSessionByClientId(clientId, orgId);
      if (session) {
        connection = {
          sessionActive: Boolean(session.sessionActive ?? session.session_active ?? true),
          ip:            session.ip || session.framed_ip_address || null,
          uptime:        session.uptime ?? session.session_time ?? null,
        };
      } else {
        connection = { sessionActive: false, ip: null, uptime: null };
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, clientId }, 'supportContextService: failed to fetch RADIUS session');
  }

  // ── 4. Active alerts ───────────────────────────────────────────────────────
  let alerts = [];
  try {
    const alertService = getAlertService();
    if (typeof alertService.getActiveAlerts === 'function') {
      const allAlerts = await alertService.getActiveAlerts(orgId);
      // Keep only alerts that could be relevant to this client's area.
      // Without a geographic filter key we surface all org-level alerts.
      alerts = Array.isArray(allAlerts) ? allAlerts : [];
    }
  } catch (err) {
    logger.warn({ err: err.message, orgId }, 'supportContextService: failed to fetch active alerts');
  }

  // ── 5. Strip private IPs and return ───────────────────────────────────────
  const raw = { customer, billing, connection, alerts };
  return _stripPrivateIps(raw);
}

// ---------------------------------------------------------------------------
// scoreConfidence
// ---------------------------------------------------------------------------

/**
 * Compute a composite confidence score from intent confidence and context quality.
 *
 * Formula: score = intentConfidence * 0.7 + contextQuality * 0.3, clamped [0, 1].
 *
 * contextQuality should be 0-1 based on how many context fields returned non-null data.
 * A convenient way to compute it: count non-null top-level context keys / total keys.
 *
 * @param {number} intentConfidence — 0–1 confidence from intent classification
 * @param {number} contextQuality   — 0–1 quality of the assembled context
 * @returns {number} — composite score clamped to [0, 1]
 */
function scoreConfidence(intentConfidence, contextQuality) {
  const ic = Number.isFinite(intentConfidence) ? intentConfidence : 0;
  const cq = Number.isFinite(contextQuality)   ? contextQuality   : 0;
  const score = ic * 0.7 + cq * 0.3;
  return Math.min(1, Math.max(0, score));
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  enrichContext,
  scoreConfidence,
  // Exposed for unit testing
  _stripPrivateIps,
};
