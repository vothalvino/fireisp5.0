// =============================================================================
// FireISP 5.0 — Legal document generation + on-site signing (migration 447)
// =============================================================================
// The two signatures MX field work actually needs: the installation
// authorization the client signs when the technician ARRIVES (permission to
// enter, drill, mount) and the activation contract — the PROFECO-registered
// contrato de adhesión — signed when the install is DONE, plus an optional
// comodato annex for rented equipment.
//
//   * render()            — {{placeholder}} substitution over a flat context;
//                           unknown placeholders survive verbatim so a typo is
//                           VISIBLE in the document instead of silently blank.
//   * generateForOrder()  — one pending signed_documents row per ACTIVE
//                           template, body frozen + SHA-256 hashed at
//                           generation. Runs on the caller's transaction
//                           connection from startOrder; best-effort per
//                           template is deliberately NOT offered — a legal
//                           document that silently failed to generate is a
//                           compliance hole, so any failure aborts the start.
//   * sign()              — verifies the frozen hash, stores signer name +
//                           canvas signature + timestamp + IP (Código de
//                           Comercio data-message audit trail).
//   * pendingGateError()  — the work-order transition gates: arrival
//                           authorization blocks in_progress, activation
//                           contract blocks completed. Gates exist only when
//                           an instance was actually generated.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const { ValidationError, NotFoundError } = require('../utils/errors');

/** {{a.b}} substitution. Values are stringified; null/undefined → '—'. */
function render(body, context) {
  return String(body).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    const value = path.split('.').reduce(
      (acc, key) => (acc === null || acc === undefined ? undefined : acc[key]),
      context,
    );
    if (value === undefined) return match; // typo stays visible
    if (value === null || value === '') return '—';
    return String(value);
  });
}

/** Flat render context for an order's documents. All reads on `run`. */
async function buildContext(run, { orgId, clientId, contractId, orderId }) {
  const [[client]] = await run(
    'SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL',
    [clientId],
  );
  const [[contract]] = contractId
    ? await run('SELECT * FROM contracts WHERE id = ? AND deleted_at IS NULL', [contractId])
    : [[null]];
  const [[plan]] = contract?.plan_id
    ? await run('SELECT * FROM plans WHERE id = ?', [contract.plan_id])
    : [[null]];
  const [[order]] = orderId
    ? await run('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL', [orderId])
    : [[null]];
  const [[org]] = orgId
    ? await run('SELECT * FROM organizations WHERE id = ?', [orgId])
    : [[null]];
  const [[orgMx]] = orgId
    ? await run('SELECT * FROM organization_mx_profiles WHERE organization_id = ? AND deleted_at IS NULL', [orgId])
    : [[null]];
  const [[clientMx]] = await run(
    'SELECT * FROM client_mx_profiles WHERE client_id = ? AND deleted_at IS NULL',
    [clientId],
  );

  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    client: {
      name: client?.name, email: client?.email, phone: client?.phone,
      address: [client?.address, client?.city, client?.state, client?.zip_code].filter(Boolean).join(', '),
      rfc: clientMx?.rfc ?? client?.tax_id, curp: clientMx?.curp ?? client?.curp,
      razon_social: clientMx?.razon_social,
    },
    contract: {
      id: contract?.id, start_date: contract?.start_date,
      connection_type: contract?.connection_type,
    },
    plan: { name: plan?.name, download: plan?.download_speed, upload: plan?.upload_speed, price: plan?.price },
    order: { number: order?.order_number, address: order?.address },
    org: {
      name: org?.name, legal_name: org?.legal_name, phone: org?.phone, email: org?.email,
      rfc: orgMx?.rfc, razon_social: orgMx?.razon_social,
    },
  };
}

/**
 * Generate one pending instance per ACTIVE template for a starting order.
 * Same transaction as the order start — all documents exist or none do.
 */
