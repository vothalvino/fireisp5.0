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
const snmpTrapReceiver = require('./snmpTrapReceiver');
const emailTransport = require('./emailTransport');
const smsTransport = require('./smsTransport');
const webhookService = require('./webhookService');
const checkoutService = require('./checkoutService');
const alertService = require('./alertService');
const retentionService = require('./retentionService');
const paymentRetryService = require('./paymentRetryService');
const configBackupService = require('./configBackupService');
const drDrillService = require('./drDrillService');
const interactionService = require('./interactionService');
const campaignService = require('./campaignService');
const lateFeeService = require('./lateFeeService');
const paymentReminderService = require('./paymentReminderService');
const assetService = require('./assetService');
const scheduledReportService = require('./scheduledReportService');
const emailTemplates = require('../views/emailTemplates');
const { backup: runBackup } = require('../scripts/backup');

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
    case 'billing_cycle':
      return runBillingCycle(organizationId);
    case 'snmp_poll':
      return snmpPoller.poll();
    case 'snmp_trap_receiver_restart':
      snmpTrapReceiver.stop();
      snmpTrapReceiver.start();
      return { message: 'SNMP trap receiver restarted' };
    case 'email_send':
      return emailTransport.processQueue();
    case 'sms_send':
      return smsTransport.processQueue();
    case 'webhook_delivery':
    case 'webhook_retry':
      return webhookService.processRetries();
    case 'radius_sync':
      return Promise.all([
        radiusService.syncAllAccounts(organizationId),
        radiusService.syncFreeradiusTables(organizationId),
      ]).then(([accounts, tables]) => ({ ...accounts, freeradius: tables }));
    case 'check_certificate_expiry':
      return radiusService.checkCertificateExpiry(organizationId);
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
    case 'retry_failed_charges':
      return paymentRetryService.processPendingRetries(organizationId);
    case 'data_retention':
      return retentionService.runAll();
    case 'database_backup':
      return runBackup();
    case 'config_backup_pull':
      return configBackupService.runNightlyBackups(organizationId);
    case 'quarterly_dr_drill':
      return drDrillService.runDrill();
    case 'follow_up_reminders':
      return interactionService.processDueReminders(organizationId);
    case 'dispatch_satisfaction_surveys':
      return interactionService.dispatchTicketSurveys(organizationId);
    case 'auto_escalate_tickets':
      return interactionService.autoEscalateTickets(organizationId);
    case 'campaign_send':
      return campaignService.processQueue();
    case 'apply_late_fees':
      return lateFeeService.applyLateFees(organizationId);
    case 'send_payment_reminders':
      return paymentReminderService.sendPaymentReminders(organizationId);
    case 'purge_radius_accounting': {
      const radiusAccountingService = require('./radiusAccountingService');
      return radiusAccountingService.purgeRadiusAccounting();
    }
    case 'nas_health_check': {
      const nasHealthService = require('./nasHealthService');
      return nasHealthService.runHealthChecks(organizationId);
    }
    case 'kick_duplicate_sessions':
      return radiusService.kickDuplicateSessions(organizationId);
    case 'check_pool_utilization': {
      const poolUtilizationService = require('./poolUtilizationService');
      return poolUtilizationService.checkAllPoolUtilization();
    }
    case 'scan_auth_failures': {
      const pppoeDiagnosticsService = require('./pppoeDiagnosticsService');
      return pppoeDiagnosticsService.scanAuthFailures(organizationId);
    }
    case 'sla_breach_check':
      return handleSlaBreachCheck(organizationId);
    case 'geofence_evaluation': {
      const geoFenceService = require('./geoFenceService');
      return geoFenceService.evaluateAll(organizationId);
    }
    case 'inventory_low_stock_check':
      return handleInventoryLowStockCheck(organizationId);
    case 'generate_scheduled_reports':
      return scheduledReportService.processScheduledReports();
    default:
      return { message: `Unknown task: ${taskName}`, elapsed_ms: Date.now() - start };
  }
}

