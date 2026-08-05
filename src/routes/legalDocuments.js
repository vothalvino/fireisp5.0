// =============================================================================
// FireISP 5.0 — Legal document templates + on-site signing (migration 447)
// =============================================================================
// /document-templates — per-org CRUD of the Markdown legal texts (the ISP's
//   real PROFECO-registered contrato de adhesión, arrival authorization,
//   comodato). Shipping is_active=0; activating a template is what switches
//   the flow hooks on.
// /signed-documents — generated instances: list/read, capture the client's
//   signature, cancel a stale pending one, or generate on demand for an
//   order that predates the templates.
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createDocumentTemplate, updateDocumentTemplate, signDocument, generateDocuments,
} = require('../middleware/schemas/legalDocuments');
const legalDocumentService = require('../services/legalDocumentService');
const auditLog = require('../services/auditLog');

const templatesRouter = Router();
const documentsRouter = Router();

templatesRouter.use(authenticate);
templatesRouter.use(orgScope);
documentsRouter.use(authenticate);
documentsRouter.use(orgScope);

function orgCond(orgId, params, column = 'organization_id') {
  if (orgId === null || orgId === undefined) return `${column} IS NULL`;
  params.push(orgId);
  return `${column} = ?`;
}

// ---------------------------------------------------------------------------
// Templates CRUD
// ---------------------------------------------------------------------------

