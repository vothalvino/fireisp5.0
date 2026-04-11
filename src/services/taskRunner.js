// =============================================================================
// FireISP 5.0 — Task Runner Service
// =============================================================================
// Polls scheduled_tasks and dispatches them based on cron expressions.
// Provides run/list/enable/disable for the scheduled_tasks admin API.
// =============================================================================

const db = require('../config/database');
const billingService = require('./billingService');
const suspensionService = require('./suspensionService');

/**
 * Get all scheduled tasks, optionally filtered by organization.
 */
async function listTasks(orgId = null) {
  if (orgId) {
    const [rows] = await db.query(
      'SELECT * FROM scheduled_tasks WHERE organization_id = ? OR organization_id IS NULL ORDER BY priority DESC, task_name',
      [orgId],
    );
    return rows;
  }
  const [rows] = await db.query('SELECT * FROM scheduled_tasks ORDER BY priority DESC, task_name');
  return rows;
}

/**
 * Run a single task by name. Dispatches to the appropriate service function.
 */
async function runTask(taskName, organizationId = null) {
  const start = Date.now();

  switch (taskName) {
    case 'auto_generate_invoices':
      return runAutoInvoice(organizationId);
    case 'auto_suspend_overdue':
      return runAutoSuspend(organizationId);
    case 'radius_sync':
      return { message: 'RADIUS sync is handled by FreeRADIUS SQL module — no app-level action' };
    case 'populate_revenue_summary':
      return { message: 'Revenue summary is populated by MySQL scheduled event' };
    case 'populate_network_health_snapshots':
      return { message: 'Network health snapshots are populated by MySQL scheduled event' };
    case 'csd_expiry_monitor':
      return runCsdExpiryCheck(organizationId);
    default:
      return { message: `Unknown task: ${taskName}`, elapsed_ms: Date.now() - start };
  }
}

/**
 * Auto-generate invoices for all active contracts with pending billing periods.
 */
async function runAutoInvoice(organizationId) {
  const orgFilter = organizationId ? 'AND c.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [contracts] = await db.query(
    `SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.currency AS plan_currency
     FROM contracts c
     JOIN plans p ON p.id = c.plan_id
     WHERE c.status = 'active' ${orgFilter}`,
    params,
  );

  let generated = 0;
  for (const contract of contracts) {
    try {
      const period = await billingService.generateBillingPeriod(contract);
      if (period.status === 'pending') {
        const plan = { name: contract.plan_name, price: contract.plan_price, currency: contract.plan_currency };
        await billingService.generateInvoice(period, contract, plan, contract.organization_id);
        generated++;
      }
    } catch (_err) {
      // Skip contracts that fail (already invoiced, etc.)
    }
  }

  return { invoices_generated: generated, contracts_checked: contracts.length };
}

/**
 * Auto-suspend overdue contracts per organization rules.
 */
async function runAutoSuspend(organizationId) {
  const orgFilter = organizationId ? 'WHERE id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [orgs] = await db.query(
    `SELECT id FROM organizations WHERE status = 'active' ${orgFilter ? 'AND id = ?' : ''}`,
    params,
  );

  let suspended = 0;
  for (const org of orgs) {
    const results = await suspensionService.evaluateRules(org.id);
    for (const { rule, contract } of results) {
      if (rule.action === 'auto_suspend') {
        await suspensionService.suspendContract(
          contract.id, rule.id, null, contract.invoice_id,
        );
        suspended++;
      }
    }
  }

  return { contracts_suspended: suspended };
}

/**
 * Check for CSD certificates expiring within 30 days and log warnings.
 */
async function runCsdExpiryCheck(organizationId) {
  const orgFilter = organizationId ? 'AND organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [expiring] = await db.query(
    `SELECT * FROM csd_certificates
     WHERE status = 'active'
       AND valid_to <= DATE_ADD(NOW(), INTERVAL 30 DAY)
       ${orgFilter}`,
    params,
  );

  return { expiring_certificates: expiring.length, certificates: expiring.map(c => ({ id: c.id, rfc: c.rfc, valid_to: c.valid_to })) };
}

/**
 * Update last_run_at after task execution.
 */
async function markTaskRun(taskName) {
  await db.query(
    'UPDATE scheduled_tasks SET last_run_at = NOW(), status = ? WHERE task_name = ?',
    ['completed', taskName],
  );
}

module.exports = { listTasks, runTask, markTaskRun, runAutoInvoice, runAutoSuspend, runCsdExpiryCheck };
