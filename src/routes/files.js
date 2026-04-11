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
const { validate } = require('../middleware/validate');
const { createFile, updateFile } = require('../middleware/schemas/files');
const { uploadSingle, STORAGE_ROOT } = require('../middleware/upload');

const router = Router();
const ctrl = crudController(File);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('files.view'), ctrl.list);
router.get('/:id', requirePermission('files.view'), ctrl.get);

// Upload a file (multipart/form-data with field "file")
router.post('/upload', requirePermission('files.create'), (req, res, next) => {
  uploadSingle(req, res, async (err) => {
    if (err) {
      return res.status(422).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
    }
    if (!req.file) {
      return res.status(422).json({ error: { code: 'UPLOAD_ERROR', message: 'No file provided' } });
    }

    try {
      const record = await File.create({
        organization_id: req.orgId,
        entity_type: req.body.entity_type,
        entity_id: req.body.entity_id ? parseInt(req.body.entity_id, 10) : null,
        category: req.body.category || 'document',
        filename: req.file.originalname,
        stored_path: path.relative(STORAGE_ROOT, req.file.path),
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        notes: req.body.notes || null,
        uploaded_by: req.user.id,
      });

      res.status(201).json({ data: record });
    } catch (createErr) {
      next(createErr);
    }
  });
});

// Download a file by ID
router.get('/:id/download', requirePermission('files.view'), async (req, res, next) => {
  try {
    const file = await File.findByIdOrFail(req.params.id, req.orgId);
    const filePath = path.join(STORAGE_ROOT, file.stored_path || '');
    if (!file.stored_path || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found on disk' } });
    }
    res.download(filePath, file.filename);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('files.create'), validate(createFile), ctrl.create);
router.put('/:id', requirePermission('files.update'), validate(updateFile), ctrl.update);
router.delete('/:id', requirePermission('files.delete'), ctrl.destroy);

module.exports = router;