/**
 * Auto-generate invoices for all active contracts with pending billing periods.
 * Sends an invoice notification email to the client after each successful generation.
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
  let emailed = 0;
  for (const contract of contracts) {
    try {
      const period = await billingService.generateBillingPeriod(contract);
      if (period.status === 'pending') {
        const plan = { name: contract.plan_name, price: contract.plan_price, currency: contract.plan_currency };
        const invoice = await billingService.generateInvoice(period, contract, plan, contract.organization_id);
        generated++;

        // Send invoice notification email to client
        try {
          const [clientRows] = await db.query(
            `SELECT cl.name, cl.email, o.name AS org_name
             FROM clients cl
             JOIN organizations o ON o.id = cl.organization_id
             WHERE cl.id = ?`,
            [contract.client_id],
          );
          const [itemRows] = await db.query(
            'SELECT description, amount FROM invoice_items WHERE invoice_id = ?',
            [invoice.id],
          );
          const client = clientRows[0];
          if (client && client.email) {
            const { subject, html } = emailTemplates.invoiceEmail({
              clientName: client.name,
              orgName: client.org_name,
              invoiceNumber: invoice.invoice_number,
              total: invoice.total,
              currency: invoice.currency,
              dueDate: invoice.due_date ? String(invoice.due_date).slice(0, 10) : '',
              items: itemRows,
            });
            await emailTransport.sendEmail({
              organizationId: contract.organization_id,
              to: client.email,
              subject,
              html,
            });
            emailed++;
          }
        } catch (_emailErr) {
          // Email failure must not block the billing cycle
        }
      }
    } catch (_err) {
      // Skip contracts that fail (already invoiced, etc.)
    }
  }

  return { invoices_generated: generated, emails_sent: emailed, contracts_checked: contracts.length };
}

/**
 * Send advance suspension warning emails for rules that have notify_before_days set.
 * Finds contracts that are approaching the suspension threshold and have not yet been suspended.
 */
async function runSuspensionWarnings(organizationId) {
  let sql = `SELECT sr.*, o.id AS org_id
             FROM suspension_rules sr
             JOIN organizations o ON o.id = sr.organization_id
             WHERE sr.notify_before_days IS NOT NULL
               AND sr.notify_before_days > 0
               AND sr.is_active = TRUE
               AND o.status = 'active'`;
  const params = [];

  if (organizationId) {
    sql += ' AND sr.organization_id = ?';
    params.push(organizationId);
  }

  const [rules] = await db.query(sql, params);

  let warnings_sent = 0;
  for (const rule of rules) {
    // Contracts approaching suspension: overdue but not yet past the days_past_due threshold,
    // within the notify_before_days window.
    const warningStart = rule.days_past_due - rule.notify_before_days;
    const warningEnd = rule.days_past_due;
    if (warningStart < 0) continue;

    const [contracts] = await db.query(
      `SELECT c.id AS contract_id, c.client_id, c.organization_id,
              i.id AS invoice_id, i.invoice_number, i.total, i.currency, i.due_date,
              DATEDIFF(NOW(), i.due_date) AS days_overdue
       FROM contracts c
       JOIN invoices i ON i.contract_id = c.id AND i.organization_id = ?
       WHERE c.organization_id = ?
         AND c.status = 'active'
         AND i.status = 'issued'
         AND DATEDIFF(NOW(), i.due_date) >= ?
         AND DATEDIFF(NOW(), i.due_date) < ?`,
      [rule.org_id, rule.org_id, warningStart, warningEnd],
    );

    for (const contract of contracts) {
      try {
        const [clientRows] = await db.query(
          `SELECT cl.name, cl.email, o.name AS org_name
           FROM clients cl
           JOIN organizations o ON o.id = cl.organization_id
           WHERE cl.id = ?`,
          [contract.client_id],
        );
        const client = clientRows[0];
        if (client && client.email) {
          const { subject, html } = emailTemplates.suspensionWarningEmail({
            clientName: client.name,
            orgName: client.org_name,
            daysOverdue: contract.days_overdue,
            invoiceNumber: contract.invoice_number,
            total: contract.total,
            currency: contract.currency,
            dueDate: contract.due_date ? String(contract.due_date).slice(0, 10) : '',
          });
          await emailTransport.sendEmail({
            organizationId: contract.organization_id,
            to: client.email,
            subject,
            html,
          });
          warnings_sent++;
        }
      } catch (_err) {
        // Email failure must not block the suspension cycle
      }
    }
  }

  return { warnings_sent };
}