templatesRouter.get('/', requirePermission('document_templates.view'), async (req, res, next) => {
  try {
    const params = [];
    const cond = orgCond(req.orgId, params);
    const [rows] = await db.query(
      `SELECT * FROM document_templates WHERE ${cond} AND deleted_at IS NULL ORDER BY template_type, id`,
      params,
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

templatesRouter.post('/', requirePermission('document_templates.create'), validate(createDocumentTemplate), async (req, res, next) => {
  try {
    const [ins] = await db.query(
      `INSERT INTO document_templates (organization_id, template_type, name, body_md, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.orgId ?? null, req.body.template_type, req.body.name, req.body.body_md,
        req.body.is_active ? 1 : 0, req.user?.id ?? null],
    );
    const [rows] = await db.query('SELECT * FROM document_templates WHERE id = ?', [ins.insertId]);
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'create',
      tableName: 'document_templates', recordId: ins.insertId, newValues: { name: req.body.name, template_type: req.body.template_type },
    }).catch(() => {});
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

templatesRouter.put('/:id', requirePermission('document_templates.update'), validate(updateDocumentTemplate), async (req, res, next) => {
  try {
    const fields = ['name', 'template_type', 'body_md', 'is_active'].filter(f => f in req.body);
    if (!fields.length) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (f === 'is_active' ? (req.body[f] ? 1 : 0) : req.body[f]));
    const params = [...values, req.params.id];
    const cond = orgCond(req.orgId, params);
    const [result] = await db.query(
      `UPDATE document_templates SET ${sets} WHERE id = ? AND ${cond} AND deleted_at IS NULL`,
      params,
    );
    if (!result.affectedRows) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
    const [rows] = await db.query('SELECT * FROM document_templates WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

templatesRouter.delete('/:id', requirePermission('document_templates.delete'), async (req, res, next) => {
  try {
    const params = [req.params.id];
    const cond = orgCond(req.orgId, params);
    const [result] = await db.query(
      `UPDATE document_templates SET deleted_at = NOW() WHERE id = ? AND ${cond} AND deleted_at IS NULL`,
      params,
    );
    if (!result.affectedRows) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Signed-document instances
// ---------------------------------------------------------------------------

documentsRouter.get('/', requirePermission('signed_documents.view'), async (req, res, next) => {
  try {
    const params = [];
    const conditions = [orgCond(req.orgId, params), 'deleted_at IS NULL'];
    for (const key of ['client_id', 'contract_id', 'service_order_id', 'work_order_id', 'status']) {
      if (req.query[key]) {
        conditions.push(`${key} = ?`);
        params.push(req.query[key]);
      }
    }
    // List WITHOUT the heavy bodies/signatures; GET /:id carries them.
    const [rows] = await db.query(
      `SELECT id, organization_id, client_id, contract_id, service_order_id, work_order_id,
              template_id, template_type, title, content_sha256, status, signer_name, signed_at, created_at
       FROM signed_documents WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 200`,
      params,
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

documentsRouter.get('/:id', requirePermission('signed_documents.view'), async (req, res, next) => {
  try {
    const params = [req.params.id];
    const cond = orgCond(req.orgId, params);
    const [rows] = await db.query(
      `SELECT * FROM signed_documents WHERE id = ? AND ${cond} AND deleted_at IS NULL`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

documentsRouter.post('/:id/sign', requirePermission('signed_documents.sign'), validate(signDocument), async (req, res, next) => {
  try {
    const doc = await legalDocumentService.sign(req.params.id, {
      orgId: req.orgId,
      signerName: req.body.signer_name,
      signatureImage: req.body.signature_image,
      signedIp: req.ip || null,
      performedBy: req.user?.id ?? null,
    });
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'sign',
      tableName: 'signed_documents', recordId: doc.id,
      newValues: { signer_name: doc.signer_name, content_sha256: doc.content_sha256 }, // never the signature image
    }).catch(() => {});
    res.json({ data: doc });
  } catch (err) { next(err); }
});

// Cancel a stale pending instance (e.g. template re-issued). Signed documents
// are immutable history — only pending ones can be cancelled.
documentsRouter.post('/:id/cancel', requirePermission('signed_documents.create'), async (req, res, next) => {
  try {
    const params = [req.params.id];
    const cond = orgCond(req.orgId, params);
    const [result] = await db.query(
      `UPDATE signed_documents SET status = 'cancelled' WHERE id = ? AND ${cond} AND status = 'pending' AND deleted_at IS NULL`,
      params,
    );
    if (!result.affectedRows) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No pending document to cancel' } });
    const [rows] = await db.query('SELECT * FROM signed_documents WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// Generate on demand for an order that predates the templates (or was started
// before a template was activated). Skips types that already have a live
// (pending or signed) instance for the order so re-clicks never duplicate.
documentsRouter.post('/generate', requirePermission('signed_documents.create'), validate(generateDocuments), async (req, res, next) => {
  try {
    const soParams = [req.body.service_order_id];
    const soCond = orgCond(req.orgId, soParams);
    const [soRows] = await db.query(
      `SELECT * FROM service_orders WHERE id = ? AND ${soCond} AND deleted_at IS NULL`,
      soParams,
    );
    const order = soRows[0];
    if (!order) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Service order not found' } });
    if (!order.client_id) return res.status(422).json({ error: { code: 'NO_CLIENT', message: 'Service order has no client yet — start it first' } });

    const [existing] = await db.query(
      `SELECT DISTINCT template_type FROM signed_documents
       WHERE service_order_id = ? AND status IN ('pending', 'signed') AND deleted_at IS NULL`,
      [order.id],
    );
    const have = new Set(existing.map(r => r.template_type));

    const [woRows] = await db.query(
      'SELECT id FROM work_orders WHERE service_order_id = ? AND work_type = \'installation\' AND deleted_at IS NULL ORDER BY id LIMIT 1',
      [order.id],
    );

    const created = await legalDocumentService.generateForOrder(db.query.bind(db), {
      orgId: order.organization_id ?? req.orgId ?? null,
      clientId: order.client_id,
      contractId: order.contract_id || null,
      orderId: order.id,
      workOrderId: woRows[0]?.id || null,
      createdBy: req.user?.id ?? null,
      skipTypes: have,
    });
    res.status(201).json({ data: { generated: created.length, documents: created } });
  } catch (err) { next(err); }
});

module.exports = { templatesRouter, documentsRouter };
