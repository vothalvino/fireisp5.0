// =============================================================================
// FireISP 5.0 — Client Routes
// =============================================================================

const { Router } = require('express');
const Client = require('../models/Client');
const ClientBalanceLedger = require('../models/ClientBalanceLedger');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createClient, updateClient, patchClient, createContact, updateMxProfile, setCustomField, mergeClient, geocodeClient } = require('../middleware/schemas/clients');
const { httpCache, bustCache } = require('../middleware/httpCache');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { quotaCheck } = require('../middleware/checkQuota');
const { uploadClientDocument, STORAGE_ROOT } = require('../middleware/upload');
const paymentAllocationService = require('../services/paymentAllocationService');
const auditLog = require('../services/auditLog');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(Client, { cacheResource: 'clients' });

router.use(authenticate);
router.use(orgScope);

// List clients with optional free-text search (partial name/email/phone, exact
// numeric id) and a client_group_id filter. Falls back to identical behaviour to
// the generic list when neither is supplied.
// Allowlist of own-table columns that are safe to sort by.
const CLIENT_SORTABLE = ['id', 'name', 'email', 'phone', 'client_type', 'status', 'created_at', 'updated_at'];

router.get('/', requirePermission('clients.view'), httpCache('clients', 60), async (req, res, next) => {
  try {
    const { search, client_group_id, page = 1, limit = 50, include_deleted, order_by, order } = req.query;
    const conditions = [];
    const params = [];
    if (Client.hasOrgScope && req.orgId) {
      conditions.push('c.organization_id = ?');
      params.push(req.orgId);
    }
    if (include_deleted !== 'true') conditions.push('c.deleted_at IS NULL');

    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
      // Partial match on name/email/phone; exact match on the numeric id.
      conditions.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR CAST(c.id AS CHAR) = ?)');
      params.push(`%${term}%`, `%${term}%`, `%${term}%`, term);
    }
    if (client_group_id) {
      conditions.push('c.client_group_id = ?');
      params.push(client_group_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    // Validate order_by against the allowlist to prevent SQL injection;
    // fall back to created_at if the supplied value is not in the list.
    const safeOrderBy = CLIENT_SORTABLE.includes(order_by) ? order_by : 'created_at';
    const safeOrder = order === 'ASC' ? 'ASC' : 'DESC';

    // Resolve the account-group name server-side (LEFT JOIN) so the UI doesn't
    // depend on a capped client-side group list. LIMIT/OFFSET inlined as validated
    // ints (never bound — mysqld_stmt_execute rejects placeholder LIMIT); all
    // filter VALUES stay bound.
    const [rows] = await db.query(
      `SELECT c.*, cg.name AS client_group_name
         FROM clients c
         LEFT JOIN client_groups cg ON cg.id = c.client_group_id AND cg.deleted_at IS NULL
         ${where} ORDER BY c.${safeOrderBy} ${safeOrder} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM clients c ${where}`,
      params,
    );

    res.json({
      data: rows,
      meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    });
  } catch (err) {
    next(err);
  }
});
router.get('/:id', requirePermission('clients.view'), ctrl.get);
router.post('/', requirePermission('clients.create'), quotaCheck('clients'), validate(createClient), ctrl.create);
router.put('/:id', requirePermission('clients.update'), validate(updateClient), ctrl.update);
router.patch('/:id', requirePermission('clients.update'), validate(patchClient), ctrl.partialUpdate);
router.delete('/:id', requirePermission('clients.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('clients.update'), ctrl.restore);

// Contacts sub-routes
router.get('/:id/contacts', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const contacts = await Client.getContacts(req.params.id);
    res.json({ data: contacts });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/contacts', requirePermission('clients.update'), validate(createContact), async (req, res, next) => {
  try {
    const { name, email, phone, role } = req.body;
    // The contacts table stores first_name + last_name (both NOT NULL), but the
    // UI sends a single `name`. Insert into `name` failed with "Unknown column".
    // Split on the first space ("Ada Lovelace" -> 'Ada','Lovelace'); a single-word
    // name keeps last_name = '' (the GraphQL Contact.name resolver recombines them).
    const fullName = String(name || '').trim();
    const sep = fullName.indexOf(' ');
    const firstName = sep === -1 ? fullName : fullName.slice(0, sep);
    const lastName = sep === -1 ? '' : fullName.slice(sep + 1).trim();
    const [result] = await db.query(
      'INSERT INTO contacts (client_id, first_name, last_name, email, phone, role) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, firstName, lastName, email || null, phone || null, role || null],
    );
    const [rows] = await db.query('SELECT * FROM contacts WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Soft-delete a client contact.
router.delete('/:id/contacts/:contactId', requirePermission('clients.update'), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);  // 404s if the client isn't in this org
    const [result] = await db.query(
      'UPDATE contacts SET deleted_at = NOW() WHERE id = ? AND client_id = ? AND deleted_at IS NULL',
      [req.params.contactId, req.params.id],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// MX Profile sub-routes.
// SECURITY: getMxProfile queries client_mx_profiles by client_id alone, so
// without the org-ownership check first, any caller with clients.view could
// read (or with clients.update, overwrite) another org's client RFC/CURP by
// iterating ids — a cross-tenant PII leak. findByIdOrFail 404s foreign ids.
router.get('/:id/mx-profile', requirePermission('clients.view'), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);
    const profile = await Client.getMxProfile(req.params.id);
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/mx-profile', requirePermission('clients.update'), validate(updateMxProfile), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);
    const { rfc, curp, razon_social, regimen_fiscal, codigo_postal_fiscal } = req.body;
    const existing = await Client.getMxProfile(req.params.id);

    if (existing) {
      await db.query(
        `UPDATE client_mx_profiles SET rfc = ?, curp = ?, razon_social = ?,
         regimen_fiscal = ?, codigo_postal_fiscal = ? WHERE client_id = ? AND deleted_at IS NULL`,
        [rfc, curp, razon_social, regimen_fiscal, codigo_postal_fiscal, req.params.id],
      );
    } else {
      await db.query(
        `INSERT INTO client_mx_profiles (client_id, rfc, curp, razon_social, regimen_fiscal, codigo_postal_fiscal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.params.id, rfc, curp, razon_social, regimen_fiscal, codigo_postal_fiscal],
      );
    }

    const profile = await Client.getMxProfile(req.params.id);
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
});

// Client contracts
router.get('/:id/contracts', requirePermission('contracts.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM contracts WHERE client_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Client invoices
router.get('/:id/invoices', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM invoices WHERE client_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Client's payable open invoices with a computed, live balance_due — the data
// source for RecordPaymentModal's invoice checklist (auto-fill amount +
// FIFO order preview). Shared query with POST /payments/:id/allocate-auto
// (src/services/paymentAllocationService.js) so what the checklist shows is
// exactly what gets paid first.
router.get('/:id/open-invoices', requirePermission('invoices.view'), async (req, res, next) => {
  try {
    const rows = await paymentAllocationService.getInvoicesWithBalance(
      db.query.bind(db), req.orgId, req.params.id, null, false,
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Client balance ledger
router.get('/:id/balance-ledger', requirePermission('clients.view'), async (req, res, next) => {
  try {
    // running_balance is computed on read: the stored column is left at 0.00 by
    // the amount-based writers (invoice/payment/credit_note/gateway); only the
    // refund path sets debit/credit. The signed expression reconciles both.
    const signed = ClientBalanceLedger.signedAmountSql;
    const [rows] = await db.query(
      `SELECT id, organization_id, client_id, entry_type, amount, currency,
              reference_type, reference_id, description, created_at,
              SUM(${signed}) OVER (ORDER BY created_at, id) AS running_balance
         FROM client_balance_ledger
        WHERE client_id = ? AND organization_id = ?
        ORDER BY created_at DESC, id DESC`,
      [req.params.id, req.orgId],
    );
    // Current balance = running_balance of the most-recent entry (rows are DESC).
    const balance = rows.length ? String(rows[0].running_balance) : '0';
    res.json({ data: rows, meta: { balance } });
  } catch (err) { next(err); }
});

// Client activity timeline — unified interactions/tickets/payments/emails/SMS feed (§1.3)
router.get('/:id/timeline', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const interactionService = require('../services/interactionService');
    const { userHasPermission } = require('../middleware/rbac');
    const timeline = await interactionService.activityTimeline(req.params.id, req.orgId, {
      limit: req.query.limit,
      // Billing-category tickets are gated by tickets.view_billing (mig 394)
      includeBillingTickets: await userHasPermission(req, 'tickets.view_billing'),
    });
    res.json({ data: timeline });
  } catch (err) { next(err); }
});

// Set / reset portal password for a client (admin action)
router.put('/:id/portal-password', requirePermission('clients.update'), async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new ValidationError('password must be at least 8 characters');
    }
    const portalAuthService = require('../services/portalAuthService');
    // Verify this client belongs to this org
    const [rows] = await db.query(
      'SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows[0]) throw new NotFoundError('Client');

    await portalAuthService.setPassword(req.params.id, password);
    res.json({ message: 'Portal password updated' });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Custom fields (unlimited key/value pairs) — §1.1
// ---------------------------------------------------------------------------
router.get('/:id/custom-fields', requirePermission('clients.view'), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);
    const fields = await Client.getCustomFields(req.params.id);
    res.json({ data: fields });
  } catch (err) { next(err); }
});

router.put('/:id/custom-fields', requirePermission('clients.update'), validate(setCustomField), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);
    const field = await Client.setCustomField(req.params.id, req.body.field_key, req.body.field_value ?? null);
    await bustCache(req.orgId, 'clients');
    res.json({ data: field });
  } catch (err) { next(err); }
});

router.delete('/:id/custom-fields/:key', requirePermission('clients.update'), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);
    const removed = await Client.deleteCustomField(req.params.id, req.params.key);
    if (!removed) throw new NotFoundError('Custom field');
    await bustCache(req.orgId, 'clients');
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// ID documents / photos (INE, passport, etc.) — §1.1 — backed by files table
// ---------------------------------------------------------------------------
router.get('/:id/documents', requirePermission('clients.view'), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);
    const docs = await Client.getDocuments(req.params.id);
    res.json({ data: docs });
  } catch (err) { next(err); }
});

router.post('/:id/documents', requirePermission('clients.update'), (req, res, next) => {
  uploadClientDocument(req, res, async (err) => {
    if (err) {
      return res.status(422).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
    }
    if (!req.file) {
      return res.status(422).json({ error: { code: 'UPLOAD_ERROR', message: 'No file provided' } });
    }
    try {
      await Client.findByIdOrFail(req.params.id, req.orgId);
      const category = req.body.category === 'notification_log' ? 'notification_log' : 'client_file';
      const relPath = path.relative(STORAGE_ROOT, req.file.path);
      const [result] = await db.query(
        `INSERT INTO files (entity_type, entity_id, category, file_name, file_path, file_size, mime_type, uploaded_by, notes)
         VALUES ('client', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.params.id, category, req.file.originalname, relPath, req.file.size, req.file.mimetype, req.user?.id || null, req.body.notes || null],
      );
      const [rows] = await db.query('SELECT * FROM files WHERE id = ?', [result.insertId]);
      res.status(201).json({ data: rows[0] });
    } catch (createErr) {
      // Best-effort cleanup of the orphaned upload if the DB insert failed.
      try { if (req.file) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      next(createErr);
    }
  });
});

router.get('/:id/documents/:fileId/download', requirePermission('clients.view'), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);
    const [rows] = await db.query(
      'SELECT * FROM files WHERE id = ? AND entity_type = \'client\' AND entity_id = ? AND deleted_at IS NULL',
      [req.params.fileId, req.params.id],
    );
    const file = rows[0];
    if (!file) throw new NotFoundError('Document');
    const filePath = path.join(STORAGE_ROOT, file.file_path || '');
    if (!file.file_path || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found on disk' } });
    }
    res.download(filePath, file.file_name);
  } catch (err) { next(err); }
});

