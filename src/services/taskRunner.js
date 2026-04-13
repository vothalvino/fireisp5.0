// =============================================================================
// FireISP 5.0 — Task Runner Service
// =============================================================================
// Polls scheduled_tasks and dispatches them based on cron expressions.
// Provides run/list/enable/disable for the scheduled_tasks admin API.
// =============================================================================

const db = require('../config/database');
const billingService = require('./billingService');
const suspensionService = require('./suspensionService');
const radiusService = require('./radiusService');
const snmpPoller = require('./snmpPoller');
const emailTransport = require('./emailTransport');
const webhookService = require('./webhookService');
const checkoutService = require('./checkoutService');
const alertService = require('./alertService');
const retentionService = require('./retentionService');

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
    case 'snmp_poll':
      return snmpPoller.poll();
    case 'email_send':
      return emailTransport.processQueue();
    case 'webhook_delivery':
      return webhookService.retryPending();
    case 'radius_sync':
      return radiusService.syncAllAccounts(organizationId);
    case 'populate_revenue_summary':
      return { message: 'Revenue summary is populated by MySQL scheduled event' };
    case 'populate_network_health_snapshots':
      return { message: 'Network health snapshots are populated by MySQL scheduled event' };
    case 'csd_expiry_monitor':
      return runCsdExpiryCheck(organizationId);
    case 'alert_evaluation':
      return alertService.evaluateAlerts(organizationId);
    case 'process_recurring_charges':
      return checkoutService.processRecurringCharges(organizationId);
    case 'data_retention':
      return retentionService.runAll();
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
  let sql = 'SELECT id FROM organizations WHERE status = \'active\'';
  const params = [];

  if (organizationId) {
    sql += ' AND id = ?';
    params.push(organizationId);
  }

  const [orgs] = await db.query(sql, params);

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
