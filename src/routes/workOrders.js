// =============================================================================
// FireISP 5.0 — Work Order Routes — §12.3
// =============================================================================

const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createWorkOrder, updateWorkOrder, patchWorkOrder } = require('../middleware/schemas/workOrders');
const db = require('../config/database');

// ---------------------------------------------------------------------------
// Multer — work order attachments (disk storage, 20 MB limit)
// ---------------------------------------------------------------------------
const ATTACH_DIR = path.resolve(__dirname, '../../uploads/work-orders');
if (!fs.existsSync(ATTACH_DIR)) fs.mkdirSync(ATTACH_DIR, { recursive: true });

const workOrderAttachUpload = multer({
  storage: multer.diskStorage({
    destination: ATTACH_DIR,
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      cb(null, unique + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
}).single('file');

function uploadAttachment(req, res, next) {
  workOrderAttachUpload(req, res, (err) => {
    if (err) return res.status(422).json({ error: err.message });
    next();
  });
}

const router = Router();

router.use(authenticate);
router.use(orgScope);

// GET /work-orders/stats — MUST be before /:id
router.get('/stats', requirePermission('work_orders.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT status, COUNT(*) AS count
       FROM work_orders
       WHERE organization_id = ? AND deleted_at IS NULL
       GROUP BY status`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Allowlist of own-table (work_orders) columns that are safe to sort by.
const WORK_ORDER_SORTABLE = ['id', 'title', 'status', 'priority', 'work_type', 'scheduled_at', 'created_at', 'updated_at', 'client_id', 'site_id', 'device_id', 'assigned_to'];

// GET /work-orders
router.get('/', requirePermission('work_orders.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    // Validate order_by against the allowlist; joined/derived columns (e.g. assigned_first)
    // are excluded because they are not columns of work_orders itself.
    const safeOrderBy = WORK_ORDER_SORTABLE.includes(req.query.order_by) ? req.query.order_by : 'created_at';
    const safeOrder = req.query.order === 'ASC' ? 'ASC' : 'DESC';

    // Optional filters: by target (client/site/device) or status.
    const where = ['wo.organization_id = ?', 'wo.deleted_at IS NULL'];
    const params = [req.orgId];
    for (const f of ['client_id', 'site_id', 'device_id', 'status']) {
      if (req.query[f] !== undefined && req.query[f] !== null && req.query[f] !== '') { where.push(`wo.${f} = ?`); params.push(req.query[f]); }
    }
    const whereSql = where.join(' AND ');

    const [rows] = await db.query(
      `SELECT wo.*, u.first_name AS assigned_first, u.last_name AS assigned_last,
              c.name AS client_name, s.name AS site_name, d.name AS device_name
       FROM work_orders wo
       LEFT JOIN users u ON u.id = wo.assigned_to
       LEFT JOIN clients c ON c.id = wo.client_id
       LEFT JOIN sites s ON s.id = wo.site_id
       LEFT JOIN devices d ON d.id = wo.device_id
       WHERE ${whereSql}
       ORDER BY wo.${safeOrderBy} ${safeOrder} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM work_orders wo WHERE ${whereSql}`,
      params,
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

// GET /work-orders/:id
router.get('/:id', requirePermission('work_orders.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      `SELECT wo.*, u.first_name AS assigned_first, u.last_name AS assigned_last,
              c.name AS client_name, s.name AS site_name, d.name AS device_name
       FROM work_orders wo
       LEFT JOIN users u ON u.id = wo.assigned_to
       LEFT JOIN clients c ON c.id = wo.client_id
       LEFT JOIN sites s ON s.id = wo.site_id
       LEFT JOIN devices d ON d.id = wo.device_id
       WHERE wo.id = ? AND wo.organization_id = ? AND wo.deleted_at IS NULL`,
      [req.params.id, req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'Work order not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// POST /work-orders
router.post('/', requirePermission('work_orders.create'), validate(createWorkOrder), async (req, res, next) => {
  try {
    const { ticket_id, assigned_to, title, description, status, priority, scheduled_at, latitude, longitude, address, notes,
      client_id, site_id, device_id, contract_id, service_order_id, work_type } = req.body;
    if (!client_id && !site_id && !device_id) {
      return res.status(422).json({ error: 'A work order must target at least one of client, site, or device' });
    }
    const [result] = await db.query(
      `INSERT INTO work_orders
         (organization_id, client_id, site_id, device_id, contract_id, service_order_id, ticket_id, assigned_to, created_by,
          title, description, status, priority, work_type, scheduled_at, latitude, longitude, address, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, client_id || null, site_id || null, device_id || null, contract_id || null, service_order_id || null,
        ticket_id || null, assigned_to || null, req.user.id, title, description || null,
        status || 'pending', priority || 'medium', work_type || 'other', scheduled_at || null,
        latitude || null, longitude || null, address || null, notes || null],
    );
    const [[row]] = await db.query('SELECT * FROM work_orders WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// PUT /work-orders/:id
router.put('/:id', requirePermission('work_orders.update'), validate(updateWorkOrder), async (req, res, next) => {
  try {
    const { ticket_id, assigned_to, title, description, status, priority, scheduled_at, started_at, completed_at, latitude, longitude, address, notes,
      client_id, site_id, device_id, contract_id, service_order_id, work_type } = req.body;
    if (!client_id && !site_id && !device_id) {
      return res.status(422).json({ error: 'A work order must target at least one of client, site, or device' });
    }
    const [result] = await db.query(
      `UPDATE work_orders SET
         client_id=?, site_id=?, device_id=?, contract_id=?, service_order_id=?,
         ticket_id=?, assigned_to=?, title=?, description=?, status=?, priority=?, work_type=?,
         scheduled_at=?, started_at=?, completed_at=?, latitude=?, longitude=?, address=?, notes=?
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [client_id || null, site_id || null, device_id || null, contract_id || null, service_order_id || null,
        ticket_id || null, assigned_to || null, title, description || null, status || 'pending',
        priority || 'medium', work_type || 'other', scheduled_at || null, started_at || null, completed_at || null,
        latitude || null, longitude || null, address || null, notes || null,
        req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Work order not found' });
    const [[row]] = await db.query('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    res.json({ data: row });
  } catch (err) { next(err); }
});

// PATCH /work-orders/:id
router.patch('/:id', requirePermission('work_orders.update'), validate(patchWorkOrder), async (req, res, next) => {
  try {
    const allowed = ['ticket_id','assigned_to','title','description','status','priority','scheduled_at','started_at','completed_at','latitude','longitude','address','notes','client_id','site_id','device_id','contract_id','service_order_id','work_type'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (fields.length === 0) return res.status(422).json({ error: 'No valid fields to update' });
    // If the patch touches any target field, ensure the work order still targets
    // at least one of client/site/device once the change is applied.
    const targetKeys = ['client_id', 'site_id', 'device_id'];
    if (targetKeys.some(k => k in req.body)) {
      const [[cur]] = await db.query(
        'SELECT client_id, site_id, device_id FROM work_orders WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
        [req.params.id, req.orgId],
      );
      if (!cur) return res.status(404).json({ error: 'Work order not found' });
      const merged = targetKeys.map(k => (k in req.body ? req.body[k] : cur[k]));
      if (!merged.some(Boolean)) {
        return res.status(422).json({ error: 'A work order must target at least one of client, site, or device' });
      }
    }
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => req.body[f] ?? null);
    const [result] = await db.query(
      `UPDATE work_orders SET ${sets} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [...values, req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Work order not found' });
    const [[row]] = await db.query('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    res.json({ data: row });
  } catch (err) { next(err); }
});

// DELETE /work-orders/:id
router.delete('/:id', requirePermission('work_orders.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE work_orders SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Work order not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /work-orders/:id/restore
router.post('/:id/restore', requirePermission('work_orders.update'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE work_orders SET deleted_at = NULL WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Work order not found' });
    const [[row]] = await db.query('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    res.json({ data: row });
  } catch (err) { next(err); }
});

// GET /work-orders/:id/materials
router.get('/:id/materials', requirePermission('work_order_materials.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM work_order_materials WHERE work_order_id = ? ORDER BY created_at ASC',
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /work-orders/:id/materials
router.post('/:id/materials', requirePermission('work_order_materials.create'), async (req, res, next) => {
  try {
    const { item_name, quantity, unit, unit_cost, notes } = req.body;
    if (!item_name) return res.status(422).json({ error: 'item_name is required' });
    const [result] = await db.query(
      'INSERT INTO work_order_materials (work_order_id, item_name, quantity, unit, unit_cost, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, item_name, quantity || 1, unit || null, unit_cost || null, notes || null],
    );
    const [[row]] = await db.query('SELECT * FROM work_order_materials WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// DELETE /work-orders/:id/materials/:matId
router.delete('/:id/materials/:matId', requirePermission('work_order_materials.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM work_order_materials WHERE id = ? AND work_order_id = ?',
      [req.params.matId, req.params.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Material not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Work order attachments (§12.3 — installation photos)
// ---------------------------------------------------------------------------
router.get('/:id/attachments', requirePermission('work_order_attachments.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, filename, original_filename, mime_type, file_size, uploaded_by, created_at FROM work_order_attachments WHERE work_order_id = ? AND organization_id = ? ORDER BY created_at DESC',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/attachments', requirePermission('work_order_attachments.create'), uploadAttachment, async (req, res, next) => {
  try {
    if (!req.file) return res.status(422).json({ error: 'No file uploaded' });
    const [result] = await db.query(
      'INSERT INTO work_order_attachments (work_order_id, filename, original_filename, mime_type, file_size, storage_path, uploaded_by, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.file.path, req.user.id, req.orgId],
    );
    const [[row]] = await db.query('SELECT id, filename, original_filename, mime_type, file_size, uploaded_by, created_at FROM work_order_attachments WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

router.delete('/:id/attachments/:attachmentId', requirePermission('work_order_attachments.delete'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT storage_path FROM work_order_attachments WHERE id = ? AND work_order_id = ? AND organization_id = ?',
      [req.params.attachmentId, req.params.id, req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'Attachment not found' });
    await db.query('DELETE FROM work_order_attachments WHERE id = ?', [req.params.attachmentId]);
    fs.unlink(row.storage_path, () => {});
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/:id/attachments/:attachmentId/download', requirePermission('work_order_attachments.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT * FROM work_order_attachments WHERE id = ? AND work_order_id = ? AND organization_id = ?',
      [req.params.attachmentId, req.params.id, req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'Attachment not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${row.original_filename}"`);
    res.setHeader('Content-Type', row.mime_type);
    res.sendFile(row.storage_path);
  } catch (err) { next(err); }
});

module.exports = router;