router.delete('/:id/documents/:fileId', requirePermission('clients.update'), async (req, res, next) => {
  try {
    await Client.findByIdOrFail(req.params.id, req.orgId);
    const [result] = await db.query(
      'UPDATE files SET deleted_at = NOW() WHERE id = ? AND entity_type = \'client\' AND entity_id = ? AND deleted_at IS NULL',
      [req.params.fileId, req.params.id],
    );
    if (result.affectedRows === 0) throw new NotFoundError('Document');
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Geocoding — resolve the service address to GPS coordinates — §1.1
// ---------------------------------------------------------------------------
router.post('/:id/geocode', requirePermission('clients.update'), validate(geocodeClient), async (req, res, next) => {
  try {
    const client = await Client.findByIdOrFail(req.params.id, req.orgId);
    const { geocodeAddress } = require('../services/geocodingService');
    const source = {
      address: req.body.address ?? client.address,
      city: req.body.city ?? client.city,
      state: req.body.state ?? client.state,
      zip_code: req.body.zip_code ?? client.zip_code,
      country: req.body.country ?? client.country,
    };
    const result = await geocodeAddress(source);
    const updated = await Client.update(
      req.params.id,
      { latitude: result.latitude, longitude: result.longitude, geocoded_at: new Date() },
      req.orgId,
    );
    await bustCache(req.orgId, 'clients');
    res.json({ data: updated, geocode: result });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Duplicate detection & account merging — §1.1
// ---------------------------------------------------------------------------
// Global scan: find clients matching the supplied email/phone/tax_id.
router.get('/duplicates/scan', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const { email, phone, tax_id } = req.query;
    const matches = await Client.findDuplicates({ email, phone, tax_id, orgId: req.orgId });
    res.json({ data: matches });
  } catch (err) { next(err); }
});

// Per-client: find other clients that look like duplicates of :id.
router.get('/:id/duplicates', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const client = await Client.findByIdOrFail(req.params.id, req.orgId);
    const matches = await Client.findDuplicates({
      email: client.email,
      phone: client.phone,
      tax_id: client.tax_id,
      excludeId: client.id,
      orgId: req.orgId,
    });
    res.json({ data: matches });
  } catch (err) { next(err); }
});

// Merge: fold body.source_id into the :id client (the survivor), then archive source.
router.post('/:id/merge', requirePermission('clients.delete'), validate(mergeClient), async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const sourceId = req.body.source_id;
    const result = await Client.merge(sourceId, targetId, req.orgId);
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'merge',
      tableName: 'clients',
      recordId: parseInt(targetId, 10),
      newValues: { source_id: sourceId, target_id: parseInt(targetId, 10), moved: result.moved },
    });
    await bustCache(req.orgId, 'clients');
    res.json({ data: { target_id: parseInt(targetId, 10), source_id: sourceId, ...result } });
  } catch (err) { next(err); }
});

module.exports = router;
