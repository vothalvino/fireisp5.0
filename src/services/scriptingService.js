// =============================================================================
// FireISP 5.0 — Scripting Service (§18.2)
// =============================================================================
// Manages the script library and execution records.
//
// SECURITY CRITICAL: Scripts are stored in the database but NEVER executed via
// child_process.exec/execSync/spawn or eval. The "run" endpoint creates an
// execution record with status 'queued'. A real sandboxed executor (e.g. a
// separate worker process with strict resource limits and no filesystem access)
// is explicitly OUT OF SCOPE for §18 and would be wired here in a later phase.
//
// NO child_process calls anywhere in this file. grep for exec/spawn/eval = zero.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'scriptingService' });

/**
 * List scripts visible to an organization.
 * Returns org-owned scripts + shared/community scripts.
 */
async function listScripts(organizationId, { page = 1, limit = 50, language, is_shared } = {}) {
  const conditions = ['(organization_id = ? OR is_shared = 1) AND deleted_at IS NULL'];
  const params = [organizationId];

  if (language) { conditions.push('language = ?'); params.push(language); }
  if (is_shared !== undefined) { conditions.push('is_shared = ?'); params.push(is_shared ? 1 : 0); }

  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
  const safeOffset = Math.max(0, (Math.max(1, parseInt(page, 10)) - 1) * safeLimit);
  const [rows] = await db.query(
    `SELECT * FROM automation_scripts WHERE ${conditions.join(' AND ')}
     ORDER BY is_shared DESC, name ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );
  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM automation_scripts WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return { data: rows, total: countResult[0].total };
}

/**
 * Create a new script. Only admins should call this (enforced by route RBAC).
 */
async function createScript(organizationId, data, userId) {
  const [result] = await db.query(
    `INSERT INTO automation_scripts
       (organization_id, name, description, language, script_body, version,
        is_shared, tags, scheduled_task_id, api_endpoint, created_by)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [organizationId, data.name, data.description || null, data.language || 'bash',
      data.script_body, data.is_shared ? 1 : 0,
      data.tags ? JSON.stringify(data.tags) : null,
      data.scheduled_task_id || null, data.api_endpoint || null, userId || null],
  );
  const [rows] = await db.query('SELECT * FROM automation_scripts WHERE id = ?', [result.insertId]);
  return rows[0];
}

/**
 * Update a script body — bumps version number.
 */
async function updateScript(scriptId, organizationId, data) {
  const [existing] = await db.query(
    'SELECT * FROM automation_scripts WHERE id = ? AND (organization_id = ? OR is_shared = 1) AND deleted_at IS NULL',
    [scriptId, organizationId],
  );
  if (!existing.length) return null;

  const fields = [];
  const params = [];
  const allowed = ['name', 'description', 'language', 'script_body', 'is_shared', 'tags', 'scheduled_task_id', 'api_endpoint'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`\`${key}\` = ?`);
      params.push(key === 'tags' && Array.isArray(data[key]) ? JSON.stringify(data[key]) : data[key]);
    }
  }
  if (data.script_body !== undefined) {
    fields.push('version = version + 1');
  }
  if (!fields.length) return existing[0];

  params.push(scriptId);
  await db.query(`UPDATE automation_scripts SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM automation_scripts WHERE id = ?', [scriptId]);
  return rows[0];
}

/**
 * Attempt to execute a script.
 *
 * NOT IMPLEMENTED: The sandboxed script execution engine is not enabled.
 * This function rejects with a clear error so callers are never led to
 * believe a script will run when it won't.
 *
 * A sandboxed executor (separate worker process with strict resource limits)
 * is required before this can be enabled. Wire it here and remove the guard.
 *
 * If the environment variable SCRIPT_EXECUTION_ENABLED is set to 'true',
 * this function records a 'queued' row for a future executor to pick up.
 * By default that variable is absent and this rejects immediately.
 */
async function executeScript(scriptId, organizationId, { input_params, triggered_by } = {}) {
  const [scripts] = await db.query(
    'SELECT * FROM automation_scripts WHERE id = ? AND (organization_id = ? OR is_shared = 1) AND deleted_at IS NULL',
    [scriptId, organizationId],
  );
  if (!scripts.length) return null;

  const script = scripts[0];

  // Guard: reject unless an executor is explicitly enabled via env var.
  if (process.env.SCRIPT_EXECUTION_ENABLED !== 'true') {
    logger.warn(
      { scriptId, organizationId, language: script.language },
      'Script execution rejected: sandboxed execution engine not enabled (SCRIPT_EXECUTION_ENABLED != true)',
    );
    const err = new Error(
      'Script execution engine is not enabled. ' +
      'A sandboxed executor must be configured before scripts can run. ' +
      'Set SCRIPT_EXECUTION_ENABLED=true only when a real sandboxed worker is deployed.',
    );
    err.code = 'SCRIPT_EXECUTION_NOT_ENABLED';
    err.statusCode = 501;
    throw err;
  }

  // Only reached when SCRIPT_EXECUTION_ENABLED=true — record for executor pickup.
  const [result] = await db.query(
    `INSERT INTO script_executions
       (organization_id, script_id, status, triggered_by, input_params)
     VALUES (?, ?, 'queued', ?, ?)`,
    [organizationId, scriptId, triggered_by || null,
      input_params ? JSON.stringify(input_params) : null],
  );

  logger.info(
    { scriptId, organizationId, executionId: result.insertId, language: script.language },
    'Script execution queued for sandboxed executor',
  );

  const [rows] = await db.query('SELECT * FROM script_executions WHERE id = ?', [result.insertId]);
  return rows[0];
}

/**
 * List script executions for an organization.
 */
async function listExecutions(organizationId, { script_id, status, page = 1, limit = 50 } = {}) {
  const conditions = ['se.organization_id = ?'];
  const params = [organizationId];

  if (script_id) { conditions.push('se.script_id = ?'); params.push(script_id); }
  if (status)    { conditions.push('se.status = ?');    params.push(status); }

  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
  const safeOffset = Math.max(0, (Math.max(1, parseInt(page, 10)) - 1) * safeLimit);
  const [rows] = await db.query(
    `SELECT se.*, s.name AS script_name, s.language
     FROM script_executions se
     JOIN automation_scripts s ON s.id = se.script_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY se.created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );
  const [countResult] = await db.query(
    `SELECT COUNT(*) AS total FROM script_executions se WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return { data: rows, total: countResult[0].total };
}

module.exports = { listScripts, createScript, updateScript, executeScript, listExecutions };
