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
const privacyNoticeService = require('../services/privacyNoticeService');
const mxRegisteredTemplateService = require('../services/mxRegisteredContractTemplateService');
const auditLog = require('../services/auditLog');
const Organization = require('../models/Organization');
const { ValidationError, NotFoundError } = require('../utils/errors');

const templatesRouter = Router();
const documentsRouter = Router();

templatesRouter.use(authenticate);
templatesRouter.use(orgScope);
documentsRouter.use(authenticate);
documentsRouter.use(orgScope);

// STRICTLY MX (user decision, 2026-08-05): the legal-paper surface exists for
// Mexican organizations only. Templates and generation are refused elsewhere;
// reading/signing EXISTING instances stays allowed everywhere — signed
// documents are immutable history that must survive an org's locale changing.
async function requireMxOrg(req, res, next) {
  try {
    const locale = req.orgId ? await Organization.getLocale(req.orgId) : 'global';
    if (locale === 'MX') return next();
    return res.status(403).json({
      error: { code: 'MX_ONLY', message: 'Legal document templates are available for MX-locale organizations only.' },
    });
  } catch (err) { return next(err); }
}
templatesRouter.use(requireMxOrg);

function orgCond(orgId, params, column = 'organization_id') {
  if (orgId === null || orgId === undefined) return `${column} IS NULL`;
  params.push(orgId);
  return `${column} = ?`;
}

async function lockTemplateOrganization(conn, orgId) {
  if (orgId === null || orgId === undefined) return;
  const [rows] = await conn.query(
    'SELECT id FROM organizations WHERE id = ? FOR UPDATE',
    [orgId],
  );
  if (!rows[0]) throw new NotFoundError('Organization');
}

async function assertActiveLaneSourceConsistency(conn, {
  orgId, environment, contractTemplateMxId, excludeTemplateId = null,
}) {
  if (!environment || !contractTemplateMxId) return;
  const params = [orgId, environment];
  let exclude = '';
  if (excludeTemplateId !== null && excludeTemplateId !== undefined) {
    exclude = ' AND dt.id <> ?';
    params.push(excludeTemplateId);
  }
  const [activeTemplates] = await conn.query(
    `SELECT dt.*${mxRegisteredTemplateService.joinedRegistrationColumns('ctm')}
       FROM document_templates dt
       LEFT JOIN contract_templates_mx ctm ON ctm.id = dt.contract_template_mx_id
      WHERE dt.organization_id = ? AND dt.template_type = 'activation_contract'
        AND dt.is_active = 1 AND dt.deleted_at IS NULL
        AND (ctm.id IS NULL OR ctm.environment = ?)${exclude}
      ORDER BY dt.id FOR UPDATE`,
    params,
  );
  const existing = mxRegisteredTemplateService.assertOneRegisteredSource(
    activeTemplates,
    orgId,
    environment,
  );
  if (existing && existing.contractTemplateMxId !== Number(contractTemplateMxId)) {
    throw new ValidationError(
      `All active MX activation documents in the ${environment} environment must reference the same contract source`,
    );
  }
}

// ---------------------------------------------------------------------------
// Templates CRUD
// ---------------------------------------------------------------------------

