// =============================================================================
// FireISP 5.0 — File Routes
// =============================================================================

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const File = require('../models/File');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { uploadSingle, STORAGE_ROOT } = require('../middleware/upload');
const auditLog = require('../services/auditLog');

const router = Router();
const ctrl = crudController(File);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('files.view'), ctrl.list);
router.get('/:id', requirePermission('files.view'), ctrl.get);

// POST /api/files — Upload a file
router.post('/', requirePermission('files.create'), uploadSingle, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file uploaded' } });
    }

    const entityType = req.body.entity_type || 'client';
    const entityId = req.body.entity_id || null;
    const category = req.body.category || 'document';

    const record = await File.create({
      organization_id: req.orgId,
      entity_type: entityType,
      entity_id: entityId,
      category,
      filename: req.file.filename,
      original_filename: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      path: req.file.path,
      storage_provider: 'local',
    });

    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'create',
      tableName: 'files',
      recordId: record.id,
      newValues: { original_filename: req.file.originalname, entity_type: entityType },
    });

    res.status(201).json({ data: record });
  } catch (err) {
    next(err);
  }
});

// GET /api/files/:id/download — Download a file
router.get('/:id/download', requirePermission('files.view'), async (req, res, next) => {
  try {
    const record = await File.findByIdOrFail(req.params.id, req.orgId);
    const filePath = record.path || path.join(STORAGE_ROOT, record.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found on disk' } });
    }

    res.download(filePath, record.original_filename || record.filename);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('files.update'), ctrl.update);
router.delete('/:id', requirePermission('files.delete'), ctrl.destroy);

module.exports = router;