/**
 * Auto-suspend overdue contracts per organization rules.
 * Sends a post-suspension notification email to the client after suspending.
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
      if (rule.action === 'soft_suspend') {
        const outcome = await suspensionService.softSuspendContract(
          contract.id, rule.id, null, contract.invoice_id,
          rule.soft_suspend_download_kbps || 128,
          rule.soft_suspend_upload_kbps || 128,
        );
        if (!outcome?.skipped) suspended++;
        continue;
      }
      if (rule.action === 'walled_garden') {
        const outcome = await radiusService.walledGardenSuspendContract(
          contract.id, rule.id, null, contract.invoice_id,
        );
        if (!outcome?.skipped) suspended++;
        continue;
      }
      if (rule.action === 'auto_suspend') {
        await suspensionService.suspendContract(
          contract.id, rule.id, null, contract.invoice_id,
        );
        suspended++;

        // Send post-suspension notification email
        try {
          const [clientRows] = await db.query(
            `SELECT cl.name, cl.email, o.name AS org_name
             FROM clients cl
             JOIN organizations o ON o.id = cl.organization_id
             WHERE cl.id = ?`,
            [contract.client_id],
          );
          const client = clientRows[0];
          if (client && client.email) {
            const { subject, html } = emailTemplates.serviceSuspendedEmail({
              clientName: client.name,
              orgName: client.org_name,
              contractId: contract.id,
              total: contract.total,
              currency: contract.currency,
            });
            await emailTransport.sendEmail({
              organizationId: org.id,
              to: client.email,
              subject,
              html,
            });
          }
        } catch (_emailErr) {
          // Email failure must not block the suspension cycle
        }
      }
    }
  }

  // Send advance warnings for contracts approaching suspension
  const { warnings_sent } = await runSuspensionWarnings(organizationId);

  return { contracts_suspended: suspended, warnings_sent };
}

/**
 * Full billing cycle orchestrator: generate invoices → email → suspend overdue.
 * Intended to be run as a single scheduled task that drives the full revenue engine.
 */
async function runBillingCycle(organizationId) {
  const invoiceResult = await runAutoInvoice(organizationId);
  const suspendResult = await runAutoSuspend(organizationId);

  return {
    invoices_generated: invoiceResult.invoices_generated,
    emails_sent: invoiceResult.emails_sent,
    contracts_checked: invoiceResult.contracts_checked,
    contracts_suspended: suspendResult.contracts_suspended,
    warnings_sent: suspendResult.warnings_sent,
  };
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

/**
 * Check for SLA events that have passed their target_deadline without resolution.
 * Marks them as breached (is_breached = 1).
 */
async function handleSlaBreachCheck(organizationId) {
  const orgFilter = organizationId ? 'AND t.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [events] = await db.query(
    `SELECT tse.id, tse.ticket_id, t.organization_id
     FROM ticket_sla_events tse
     JOIN tickets t ON t.id = tse.ticket_id
     WHERE tse.is_breached = 0
       AND tse.actual_at IS NULL
       AND tse.target_deadline < NOW()
       ${orgFilter}`,
    params,
  );

  let breached = 0;
  for (const ev of events) {
    await db.query('UPDATE ticket_sla_events SET is_breached = 1 WHERE id = ?', [ev.id]);
    breached++;
  }
  return { checked: events.length, breached };
}

/**
 * Check all inventory items that have fallen below their reorder_level and
 * surface them as alert-style results so operators can restock.
 * Mirrors the sla_breach_check pattern: query, iterate, return a summary.
 * The task is seeded with organization_id = NULL (global) so orgId may be null —
 * getLowStockItems already handles that by omitting the org filter.
 */
async function handleInventoryLowStockCheck(organizationId) {
  const items = await assetService.getLowStockItems(organizationId);

  return {
    checked: items.length,
    low_stock_count: items.length,
    items: items.map(i => ({
      item_id: i.item_id,
      name: i.name,
      sku: i.sku,
      reorder_level: i.reorder_level,
      total_stock: i.total_stock,
      deficit: i.reorder_level - i.total_stock,
    })),
  };
}

module.exports = { listTasks, runTask, markTaskRun, runAutoInvoice, runAutoSuspend, runSuspensionWarnings, runBillingCycle, runCsdExpiryCheck, handleSlaBreachCheck, handleInventoryLowStockCheck };
