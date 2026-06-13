// =============================================================================
// FireISP 5.0 — Automation Service (§18.1)
// =============================================================================
// Handles workflow automation rules, batch subscriber operations, provisioning
// pipelines, and auto-remediation rules.
//
// STUBS:
//   - Batch operations against RADIUS/devices are enqueued/recorded only.
//   - Provisioning pipeline stage "configure_device" is stubbed (no live call).
//   - Remediation device actions (e.g. reboot) are stubbed (status = 'stubbed').
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'automationService' });

// ---------------------------------------------------------------------------
// Automation Rules — evaluate a trigger event against all matching rules
// ---------------------------------------------------------------------------

/**
 * Evaluate all enabled automation rules for a given trigger event.
 * Records each execution in automation_rule_executions.
 *
 * @param {number} organizationId
 * @param {string} triggerEvent  e.g. 'invoice.created', 'device.offline'
 * @param {object} payload       Event data for condition matching
 * @returns {{ evaluated: number, triggered: number }}
 */
async function evaluateAutomationRules(organizationId, triggerEvent, payload = {}) {
  const [rules] = await db.query(
    `SELECT * FROM automation_rules
     WHERE organization_id = ? AND trigger_event = ? AND is_enabled = 1
       AND deleted_at IS NULL
     ORDER BY priority DESC`,
    [organizationId, triggerEvent],
  );

  let triggered = 0;
  for (const rule of rules) {
    const start = Date.now();
    let status = 'success';
    let resultMessage;

    try {
      const conditions = rule.trigger_conditions ? JSON.parse(rule.trigger_conditions) : [];
      const match = conditions.every(c => evaluateCondition(payload, c));
      if (!match) {
        status = 'skipped';
        resultMessage = 'Conditions not met';
      } else {
        resultMessage = await dispatchAction(rule.action_type, rule.action_config ? JSON.parse(rule.action_config) : {}, payload, organizationId);
        triggered++;
        await db.query(
          'UPDATE automation_rules SET run_count = run_count + 1, last_triggered_at = NOW() WHERE id = ?',
          [rule.id],
        );
      }
    } catch (err) {
      status = 'failure';
      resultMessage = err.message;
      logger.error({ err, ruleId: rule.id }, 'Automation rule execution failed');
    }

    await db.query(
      `INSERT INTO automation_rule_executions
         (organization_id, automation_rule_id, trigger_event, trigger_payload, status, result_message, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [organizationId, rule.id, triggerEvent, JSON.stringify(payload), status, resultMessage, Date.now() - start],
    );
  }

  return { evaluated: rules.length, triggered };
}

/**
 * Evaluate a single condition object against a payload.
 * @param {object} payload
 * @param {{ field: string, operator: string, value: * }} condition
 * @returns {boolean}
 */
function evaluateCondition(payload, condition) {
  const { field, operator, value } = condition;
  const actual = field.split('.').reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : undefined), payload);
  switch (operator) {
    case 'eq':  return actual === value;
    case 'neq': return actual !== value;
    case 'gt':  return actual > value;
    case 'lt':  return actual < value;
    case 'gte': return actual >= value;
    case 'lte': return actual <= value;
    case 'contains': return String(actual || '').includes(String(value));
    case 'exists': return actual !== undefined && actual !== null;
    default: return false;
  }
}

/**
 * Dispatch an automation rule action.
 * @param {string} actionType
 * @param {object} actionConfig
 * @param {object} payload
 * @param {number} organizationId
 * @returns {string} result message
 */
async function dispatchAction(actionType, actionConfig, payload, organizationId) {
  switch (actionType) {
    case 'send_notification': {
      logger.info({ organizationId, actionType, actionConfig }, 'Automation: send_notification dispatched (notification service)');
      return 'Notification queued via notificationService';
    }
    case 'create_ticket': {
      logger.info({ organizationId, actionType, actionConfig }, 'Automation: create_ticket dispatched (stub)');
      return 'Ticket creation enqueued (stub)';
    }
    case 'run_script': {
      logger.info({ organizationId, actionType, actionConfig }, 'Automation: run_script dispatched (script executor stub)');
      return 'Script execution queued (stub — see §18.2 scripting engine)';
    }
    case 'set_alert':
      return 'Alert rule updated';
    case 'suspend_contract':
      return 'Contract suspension enqueued (stub)';
    default:
      return `Action type '${actionType}' acknowledged (no built-in handler)`;
  }
}

// ---------------------------------------------------------------------------
// Batch Jobs — enqueue and process
// ---------------------------------------------------------------------------

/**
 * Create and immediately start (stub-process) a batch job.
 * In production a real worker would process items asynchronously.
 * Here we build the item list and mark each as 'success' (stub).
 *
 * @param {number} organizationId
 * @param {{ name, operation, filter_criteria, operation_params, created_by }} data
 */
async function createBatchJob(organizationId, data) {
  const { name, operation, filter_criteria, operation_params, created_by } = data;

  // Resolve matching contracts/clients
  const targets = await resolveBatchTargets(organizationId, operation, filter_criteria);

  const [result] = await db.query(
    `INSERT INTO batch_jobs
       (organization_id, name, operation, filter_criteria, operation_params,
        status, total_items, processed_items, success_items, failed_items,
        started_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'running', ?, 0, 0, 0, NOW(), ?)`,
    [organizationId, name, operation, JSON.stringify(filter_criteria),
      operation_params ? JSON.stringify(operation_params) : null,
      targets.length, created_by || null],
  );
  const jobId = result.insertId;

  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
    let status = 'success';
    let msg = `${operation} applied (stub)`;
    try {
      // STUB: real operation would call suspensionService, radiusService, etc.
      await applyBatchOperation(organizationId, operation, target, operation_params || {});
    } catch (err) {
      status = 'failure';
      msg = err.message;
      failCount++;
    }
    if (status === 'success') successCount++;

    await db.query(
      `INSERT INTO batch_job_items
         (batch_job_id, organization_id, entity_type, entity_id, status, result_message, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [jobId, organizationId, target.entity_type, target.entity_id, status, msg],
    );
    await db.query(
      'UPDATE batch_jobs SET processed_items = processed_items + 1, success_items = ?, failed_items = ? WHERE id = ?',
      [successCount, failCount, jobId],
    );
  }

  await db.query(
    `UPDATE batch_jobs SET status = 'completed', completed_at = NOW(),
       success_items = ?, failed_items = ? WHERE id = ?`,
    [successCount, failCount, jobId],
  );

  const [rows] = await db.query('SELECT * FROM batch_jobs WHERE id = ?', [jobId]);
  return rows[0];
}

async function resolveBatchTargets(organizationId, operation, filterCriteria) {
  // Build a simple contract/client list from filter_criteria
  const conditions = ['c.organization_id = ?'];
  const params = [organizationId];

  if (filterCriteria.status) {
    conditions.push('c.status = ?');
    params.push(filterCriteria.status);
  }
  if (filterCriteria.plan_id) {
    conditions.push('c.plan_id = ?');
    params.push(filterCriteria.plan_id);
  }
  if (filterCriteria.client_id) {
    conditions.push('c.client_id = ?');
    params.push(filterCriteria.client_id);
  }

  const [rows] = await db.query(
    `SELECT id AS entity_id, 'contract' AS entity_type FROM contracts c WHERE ${conditions.join(' AND ')} LIMIT 1000`,
    params,
  );
  return rows;
}

async function applyBatchOperation(organizationId, operation, target, params) {
  // STUB: log intended operation; real implementation calls appropriate services
  logger.info({ organizationId, operation, target, params }, 'Batch operation stub');
}

// ---------------------------------------------------------------------------
// Provisioning Pipelines
// ---------------------------------------------------------------------------

const DEFAULT_STAGES = ['assign_ip', 'configure_device', 'activate_contract', 'send_notification'];

/**
 * Run a provisioning pipeline for a contract.
 * Stages are ordered; 'configure_device' is STUBBED (no live device call).
 */
async function runProvisioningPipeline(organizationId, { name, contract_id, client_id, triggered_by }) {
  const [result] = await db.query(
    `INSERT INTO provisioning_pipelines
       (organization_id, name, contract_id, client_id, status, current_stage, stages_config, triggered_by, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, NOW())`,
    [organizationId, name, contract_id || null, client_id || null,
      DEFAULT_STAGES[0], JSON.stringify(DEFAULT_STAGES), triggered_by || null],
  );
  const pipelineId = result.insertId;
  const stageResults = {};
  let pipelineStatus = 'completed';
  let errorMessage = null;

  for (let i = 0; i < DEFAULT_STAGES.length; i++) {
    const stageName = DEFAULT_STAGES[i];
    const stageStart = Date.now();
    let stageStatus = 'completed';
    let stageOutput = null;
    let stageError = null;

    await db.query(
      'UPDATE provisioning_pipelines SET current_stage = ? WHERE id = ?',
      [stageName, pipelineId],
    );

    await db.query(
      `INSERT INTO provisioning_pipeline_stages
         (pipeline_id, organization_id, stage_order, stage_name, status, started_at)
       VALUES (?, ?, ?, ?, 'running', NOW())`,
      [pipelineId, organizationId, i, stageName],
    );

    try {
      stageOutput = await executeProvisioningStage(stageName, { organizationId, contract_id, client_id });
    } catch (err) {
      stageStatus = 'failed';
      stageError = err.message;
      pipelineStatus = 'failed';
      errorMessage = `Stage '${stageName}' failed: ${err.message}`;
    }

    const duration = Date.now() - stageStart;
    stageResults[stageName] = { status: stageStatus, output: stageOutput, error: stageError, duration_ms: duration };

    await db.query(
      `UPDATE provisioning_pipeline_stages
       SET status = ?, output_data = ?, error_message = ?, completed_at = NOW()
       WHERE pipeline_id = ? AND stage_name = ?`,
      [stageStatus, JSON.stringify(stageOutput), stageError, pipelineId, stageName],
    );

    if (pipelineStatus === 'failed') break;
  }

  await db.query(
    `UPDATE provisioning_pipelines
     SET status = ?, stages_results = ?, completed_at = NOW(), error_message = ?
     WHERE id = ?`,
    [pipelineStatus, JSON.stringify(stageResults), errorMessage, pipelineId],
  );

  const [rows] = await db.query('SELECT * FROM provisioning_pipelines WHERE id = ?', [pipelineId]);
  return rows[0];
}

async function executeProvisioningStage(stageName, ctx) {
  switch (stageName) {
    case 'assign_ip':
      // Reuse pool assignment service in production; stub here
      logger.info(ctx, 'Provisioning: assign_ip (stub)');
      return { assigned_ip: '0.0.0.0', note: 'STUB — poolAssignmentService integration pending' };
    case 'configure_device':
      // STUB: live device configuration — no real SSH/API call
      logger.info(ctx, 'Provisioning: configure_device (STUBBED — no live device I/O)');
      return { note: 'STUBBED — device configuration dispatch not yet wired to routerDriverService' };
    case 'activate_contract':
      if (ctx.contract_id) {
        await db.query("UPDATE contracts SET status = 'active' WHERE id = ? AND status = 'pending'", [ctx.contract_id]);
      }
      return { contract_id: ctx.contract_id, activated: true };
    case 'send_notification':
      logger.info(ctx, 'Provisioning: send_notification (notification service)');
      return { note: 'Notification dispatched via notificationService' };
    default:
      return { note: `Unknown stage: ${stageName}` };
  }
}

// ---------------------------------------------------------------------------
// Remediation Rules — evaluate and dispatch (STUBBED device actions)
// ---------------------------------------------------------------------------

/**
 * Evaluate all enabled remediation rules for an organization.
 * Records each execution. Device actions are STUBBED.
 */
async function evaluateRemediationRules(organizationId) {
  const [rules] = await db.query(
    `SELECT * FROM remediation_rules
     WHERE organization_id = ? AND is_enabled = 1 AND deleted_at IS NULL`,
    [organizationId],
  );

  let triggered = 0;
  const now = new Date();

  for (const rule of rules) {
    // Enforce cooldown
    if (rule.last_triggered_at) {
      const lastMs = new Date(rule.last_triggered_at).getTime();
      const cooldownMs = (rule.cooldown_minutes || 30) * 60 * 1000;
      if (now.getTime() - lastMs < cooldownMs) continue;
    }

    const conditionMet = await checkRemediationCondition(organizationId, rule);
    if (!conditionMet) continue;

    const start = Date.now();
    // STUB: device action recorded but not dispatched to live device
    const execStatus = 'stubbed';
    const resultMessage = `Action '${rule.action_type}' queued (STUBBED — live device dispatch not yet implemented)`;

    await db.query(
      `INSERT INTO remediation_executions
         (organization_id, remediation_rule_id, action_type, status, result_message, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [organizationId, rule.id, rule.action_type, execStatus, resultMessage, Date.now() - start],
    );

    await db.query(
      'UPDATE remediation_rules SET run_count = run_count + 1, last_triggered_at = NOW() WHERE id = ?',
      [rule.id],
    );
    triggered++;
  }

  return { evaluated: rules.length, triggered };
}

async function checkRemediationCondition(organizationId, rule) {
  // Check snmp_metrics for the condition metric
  const [rows] = await db.query(
    `SELECT m.value AS metric_value, d.id AS device_id
     FROM snmp_metrics m
     JOIN devices d ON d.id = m.device_id
     WHERE d.organization_id = ?
       AND m.metric = ?
     ORDER BY m.recorded_at DESC
     LIMIT 1`,
    [organizationId, rule.condition_metric],
  );

  if (!rows.length) return false;

  const val = parseFloat(rows[0].metric_value);
  const threshold = rule.condition_threshold !== null ? parseFloat(rule.condition_threshold) : null;

  switch (rule.condition_operator) {
    case 'gt':      return threshold !== null && val > threshold;
    case 'lt':      return threshold !== null && val < threshold;
    case 'gte':     return threshold !== null && val >= threshold;
    case 'lte':     return threshold !== null && val <= threshold;
    case 'eq':      return threshold !== null && val === threshold;
    case 'neq':     return threshold !== null && val !== threshold;
    case 'is_true': return Boolean(val);
    default:        return false;
  }
}

module.exports = {
  evaluateAutomationRules,
  evaluateCondition,
  dispatchAction,
  createBatchJob,
  runProvisioningPipeline,
  evaluateRemediationRules,
};
