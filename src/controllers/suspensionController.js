// =============================================================================
// FireISP 5.0 — Suspension Controller
// =============================================================================
// Domain-specific endpoints for contract suspension / reconnection workflow.
// =============================================================================

const db = require('../config/database');
const suspensionService = require('../services/suspensionService');

/**
 * POST /api/suspension/evaluate
 * Evaluate all suspension rules for the organization and return actionable contracts.
 */
async function evaluate(req, res, next) {
  try {
    const results = await suspensionService.evaluateRules(req.orgId);
    res.json({
      data: results.map(r => ({
        rule_id: r.rule.id,
        rule_action: r.rule.action,
        contract_id: r.contract.id,
        client_id: r.contract.client_id,
        invoice_id: r.contract.invoice_id,
        days_overdue: r.contract.days_overdue,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/suspension/suspend
 * Manually suspend a specific contract.
 */
async function suspend(req, res, next) {
  try {
    const { contract_id, rule_id, invoice_id, action, soft_suspend_download_kbps, soft_suspend_upload_kbps } = req.body;

    // Verify contract belongs to org
    const [contracts] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ?',
      [contract_id, req.orgId],
    );
    if (!contracts[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    if (contracts[0].status === 'suspended') {
      return res.status(422).json({ error: { code: 'ALREADY_SUSPENDED', message: 'Contract is already suspended' } });
    }

    if (action === 'soft_suspend') {
      const outcome = await suspensionService.softSuspendContract(
        contract_id, rule_id || null, req.user.id, invoice_id || null,
        soft_suspend_download_kbps || 128,
        soft_suspend_upload_kbps || 128,
      );
      if (outcome?.skipped) {
        return res.json({ data: { contract_id, status: 'skipped', reason: outcome.reason } });
      }
      return res.json({ data: { contract_id, status: 'soft_suspended' } });
    }

    const outcome = await suspensionService.suspendContract(contract_id, rule_id || null, req.user.id, invoice_id || null);
    if (outcome?.skipped) {
      return res.json({ data: { contract_id, status: 'skipped', reason: outcome.reason } });
    }
    res.json({ data: { contract_id, status: 'suspended' } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/suspension/reconnect
 * Reconnect a suspended contract.
 */
async function reconnect(req, res, next) {
  try {
    const { contract_id, invoice_id } = req.body;

    const [contracts] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ?',
      [contract_id, req.orgId],
    );
    if (!contracts[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    if (contracts[0].status !== 'suspended') {
      return res.status(422).json({ error: { code: 'NOT_SUSPENDED', message: 'Contract is not suspended' } });
    }

    await suspensionService.reconnectContract(contract_id, req.user.id, invoice_id || null);
    res.json({ data: { contract_id, status: 'active' } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/suspension/run-auto
 * Trigger the auto-suspend job manually for the organization.
 */
async function runAuto(req, res, next) {
  try {
    const results = await suspensionService.evaluateRules(req.orgId);
    let suspended = 0;

    for (const { rule, contract } of results) {
      if (rule.action === 'auto_suspend') {
        const outcome = await suspensionService.suspendContract(
          contract.id, rule.id, req.user.id, contract.invoice_id,
        );
        if (!outcome?.skipped) suspended++;
      } else if (rule.action === 'soft_suspend') {
        const outcome = await suspensionService.softSuspendContract(
          contract.id, rule.id, req.user.id, contract.invoice_id,
          rule.soft_suspend_download_kbps || 128,
          rule.soft_suspend_upload_kbps || 128,
        );
        if (!outcome?.skipped) suspended++;
      }
    }

    res.json({ data: { contracts_evaluated: results.length, contracts_suspended: suspended } });
  } catch (err) {
    next(err);
  }
}

module.exports = { evaluate, suspend, reconnect, runAuto };
