// =============================================================================
// FireISP 5.0 — Remote Backup Settings Routes
// =============================================================================
// GET  /backup-settings          — settings (secret masked) + env-fallback
//                                  state + nightly schedule + latest run
// PUT  /backup-settings          — upsert (write-only secret field, three-
//                                  state contract: omit=keep / ""=clear /
//                                  value=re-encrypt+replace); 422 when
//                                  enabling with an incomplete destination
// POST /backup-settings/test     — live probe upload (+ best-effort delete)
//                                  against the effective remote destination
// GET  /backup-settings/runs     — backup run history + local backup files
// GET  /backup-settings/download/:filename — download a local backup file
//                                  (backup_settings.download, migration 406 —
//                                  the file is the whole database, so the act
//                                  has its own slug and is audit-logged)
// POST /backup-settings/run-now  — trigger a manual backup (202; 409 when
//                                  one is already running)
//
// Mounted at /api/v1/backup-settings behind adminIpAllowlist (the dr-drill /
// users / organizations convention — instance-level infrastructure).
// backup_settings.view/backup_settings.update are granted to admin +
// super_admin ONLY (migration 404) — a database-backup credential is
// instance-wide infrastructure, not a business-role-scoped resource.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { updateBackupSettings } = require('../middleware/schemas/backupSettings');
const backupSettingsService = require('../services/backupSettingsService');
const auditLog = require('../services/auditLog');
const logger = require('../utils/logger').child({ service: 'routes/backupSettings' });

const router = Router();
router.use(authenticate);

router.get('/',
  requirePermission('backup_settings.view'),
  async (req, res, next) => {
    try {
      const [settings, schedule, backups] = await Promise.all([
        backupSettingsService.getSettings(),
        backupSettingsService.getSchedule(),
        backupSettingsService.listBackups(),
      ]);
      res.json({ data: { settings, schedule, latest_run: backups.runs[0] || null } });
    } catch (err) {
      next(err);
    }
  },
);

router.put('/',
  requirePermission('backup_settings.update'),
  validate(updateBackupSettings),
  async (req, res, next) => {
    try {
      const settings = await backupSettingsService.saveSettings(req.body);
      logger.info({ userId: req.user?.id }, 'Backup settings updated');
      res.json({ data: settings });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/test',
  requirePermission('backup_settings.update'),
  async (req, res, next) => {
    try {
      const result = await backupSettingsService.testRemote();
      logger.info({ userId: req.user?.id, success: result.success }, 'Backup connection test run');
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/runs',
  requirePermission('backup_settings.view'),
  async (req, res, next) => {
    try {
      const result = await backupSettingsService.listBackups();
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/download/:filename',
  requirePermission('backup_settings.download'),
  async (req, res, next) => {
    try {
      const file = backupSettingsService.resolveBackupFile(req.params.filename);
      // A backup download is a full-database exfiltration by design — always
      // leave an audit trail before a single byte is sent.
      await auditLog.log({
        userId: req.user?.id,
        action: 'download',
        tableName: 'backup_files',
        summary: `Downloaded database backup ${file.filename} (${file.sizeBytes} bytes)`,
      });
      logger.info({ userId: req.user?.id, filename: file.filename, sizeBytes: file.sizeBytes }, 'Backup file downloaded');
      res.download(file.filepath, file.filename);
    } catch (err) {
      next(err);
    }
  },
);

router.post('/run-now',
  requirePermission('backup_settings.update'),
  async (req, res, next) => {
    try {
      const result = await backupSettingsService.runBackupNow();
      logger.info({ userId: req.user?.id }, 'Manual backup triggered');
      res.status(202).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
