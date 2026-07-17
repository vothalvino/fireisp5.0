// =============================================================================
// FireISP 5.0 — Backup Run History Model
// =============================================================================
// One row per database-backup execution (nightly scheduled task, manual
// Run-now, DR-drill Phase 1). Written by src/scripts/backup.js; read by the
// /backup-settings/runs endpoint so every backup — and every remote-upload
// failure — is visible in the UI instead of only in server logs.
// =============================================================================

const BaseModel = require('./BaseModel');

class BackupRun extends BaseModel {
  static get tableName() { return 'backup_runs'; }

  static get fillable() {
    return [
      'trigger_source', 'status', 'filename', 'size_bytes',
      'remote_status', 'remote_url', 'error_message', 'finished_at',
    ];
  }

  static get hasOrgScope() { return false; }

  /** Insert a run in 'running' state; returns the new row id. */
  static async start(triggerSource) {
    const db = require('../config/database');
    const [result] = await db.query(
      'INSERT INTO backup_runs (trigger_source, status) VALUES (?, ?)',
      [triggerSource, 'running'],
    );
    return result.insertId;
  }

  /** Finalize a run with its outcome. */
  static async finish(id, { status, filename, sizeBytes, remoteStatus, remoteUrl, errorMessage }) {
    const db = require('../config/database');
    await db.query(
      `UPDATE backup_runs
         SET status = ?, filename = ?, size_bytes = ?, remote_status = ?,
             remote_url = ?, error_message = ?, finished_at = NOW()
       WHERE id = ?`,
      [
        status,
        filename || null,
        sizeBytes ?? null,
        remoteStatus || null,
        remoteUrl || null,
        errorMessage || null,
        id,
      ],
    );
  }

  static async list(limit = 50) {
    const db = require('../config/database');
    // LIMIT is inlined (sanitized integer) — placeholders in LIMIT are
    // unreliable under the execute-backed db.query (see PR #440).
    const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const [rows] = await db.query(
      `SELECT * FROM backup_runs ORDER BY id DESC LIMIT ${n}`,
    );
    return rows;
  }

  static async latest() {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM backup_runs ORDER BY id DESC LIMIT 1',
    );
    return rows[0] || null;
  }
}

module.exports = BackupRun;