async function generateForOrder(run, { orgId, clientId, contractId, orderId, workOrderId, createdBy, skipTypes = null }) {
  // STRICTLY MX (user decision, 2026-08-05): the legal-paper flow exists for
  // Mexican organizations only. Checked HERE — the single funnel — so every
  // caller (startOrder, the /generate backfill route) inherits it. An org-less
  // context (legacy single-tenant rows) has no locale to check and generates
  // nothing.
  if (orgId === null || orgId === undefined) return [];
  const [localeRows] = await run(
    'SELECT locale FROM organizations WHERE id = ? LIMIT 1',
    [orgId],
  );
  if (localeRows[0]?.locale !== 'MX') return [];

  const templateParams = [orgId];
  const orgCond = 'organization_id = ?';
  const [templates] = await run(
    `SELECT * FROM document_templates
     WHERE ${orgCond} AND is_active = 1 AND deleted_at IS NULL
     ORDER BY FIELD(template_type, 'installation_authorization', 'activation_contract', 'equipment_comodato', 'custom'), id`,
    templateParams,
  );
  if (!templates.length) return [];

  const wanted = skipTypes ? templates.filter(t => !skipTypes.has(t.template_type)) : templates;
  if (!wanted.length) return [];

  const context = await buildContext(run, { orgId, clientId, contractId, orderId });
  const created = [];
  for (const tpl of wanted) {
    const body = render(tpl.body_md, context);
    const hash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    const [ins] = await run(
      `INSERT INTO signed_documents
         (organization_id, client_id, contract_id, service_order_id, work_order_id,
          template_id, template_type, title, rendered_body, content_sha256, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [orgId, clientId, contractId, orderId, workOrderId,
        tpl.id, tpl.template_type, tpl.name, body, hash, createdBy],
    );
    created.push({ id: ins.insertId, template_type: tpl.template_type, title: tpl.name });
  }
  return created;
}

/** Capture the client's signature on a pending document. */
async function sign(documentId, { orgId, signerName, signatureImage, signedIp, performedBy: _performedBy }) {
  if (!signerName || !String(signerName).trim()) {
    throw new ValidationError('signer_name is required');
  }
  if (!signatureImage || !/^data:image\/(png|jpeg);base64,/.test(signatureImage)) {
    throw new ValidationError('signature_image must be a PNG/JPEG data URL');
  }
  if (signatureImage.length > 500_000) {
    throw new ValidationError('signature_image is too large (max ~500 KB)');
  }

  const params = [documentId];
  let orgCond = '';
  if (orgId !== null && orgId !== undefined) {
    orgCond = 'AND (organization_id = ? OR organization_id IS NULL)';
    params.push(orgId);
  }
  const [rows] = await db.query(
    `SELECT * FROM signed_documents WHERE id = ? ${orgCond} AND deleted_at IS NULL`,
    params,
  );
  const doc = rows[0];
  if (!doc) throw new NotFoundError('Document');
  if (doc.status !== 'pending') {
    throw new ValidationError(`Document is not pending (currently: ${doc.status})`);
  }

  // Integrity: the body the client is signing must be the body frozen at
  // generation. A mismatch means the row was tampered with — refuse.
  const hash = crypto.createHash('sha256').update(doc.rendered_body, 'utf8').digest('hex');
  if (hash !== doc.content_sha256) {
    throw new ValidationError('Document integrity check failed — the stored body does not match its generation hash');
  }

  const [result] = await db.query(
    `UPDATE signed_documents
     SET status = 'signed', signer_name = ?, signature_image = ?, signed_at = NOW(), signed_ip = ?
     WHERE id = ? AND status = 'pending'`,
    [String(signerName).trim(), signatureImage, signedIp || null, documentId],
  );
  if (result.affectedRows === 0) {
    throw new ValidationError('Document was signed or cancelled concurrently — reload');
  }
  const [fresh] = await db.query('SELECT * FROM signed_documents WHERE id = ?', [documentId]);
  return fresh[0];
}

/**
 * Work-order transition gate. `target` is 'in_progress' or 'completed'.
 * Returns a human-readable refusal, or null when the transition may proceed.
 */
async function pendingGateError(workOrder, target) {
  if (workOrder.work_type !== 'installation' || !workOrder.service_order_id) return null;
  const gateType = target === 'in_progress' ? 'installation_authorization'
    : target === 'completed' ? 'activation_contract'
      : null;
  if (!gateType) return null;
  const [rows] = await db.query(
    `SELECT id, title FROM signed_documents
     WHERE service_order_id = ? AND template_type = ? AND status = 'pending' AND deleted_at IS NULL
     LIMIT 1`,
    [workOrder.service_order_id, gateType],
  );
  if (!rows.length) return null;
  return gateType === 'installation_authorization'
    ? `The client must sign "${rows[0].title}" (installation authorization) before work starts — open Documents on this work order`
    : `The client must sign "${rows[0].title}" (activation contract) before this installation can be completed — open Documents on this work order`;
}

module.exports = { render, buildContext, generateForOrder, sign, pendingGateError };