templatesRouter.get('/', requirePermission('document_templates.view'), async (req, res, next) => {
  try {
    const params = [];
    const cond = orgCond(req.orgId, params, 'dt.organization_id');
    const [rows] = await db.query(
      `SELECT dt.*,
              ctm.environment AS contract_template_mx_environment,
              ctm.status AS contract_template_mx_status
         FROM document_templates dt
         LEFT JOIN contract_templates_mx ctm ON ctm.id = dt.contract_template_mx_id
        WHERE ${cond}
          AND dt.deleted_at IS NULL
        ORDER BY dt.template_type, dt.id`,
      params,
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

templatesRouter.post('/', requirePermission('document_templates.create'), validate(createDocumentTemplate), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await lockTemplateOrganization(conn, req.orgId);
    legalDocumentService.assertSupportedPlaceholders(req.body.body_md);
    const sourceSnapshot = await mxRegisteredTemplateService.validateTemplateState(conn.query.bind(conn), {
      orgId: req.orgId,
      templateType: req.body.template_type,
      bodyMd: req.body.body_md,
      isActive: Boolean(req.body.is_active),
      contractTemplateMxId: req.body.contract_template_mx_id ?? null,
      lock: true,
    });
    if (req.body.template_type === 'activation_contract' && Boolean(req.body.is_active)) {
      await assertActiveLaneSourceConsistency(conn, {
        orgId: req.orgId,
        environment: sourceSnapshot.contractEnvironment,
        contractTemplateMxId: sourceSnapshot.contractTemplateMxId,
      });
    }
    const [ins] = await conn.query(
      `INSERT INTO document_templates
         (organization_id, template_type, name, body_md, contract_template_mx_id, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId ?? null, req.body.template_type, req.body.name, req.body.body_md,
        req.body.contract_template_mx_id ?? null, req.body.is_active ? 1 : 0, req.user?.id ?? null],
    );
    const [rows] = await conn.query('SELECT * FROM document_templates WHERE id = ?', [ins.insertId]);
    await conn.commit();
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'create',
      tableName: 'document_templates', recordId: ins.insertId, newValues: { name: req.body.name, template_type: req.body.template_type },
    }).catch(() => {});
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

templatesRouter.put('/:id', requirePermission('document_templates.update'), validate(updateDocumentTemplate), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await lockTemplateOrganization(conn, req.orgId);
    const fields = ['name', 'template_type', 'body_md', 'contract_template_mx_id', 'is_active']
      .filter(f => f in req.body);
    if (!fields.length) throw new ValidationError('No fields to update');

    const templateParams = [req.params.id];
    const templateCond = orgCond(req.orgId, templateParams);
    const [templates] = await conn.query(
      `SELECT * FROM document_templates
        WHERE id = ? AND ${templateCond} AND deleted_at IS NULL
        FOR UPDATE`,
      templateParams,
    );
    const template = templates[0];
    if (!template) throw new NotFoundError('Template');

    const materialFields = ['name', 'template_type', 'body_md', 'contract_template_mx_id'];
    const changedMaterial = materialFields.filter(field => (
      Object.prototype.hasOwnProperty.call(req.body, field)
      && String(req.body[field]) !== String(template[field])
    ));
    if (changedMaterial.length && Number(template.is_active) === 1) {
      throw new ValidationError(
        'Deactivate this template before changing legal content; activate a new template ID for a new reviewed version',
      );
    }
    if (changedMaterial.length) {
      // No status/deletion filter is intentional: once any frozen instance
      // references this ID, its source metadata is permanent history. Staff
      // can toggle is_active, then create a new template/version ID.
      const [instances] = await conn.query(
        'SELECT id FROM signed_documents WHERE template_id = ? LIMIT 1',
        [template.id],
      );
      if (instances[0]) {
        throw new ValidationError(
          'This template already has a generated document and its legal content is permanently immutable; create a new template version',
        );
      }
    }

    const nextTemplate = { ...template, ...req.body };
    const isActivating = Number(template.is_active) !== 1 && Boolean(nextTemplate.is_active);
    if (changedMaterial.includes('body_md') || isActivating) {
      legalDocumentService.assertSupportedPlaceholders(nextTemplate.body_md);
    }
    const allowTerminalSourceForDeactivation = Number(template.is_active) === 1
      && Number(nextTemplate.is_active) === 0
      && changedMaterial.length === 0;
    const sourceSnapshot = await mxRegisteredTemplateService.validateTemplateState(conn.query.bind(conn), {
      orgId: req.orgId,
      templateType: nextTemplate.template_type,
      bodyMd: nextTemplate.body_md,
      isActive: Boolean(nextTemplate.is_active),
      contractTemplateMxId: nextTemplate.contract_template_mx_id,
      lock: true,
      allowTerminalSourceForDeactivation,
    });
    if (nextTemplate.template_type === 'activation_contract' && Boolean(nextTemplate.is_active)) {
      await assertActiveLaneSourceConsistency(conn, {
        orgId: req.orgId,
        environment: sourceSnapshot.contractEnvironment,
        contractTemplateMxId: sourceSnapshot.contractTemplateMxId,
        excludeTemplateId: template.id,
      });
    }

    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (f === 'is_active' ? (req.body[f] ? 1 : 0) : req.body[f]));
    const params = [...values, template.id];
    const cond = orgCond(req.orgId, params);
    const [result] = await conn.query(
      `UPDATE document_templates SET ${sets}
        WHERE id = ? AND ${cond} AND deleted_at IS NULL`,
      params,
    );
    if (!result.affectedRows) throw new ValidationError('Template was modified concurrently — reload and retry');
    const [rows] = await conn.query('SELECT * FROM document_templates WHERE id = ?', [template.id]);
    await conn.commit();
    res.json({ data: rows[0] });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

templatesRouter.delete('/:id', requirePermission('document_templates.delete'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await lockTemplateOrganization(conn, req.orgId);
    const params = [req.params.id];
    const cond = orgCond(req.orgId, params);
    const [result] = await conn.query(
      `UPDATE document_templates SET deleted_at = NOW() WHERE id = ? AND ${cond} AND deleted_at IS NULL`,
      params,
    );
    if (!result.affectedRows) throw new NotFoundError('Template');
    await conn.commit();
    res.status(204).send();
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
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
    const document = rows[0];
    document.evidence_valid = legalDocumentService.verifyEvidence(document);
    if (['activation_contract', legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TYPE]
      .includes(document.template_type)) {
      const [[client], existingChoices, notice] = await Promise.all([
        db.query(
          `SELECT email, phone FROM clients
            WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL LIMIT 1`,
          [document.client_id, document.organization_id],
        ).then(([clientRows]) => clientRows),
        db.query(
          `SELECT id FROM signed_documents
            WHERE service_order_id <=> ? AND client_id = ?
              AND organization_id <=> ?
              AND id <> ? AND status = 'signed'
              AND communication_choices IS NOT NULL AND deleted_at IS NULL
            LIMIT 1`,
          [document.service_order_id, document.client_id, document.organization_id, document.id],
        ).then(([choiceRows]) => choiceRows),
        privacyNoticeService.getNotice(document.organization_id),
      ]);
      document.communication_contacts = {
        email: Boolean(client?.email),
        phone: Boolean(client?.phone),
      };
      document.privacy_notice = {
        version: notice.version,
        content: notice.content,
        hash: notice.hash,
      };
      document.communication_choices_recorded = Boolean(
        document.communication_choices || existingChoices.length,
      );
    }
    res.json({ data: document });
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
      communicationOptIns: req.body.communication_opt_ins,
      communicationChoicesConfirmed: req.body.communication_choices_confirmed,
      privacyNoticeVersion: req.body.privacy_notice_version,
      privacyNoticeHash: req.body.privacy_notice_hash,
    });
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'sign',
      tableName: 'signed_documents', recordId: doc.id,
      newValues: {
        signer_name: doc.signer_name,
        content_sha256: doc.content_sha256,
        evidence_sha256: doc.evidence_sha256,
      }, // never the signature image
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
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const soParams = [req.body.service_order_id];
    const soCond = orgCond(req.orgId, soParams);
    const [soRows] = await conn.query(
      `SELECT * FROM service_orders
        WHERE id = ? AND ${soCond} AND deleted_at IS NULL
        FOR UPDATE`,
      soParams,
    );
    const order = soRows[0];
    if (!order) throw new NotFoundError('Service order');
    if (!order.client_id) throw new ValidationError('Service order has no client yet — start it first');
    if (order.order_type !== 'new_install' || order.status !== 'in_process' || !order.contract_id) {
      throw new ValidationError('Signing documents can only be generated for a started new-install order with a linked contract');
    }

    const [woRows] = await conn.query(
      `SELECT id, status FROM work_orders
        WHERE service_order_id = ? AND organization_id <=> ?
          AND client_id = ? AND contract_id = ? AND work_type = 'installation'
          AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [order.id, order.organization_id, order.client_id, order.contract_id],
    );
    const workOrder = woRows[0] || null;
    if (!workOrder) {
      throw new ValidationError('The started installation has no linked installation work order');
    }
    const canGenerateArrivalAuthorization = Boolean(
      workOrder && ['pending', 'assigned'].includes(workOrder.status),
    );
    // Dedupe by immutable template ID, not by broad type. An ISP may enable a
    // second reviewed activation/arrival template after an order was created;
    // the client needs an instance of that exact version. Arrival paperwork
    // is meaningful only before the installation visit starts.
    const effectiveOrgId = order.organization_id ?? req.orgId;
    if (effectiveOrgId === null || effectiveOrgId === undefined) {
      throw new ValidationError('An organization is required to generate signing documents');
    }
    const [localeRows] = await conn.query(
      'SELECT locale FROM organizations WHERE id = ? LIMIT 1',
      [effectiveOrgId],
    );
    const locale = localeRows[0]?.locale || 'global';
    let missingTemplates;
    if (locale === 'MX') {
      [missingTemplates] = await conn.query(
        `SELECT dt.id FROM document_templates dt
          WHERE dt.organization_id = ? AND dt.is_active = 1
            AND dt.deleted_at IS NULL
            AND (dt.template_type <> 'installation_authorization' OR ? = 1)
            AND NOT EXISTS (
              SELECT 1 FROM signed_documents sd
               WHERE sd.service_order_id = ? AND sd.organization_id = dt.organization_id
                 AND sd.client_id <=> ? AND sd.contract_id <=> ?
                 AND sd.template_id = dt.id AND sd.template_type = dt.template_type
                 AND sd.status IN ('pending','signed') AND sd.deleted_at IS NULL
            )
          ORDER BY dt.id`,
        [
          effectiveOrgId,
          canGenerateArrivalAuthorization ? 1 : 0,
          order.id,
          order.client_id,
          order.contract_id,
        ],
      );
    } else {
      const [existing] = await conn.query(
        `SELECT id FROM signed_documents
          WHERE service_order_id = ? AND organization_id = ?
            AND client_id <=> ? AND contract_id <=> ?
            AND template_type = ? AND status IN ('pending','signed')
            AND deleted_at IS NULL LIMIT 1`,
        [
          order.id,
          effectiveOrgId,
          order.client_id,
          order.contract_id,
          legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TYPE,
        ],
      );
      missingTemplates = existing.length
        ? []
        : [{ id: legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID }];
    }

    const created = await legalDocumentService.generateForOrder(conn.query.bind(conn), {
      orgId: order.organization_id ?? req.orgId ?? null,
      clientId: order.client_id,
      contractId: order.contract_id || null,
      orderId: order.id,
      workOrderId: workOrder?.id || null,
      createdBy: req.user?.id ?? null,
      onlyTemplateIds: new Set(missingTemplates.map(template => Number(template.id))),
    });
    await conn.commit();
    res.status(201).json({ data: { generated: created.length, documents: created } });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = { templatesRouter, documentsRouter };
