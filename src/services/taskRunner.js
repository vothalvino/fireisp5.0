// =============================================================================
// FireISP 5.0 — Task Runner Service
// =============================================================================
// Polls scheduled_tasks and dispatches them based on cron expressions.
// Provides run/list/enable/disable for the scheduled_tasks admin API.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'taskRunner' });
const automationService = require('./automationService');
const analyticsService = require('./analyticsService');
const billingService = require('./billingService');
const suspensionService = require('./suspensionService');
const radiusService = require('./radiusService');
const snmpPoller = require('./snmpPoller');
const pollerEngine = require('./pollerEngine');
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
const paymentPlanService = require('./paymentPlanService');
const rolloverService = require('./rolloverService');
const cpeSessionLogService = require('./cpeSessionLogService');
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
    // §6.1/§6.4: seeded by migration 254; routed through the interval-aware
    // poller so device_polling_configs and adaptive overrides take effect.
    // Migration 402 retimes the row to */1 — pollWithConfig skips devices not
    // yet due, so devices without a config keep the default 300s cadence.
    case 'snmp_discovery_poll':
      return pollerEngine.pollWithConfig();
    // §6.4 Polling Engine (seeded by migration 258 — previously dead: no case,
    // so both ticked forever as silent 'Unknown task' successes)
    case 'snmp_adaptive_poll_check':
      return pollerEngine.adaptivePollCheck();
    case 'poller_performance_snapshot':
      return pollerEngine.recordPerformanceSnapshot();
    // §9.3: seeded by migration 284 as a full-fleet snmp_poll — the generic
    // poller already collects the wireless sector OIDs (migration 279 columns),
    // so a second sweep would only double-poll every device. Migration 402
    // disables the seeded row; this case keeps a manual run honest.
    case 'wireless_ap_sector_poll':
      return { message: 'wireless_ap_sector_poll: redundant with snmp_discovery_poll (the generic poller collects wireless sector OIDs); seeded row disabled by migration 402', deferred: true };
    case 'snmp_trap_receiver_restart':
      snmpTrapReceiver.stop();
      snmpTrapReceiver.start();
      return { message: 'SNMP trap receiver restarted' };
    // §6.1: task_name seeded by migration 254 — (re)starts the UDP trap listener
    case 'snmp_trap_receiver':
      snmpTrapReceiver.stop();
      snmpTrapReceiver.start();
      return { message: 'SNMP trap receiver started' };
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
    // Migration 400: closes out maintenance_windows past their ends_at. Seeded
    // org-wide (organization_id NULL), so organizationId is normally null and
    // every org is swept in one pass — expireMaintenanceWindows() itself
    // makes the org filter optional, same shape as handleSlaBreachCheck below.
    case 'maintenance_window_expiry':
      return alertService.expireMaintenanceWindows(organizationId);
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
    case 'refresh_voip_ranges': {
      const voipRangesService = require('./voipRangesService');
      return voipRangesService.refreshAllNas(organizationId);
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
    case 'data_retention_compliance_check':
      return handleDataRetentionComplianceCheck(organizationId);
    // §18 Automation & Scripting tasks
    case 'anomaly_detection':
      return analyticsService.detectAnomalies(organizationId);
    case 'churn_score_computation':
      return analyticsService.computeChurnScores(organizationId);
    case 'remediation_evaluation':
      return automationService.evaluateRemediationRules(organizationId);
    // §21 AI Customer Support tasks
    case 'ai_support_metrics_rollup': {
      const aiSupportMetricsService = require('./aiSupportMetricsService');
      return aiSupportMetricsService.rollupMetrics(organizationId);
    }
    // §7.1/§7.2 FTTH OLT/ONU tasks (seeded by migration 269)
    //
    // ftth_olt_chassis_poll: OLT devices are SNMP-enabled; the generic snmpPoller.poll()
    // already polls all devices with snmp_enabled=1 and stores chassis metrics
    // (cpu_usage, memory_usage, temperature_c, fan_speed_rpm, etc.) into snmp_metrics.
    // Delegating to snmpPoller.poll() is the correct real behavior here.
    case 'ftth_olt_chassis_poll':
      return snmpPoller.poll();
    // ftth_olt_port_metrics_poll: intended to poll SNMP per-port metrics and update
    // olt_ports records. The generic snmpPoller stores to snmp_metrics (not olt_ports),
    // so this requires a dedicated handler that maps port-index OIDs to olt_ports rows.
    // DEFERRED: needs src/services/ftth/oltPortMetricsPollHandler.js.
    case 'ftth_olt_port_metrics_poll':
      logger.warn({ taskName }, 'ftth_olt_port_metrics_poll is not yet implemented; dedicated oltPortMetricsPollHandler needed to map per-port SNMP OIDs to olt_ports rows');
      return { message: 'ftth_olt_port_metrics_poll: handler not yet implemented', deferred: true };
    // ftth_onu_discovery: scans OLT for newly connected ONUs via TL1/NETCONF/CLI.
    // Live device I/O is intentionally stubbed in ftthService (see ftthService.js header).
    // DEFERRED: needs vendor driver + OLT CLI integration.
    case 'ftth_onu_discovery':
      logger.warn({ taskName }, 'ftth_onu_discovery is not yet implemented; requires vendor OLT CLI/TL1/NETCONF driver integration');
      return { message: 'ftth_onu_discovery: handler not yet implemented', deferred: true };
    // ftth_onu_optical_poll: polls per-ONU optical diagnostics (Tx/Rx power, temp,
    // voltage, bias current) and inserts into onu_optical_metrics. The generic
    // snmpPoller writes to snmp_metrics, not onu_optical_metrics, so a dedicated
    // handler is needed to map SNMP varbinds to the onu_optical_metrics schema.
    // DEFERRED: needs src/services/ftth/onuOpticalPollHandler.js.
    case 'ftth_onu_optical_poll':
      logger.warn({ taskName }, 'ftth_onu_optical_poll is not yet implemented; dedicated onuOpticalPollHandler needed to write to onu_optical_metrics table');
      return { message: 'ftth_onu_optical_poll: handler not yet implemented', deferred: true };
    // ftth_onu_firmware_job_processor: picks up pending onu_firmware_jobs and executes
    // via OLT vendor CLI (explicitly stubbed in ftthService.js). A real implementation
    // requires src/services/ftth/drivers/<vendor>Driver.js.
    // DEFERRED: needs vendor driver implementation.
    case 'ftth_onu_firmware_job_processor':
      logger.warn({ taskName }, 'ftth_onu_firmware_job_processor is not yet implemented; requires vendor OLT CLI driver to dispatch pending onu_firmware_jobs');
      return { message: 'ftth_onu_firmware_job_processor: handler not yet implemented', deferred: true };
    // ftth_onu_optical_metrics_cleanup: deletes onu_optical_metrics rows older than
    // 90 days in batches. Pure DB operation — safe to implement directly.
    case 'ftth_onu_optical_metrics_cleanup':
      return runFtthOpticalMetricsCleanup();
    // -------------------------------------------------------------------------
    // Migration-seeded tasks that previously had NO case here and ticked
    // forever as silent 'Unknown task' successes (markTaskRun always writes
    // last_status='success'). Wired where a real implementation exists;
    // explicit deferred stubs otherwise so the gap shows in code and logs.
    // -------------------------------------------------------------------------
    // Seeded by migration 211: flips past-due pending installments to overdue.
    case 'check_installments_due':
      return paymentPlanService.checkInstallmentsDue();
    // Seeded by migration 290 (monthly): accrues unused data-cap GB into
    // rollover balances; org-optional (NULL sweeps all orgs).
    case 'rollover_balance_accrue':
      return rolloverService.accrueRollover(organizationId);
    // Seeded by migration 277: hard-deletes cpe_session_logs older than 90 days.
    case 'cpe_session_log_cleanup':
      return cpeSessionLogService.cleanupOldLogs();
    // apply_speed_windows (migration 201): speedWindowService.applySpeedWindows()
    // exists, but suspensionService.sendRadiusCoA() encodes no rate-limit
    // attributes (radiusCoaEncoder.encodeMikrotikRateLimit exists, unused) —
    // wiring it now would fire a functionally-empty CoA at every windowed
    // contract's NAS every 5 minutes without changing any speed.
    // DEFERRED until the CoA carries the window's rate limits.
    case 'apply_speed_windows':
      logger.warn({ taskName }, 'apply_speed_windows not wired: sendRadiusCoA encodes no rate-limit attributes yet, the CoA would be a no-op');
      return { message: 'apply_speed_windows: deferred — CoA rate-limit encoding not implemented', deferred: true };
    // check_fup_thresholds (migration 290): fupService.applyFupThrottle() sends
    // a CoA and inserts a plan_throttle_logs row with NO idempotency guard — a
    // */15 cron would re-throttle every over-cap contract every tick.
    // DEFERRED until the throttle is idempotent.
    case 'check_fup_thresholds':
      logger.warn({ taskName }, 'check_fup_thresholds not wired: applyFupThrottle has no idempotency guard and would re-throttle every tick');
      return { message: 'check_fup_thresholds: deferred — throttle idempotency needed first', deferred: true };
    // fup_threshold_notify (migration 290): checkAndNotifyThresholds() hard-
    // filters on organization_id, but the seeded row is global (NULL) — needs
    // an all-orgs sweep wrapper. DEFERRED.
    case 'fup_threshold_notify':
      logger.warn({ taskName }, 'fup_threshold_notify not wired: service requires a concrete organization_id; the global row needs an org sweep');
      return { message: 'fup_threshold_notify: deferred — needs an all-orgs iteration wrapper', deferred: true };
    // convert_expired_trials (migration 200): no implementation exists —
    // needs trial-expiry detection (contracts.start_date + plans.trial_days)
    // plus the billing transition. DEFERRED.
    case 'convert_expired_trials':
      logger.warn({ taskName }, 'convert_expired_trials is not yet implemented');
      return { message: 'convert_expired_trials: handler not yet implemented', deferred: true };
    // subscriber_speed_test_run (migration 293): no implementation exists.
    case 'subscriber_speed_test_run':
      logger.warn({ taskName }, 'subscriber_speed_test_run is not yet implemented');
      return { message: 'subscriber_speed_test_run: handler not yet implemented', deferred: true };
    // cpe_cwmp_task_processor / cpe_firmware_campaign_processor (migration 276):
    // seeded against handler paths (services/acs/*) that were never built; CWMP
    // tasks actually dispatch inside the CPE-initiated ACS session
    // (cwmpSessionService), so a standalone batch processor needs its own design.
    case 'cpe_cwmp_task_processor':
      logger.warn({ taskName }, 'cpe_cwmp_task_processor is not yet implemented; CWMP tasks dispatch inside CPE-initiated ACS sessions');
      return { message: 'cpe_cwmp_task_processor: handler not yet implemented', deferred: true };
    case 'cpe_firmware_campaign_processor':
      logger.warn({ taskName }, 'cpe_firmware_campaign_processor is not yet implemented');
      return { message: 'cpe_firmware_campaign_processor: handler not yet implemented', deferred: true };
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
      // generateBillingPeriod may pre-create the NEXT (future) window. Only invoice
      // a pending period once its scheduled billing day has actually arrived —
      // otherwise next cycle's invoice is generated way ahead of time.
      const periodDue = period.scheduled_at ? new Date(period.scheduled_at) <= new Date() : true;
      if (period.status === 'pending' && periodDue) {
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
  // Column is `last_status` ENUM('success','failed','running','skipped','timed_out')
  // — there is no `status` column and no 'completed' value (database/schema.sql).
  await db.query(
    'UPDATE scheduled_tasks SET last_run_at = NOW(), last_status = ? WHERE task_name = ?',
    ['success', taskName],
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

/**
 * Delete onu_optical_metrics rows older than 90 days in batches of 10,000.
 * Keeps the table bounded without a single long-running DELETE.
 * Mirrors the pattern used by retentionService.
 */
async function runFtthOpticalMetricsCleanup() {
  const BATCH_SIZE = 10000;
  let totalDeleted = 0;
  let batchDeleted;

  do {
    const [result] = await db.query(
      `DELETE FROM onu_optical_metrics
       WHERE polled_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
       LIMIT ${BATCH_SIZE}`,
    );
    batchDeleted = result.affectedRows || 0;
    totalDeleted += batchDeleted;
  } while (batchDeleted === BATCH_SIZE);

  return { deleted: totalDeleted };
}

/**
 * Check for overdue DSAR requests and stale government data requests.
 * Surfaces them as a compliance report for operators to action.
 */
async function handleDataRetentionComplianceCheck(organizationId) {
  const orgFilter = organizationId ? 'AND organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [overdue] = await db.query(
    `SELECT id, organization_id, client_id, request_type, due_at
     FROM dsar_requests
     WHERE status IN ('pending', 'in_review')
       AND due_at < NOW()
       ${orgFilter}`,
    params,
  );

  // Check for gov_data_requests that have been processing for >30 days
  const [stalGov] = await db.query(
    `SELECT id, organization_id, authority_name, created_at
     FROM gov_data_requests
     WHERE status IN ('received', 'processing')
       AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
       ${orgFilter}`,
    params,
  );

  return {
    overdue_dsar_requests: overdue.length,
    stale_gov_data_requests: stalGov.length,
    items: { overdue_dsars: overdue, stale_gov_requests: stalGov },
  };
}

module.exports = { listTasks, runTask, markTaskRun, runAutoInvoice, runAutoSuspend, runSuspensionWarnings, runBillingCycle, runCsdExpiryCheck, handleSlaBreachCheck, handleInventoryLowStockCheck, handleDataRetentionComplianceCheck, runFtthOpticalMetricsCleanup };
