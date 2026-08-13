// =============================================================================
// FireISP 5.0 — Legal document generation + on-site signing (migration 447)
// =============================================================================
// The two signatures MX field work actually needs: the installation
// authorization the client signs when the technician ARRIVES (permission to
// enter, drill, mount) and the activation contract — the PROFECO-registered
// contrato de adhesión — signed when the install is DONE, plus an optional
// comodato annex for rented equipment.
//
//   * render()            — {{placeholder}} substitution over an explicit
//                           context; missing optional values become an em dash,
//                           while unknown placeholders fail closed so a typo
//                           can never be frozen into a signable document.
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
//   * pendingGateError()  — the work-order transition gates: every active
//                           arrival template must be signed before work starts,
//                           and every active activation template must be signed
//                           before completion.
// =============================================================================

const crypto = require('crypto');

// Official IFT document used when the org has not configured its own copy.
const CARTA_DERECHOS_DEFAULT_URL = 'https://www.ift.org.mx/usuarios-y-audiencias/carta-de-derechos-minimos-de-los-usuarios';
const db = require('../config/database');
const { ValidationError, NotFoundError } = require('../utils/errors');
const privacyNoticeService = require('./privacyNoticeService');
const communicationConsentService = require('./communicationConsentService');
const mxRegisteredTemplateService = require('./mxRegisteredContractTemplateService');

// Global organizations deliberately receive an operational acknowledgment,
// not a jurisdiction-specific legal contract.  It is bundled so a fresh
// global install is signable without an administrator pretending to review a
// legal template. MX remains fail-closed on the ISP's own reviewed template.
const GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID = 0;
const GLOBAL_ACKNOWLEDGMENT_TYPE = 'service_acknowledgment';
const GLOBAL_ACKNOWLEDGMENT_TITLE = 'Service installation acknowledgment';
const SANDBOX_WATERMARK = `> **PRUEBA / SIMULACIÓN — NO REGISTRADO ANTE PROFECO — SIN EFECTOS LEGALES**
>
> Este documento fue generado en el entorno de simulación de FireISP. No es un
> sandbox oficial de PROFECO, no acredita registro y no puede convertirse en
> un contrato de producción.
>
> **TEST / SIMULATION — NOT PROFECO REGISTERED — NO LEGAL EFFECT.** This is a
> FireISP simulation, not an official PROFECO sandbox or registration, and it
> cannot be converted into a production contract.

`;
const GLOBAL_ACKNOWLEDGMENT_BODY = `# Service installation acknowledgment

- Customer: **{{client.name}}**
- Service address: **{{order.address}}**
- Plan: **{{plan.name}}**
- Service order: **{{order.number}}**
- Date: **{{date}}**

I confirm that the provider presented the installed service and plan details, gave me an opportunity to review the installation handoff, and explained how to request support.

My optional promotional communication choices are shown separately on this signing screen. Refusing promotional messages does not affect essential service, billing, outage, security, or support communications, and I may change those choices later.

This is a factual service-installation and handoff acknowledgment. It is generic, is not jurisdiction-specific legal advice, and does not replace any service agreement or privacy notice that applies between the customer and provider.
`;

const SUPPORTED_PLACEHOLDERS = Object.freeze([
  'date',
  'client.name',
  'client.email',
  'client.phone',
  'client.address',
  'client.rfc',
  'client.curp',
  'client.razon_social',
  'contract.id',
  'contract.start_date',
  'contract.connection_type',
  'contract.contract_template_mx_id',
  'contract.mx_contract_environment',
  'plan.name',
  'plan.download',
  'plan.upload',
  'plan.price',
  'order.number',
  'order.address',
  'org.name',
  'org.legal_name',
  'org.phone',
  'org.email',
  'org.rfc',
  'org.razon_social',
  'org.profeco_registro',
  'org.carta_derechos_url',
]);
const SUPPORTED_PLACEHOLDER_SET = new Set(SUPPORTED_PLACEHOLDERS);
const PLACEHOLDER_PATH_PATTERN = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

function resolvePlaceholder(context, path) {
  let value = context;
  for (const key of path.split('.')) {
    if ((typeof value !== 'object' && typeof value !== 'function')
        || value === null
        || !Object.prototype.hasOwnProperty.call(value, key)) {
      return { found: false, value: undefined };
    }
    value = value[key];
  }
  return { found: true, value };
}

function unresolvedPlaceholderError(placeholder) {
  return new ValidationError(
    `Unsupported or unresolved legal document placeholder "${placeholder}". Update the source template before generating or signing this document`,
  );
}

/**
 * Validate template syntax and its placeholder allowlist without needing live
 * customer data. This is also used by source/template write routes so a typo
 * is rejected before reviewed text can become immutable evidence.
 */
function assertSupportedPlaceholders(body) {
  const source = String(body ?? '');
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{{', cursor);
    const strayClose = source.indexOf('}}', cursor);
    if (strayClose !== -1 && (open === -1 || strayClose < open)) {
      throw unresolvedPlaceholderError('}}');
    }
    if (open === -1) break;

    const close = source.indexOf('}}', open + 2);
    if (close === -1) throw unresolvedPlaceholderError(source.slice(open));
    const rawPath = source.slice(open + 2, close);
    const path = rawPath.trim();
    const adjacentBrace = source[open - 1] === '{' || source[close + 2] === '}';
    if (adjacentBrace || !PLACEHOLDER_PATH_PATTERN.test(path)) {
      throw unresolvedPlaceholderError(source.slice(open, close + 2));
    }
    if (!SUPPORTED_PLACEHOLDER_SET.has(path)) {
      throw unresolvedPlaceholderError(`{{${path}}}`);
    }
    cursor = close + 2;
  }
  return true;
}

/**
 * {{a.b}} substitution over explicit own-properties. Values are stringified;
 * a supported property whose value is null/undefined/empty becomes an em dash.
 * Unknown or malformed placeholders are rejected instead of being frozen.
 */
function render(body, context) {
  assertSupportedPlaceholders(body);
  const rendered = String(body).replace(/\{\{([^{}]*)\}\}/g, (match, rawPath) => {
    const path = rawPath.trim();
    const { found, value } = resolvePlaceholder(context, path);
    if (!found) throw unresolvedPlaceholderError(match);
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  });

  // Also reject an unmatched/nested mustache sequence and placeholder-like
  // text introduced by an interpolated value. A legal body with any visible
  // {{...}} marker is not safe to freeze or present for signature.
  if (rendered.includes('{{') || rendered.includes('}}')) {
    throw unresolvedPlaceholderError('{{...}}');
  }
  return rendered;
}

function assertNoUnresolvedPlaceholders(body) {
  if (String(body).includes('{{') || String(body).includes('}}')) {
    throw unresolvedPlaceholderError('{{...}}');
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function canonicalDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function canonicalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value);
  const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:[ T]|$)/.exec(text);
  if (dateOnly) return dateOnly[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

/**
 * Flat render context for an order's documents. Every relationship is scoped
 * to the tenant and to the same client/contract/order chain before any PII is
 * interpolated. This deliberately rejects malformed historical rows rather
 * than freezing another tenant's data into a new signed document.
 */
async function buildContext(run, { orgId, clientId, contractId, orderId }) {
  const [[client]] = await run(
    `SELECT * FROM clients
      WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL`,
    [clientId, orgId],
  );
  const [[contract]] = contractId
    ? await run(
      `SELECT * FROM contracts
        WHERE id = ? AND organization_id <=> ? AND client_id = ?
          AND deleted_at IS NULL`,
      [contractId, orgId, clientId],
    )
    : [[null]];
  const [[plan]] = contract?.plan_id
    ? await run(
      `SELECT * FROM plans
        WHERE id = ? AND deleted_at IS NULL
          AND (organization_id = ? OR organization_id IS NULL)`,
      [contract.plan_id, orgId],
    )
    : [[null]];
  const [[order]] = orderId
    ? await run(
      `SELECT * FROM service_orders
        WHERE id = ? AND organization_id <=> ? AND client_id = ?
          AND contract_id <=> ? AND deleted_at IS NULL`,
      [orderId, orgId, clientId, contractId],
    )
    : [[null]];
  const [[org]] = orgId
    ? await run('SELECT * FROM organizations WHERE id = ? AND deleted_at IS NULL', [orgId])
    : [[null]];
  const [[orgMx]] = orgId
    ? await run('SELECT * FROM organization_mx_profiles WHERE organization_id = ? AND deleted_at IS NULL', [orgId])
    : [[null]];
  const [[clientMx]] = await run(
    'SELECT * FROM client_mx_profiles WHERE client_id = ? AND deleted_at IS NULL',
    [clientId],
  );

  if (!client || !contract || !plan || !order || !org) {
    throw new ValidationError(
      'The installation client, contract, plan, order, and organization must form one active tenant-scoped chain',
    );
  }

  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    client: {
      name: client?.name ?? null, email: client?.email ?? null, phone: client?.phone ?? null,
      address: [client?.address, client?.city, client?.state, client?.zip_code].filter(Boolean).join(', '),
      rfc: clientMx?.rfc ?? client?.tax_id ?? null,
      curp: clientMx?.curp ?? client?.curp ?? null,
      razon_social: clientMx?.razon_social ?? null,
    },
    contract: {
      id: contract?.id ?? null, start_date: canonicalDate(contract?.start_date),
      connection_type: contract?.connection_type ?? null,
      contract_template_mx_id: contract?.contract_template_mx_id ?? null,
      mx_contract_environment: contract?.mx_contract_environment ?? null,
    },
    plan: {
      name: plan?.name ?? null,
      download: plan?.download_speed_mbps ?? null,
      upload: plan?.upload_speed_mbps ?? null,
      price: plan?.price ?? null,
    },
    order: { number: order?.order_number ?? null, address: order?.address ?? null },
    org: {
      name: org?.name ?? null,
      legal_name: org?.legal_name ?? null,
      phone: org?.phone ?? null,
      email: org?.email ?? null,
      rfc: orgMx?.rfc ?? org?.tax_id ?? null,
      razon_social: orgMx?.razon_social ?? null,
      profeco_registro: orgMx?.profeco_registro ?? null,
      carta_derechos_url: orgMx?.carta_derechos_url || CARTA_DERECHOS_DEFAULT_URL,
    },
  };
}

/**
 * Generate one pending instance per ACTIVE template for a starting order.
 * Same transaction as the order start — all documents exist or none do.
 */
async function generateForOrder(run, {
  orgId, clientId, contractId, orderId, workOrderId, createdBy,
  skipTypes = null, onlyTemplateIds = null,
}) {
  // An org-less legacy context has no locale or durable tenant identity.
  if (orgId === null || orgId === undefined) return [];
  const [localeRows] = await run(
    'SELECT locale FROM organizations WHERE id = ? LIMIT 1',
    [orgId],
  );
  const locale = localeRows[0]?.locale || 'global';

  let templates;
  if (locale === 'MX') {
    [templates] = await run(
      `SELECT dt.*${mxRegisteredTemplateService.joinedRegistrationColumns('ctm')}
         FROM document_templates dt
         LEFT JOIN contract_templates_mx ctm ON ctm.id = dt.contract_template_mx_id
        WHERE dt.organization_id = ? AND dt.is_active = 1 AND dt.deleted_at IS NULL
        ORDER BY FIELD(dt.template_type, 'installation_authorization', 'activation_contract', 'equipment_comodato', 'custom'), dt.id
       FOR UPDATE`,
      [orgId],
    );
  } else {
    templates = [{
      id: null,
      virtual_id: GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID,
      template_type: GLOBAL_ACKNOWLEDGMENT_TYPE,
      name: GLOBAL_ACKNOWLEDGMENT_TITLE,
      body_md: GLOBAL_ACKNOWLEDGMENT_BODY,
    }];
  }
  if (!templates.length) return [];

  const context = await buildContext(run, { orgId, clientId, contractId, orderId });
  let mxContractEnvironment = null;
  if (locale === 'MX') {
    mxContractEnvironment = mxRegisteredTemplateService.assertEnvironment(
      context.contract.mx_contract_environment,
      'contract.mx_contract_environment',
    );
    // Both lanes may have active templates. Select only this contract's frozen
    // lane; retain unlinked active legacy rows so they fail closed below.
    templates = templates.filter(template => (
      template.template_type !== 'activation_contract'
      || !template.mx_id
      || mxRegisteredTemplateService.contractEnvironment(template) === mxContractEnvironment
    ));
    mxRegisteredTemplateService.assertOneRegisteredSource(
      templates.filter(template => template.template_type === 'activation_contract'),
      orgId,
      mxContractEnvironment,
    );
  }

  let wanted = skipTypes ? templates.filter(t => !skipTypes.has(t.template_type)) : templates;
  // Contract activation preparation backfills templates by ID, not merely by
  // type: an MX ISP may activate a second activation-contract template after
  // an order started, and the client must receive a signable instance of that
  // exact newly-required template without duplicating the existing one.
  if (onlyTemplateIds) {
    const wantedIds = new Set([...onlyTemplateIds].map(Number));
    wanted = wanted.filter(template => wantedIds.has(
      template.id === null ? Number(template.virtual_id) : Number(template.id),
    ));
  }
  if (!wanted.length) return [];

  const created = [];
  for (const tpl of wanted) {
    const rendered = render(tpl.body_md, context);
    const body = locale === 'MX' && mxContractEnvironment === 'sandbox'
      ? `${SANDBOX_WATERMARK}${rendered}`
      : rendered;
    const hash = sha256(body);
    const mxSnapshot = tpl.template_type === 'activation_contract'
      ? mxRegisteredTemplateService.assertActiveActivationTemplate(
        tpl,
        orgId,
        mxContractEnvironment,
      )
      : null;
    const [ins] = await run(
      `INSERT INTO signed_documents
         (organization_id, client_id, contract_id, service_order_id, work_order_id,
          template_id, template_type, title, rendered_body, content_sha256,
          contract_template_mx_id, mx_registration_number, mx_registered_at,
          mx_template_version, mx_source_sha256, mx_contract_environment,
          evidence_format_version, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, 'pending', ?)`,
      [orgId, clientId, contractId, orderId, workOrderId,
        tpl.id, tpl.template_type, tpl.name, body, hash,
        mxSnapshot?.contractTemplateMxId ?? null,
        mxSnapshot?.registrationNumber ?? null,
        mxSnapshot?.registeredAt ?? null,
        mxSnapshot?.version ?? null,
        mxSnapshot?.sourceSha256 ?? null,
        mxSnapshot?.contractEnvironment ?? null,
        createdBy],
    );
    created.push({ id: ins.insertId, template_type: tpl.template_type, title: tpl.name });
  }
  return created;
}

function normalizedCommunicationEvidence(value) {
  if (!value) return null;
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  return {
    email: Boolean(parsed.email),
    sms: Boolean(parsed.sms),
    whatsapp: Boolean(parsed.whatsapp),
    confirmed: parsed.confirmed === true || Number(parsed.confirmed) === 1,
    privacy_notice_version: parsed.privacy_notice_version || null,
    privacy_notice_hash: parsed.privacy_notice_hash || null,
  };
}

/** Stable digest covering the complete assisted-signature evidence envelope. */
function evidenceDigest(document, {
  signerName = document.signer_name,
  signatureImage = document.signature_image,
  signedAt = document.signed_at,
  signedIp = document.signed_ip,
  capturedBy = document.captured_by,
  communicationChoices = document.communication_choices,
} = {}) {
  // v2 predates contract environments. Missing/legacy values must continue to
  // verify against that exact canonical envelope. New rows explicitly store
  // v3 and bind the frozen sandbox/production mode into the digest.
  const formatVersion = Number(document.evidence_format_version) >= 3 ? 3 : 2;
  const canonical = {
    version: formatVersion,
    signing_method: 'assisted_canvas',
    document_id: document.id === null || document.id === undefined ? null : String(document.id),
    organization_id: document.organization_id === null || document.organization_id === undefined
      ? null : String(document.organization_id),
    client_id: document.client_id === null || document.client_id === undefined ? null : String(document.client_id),
    contract_id: document.contract_id === null || document.contract_id === undefined ? null : String(document.contract_id),
    service_order_id: document.service_order_id === null || document.service_order_id === undefined
      ? null : String(document.service_order_id),
    work_order_id: document.work_order_id === null || document.work_order_id === undefined
      ? null : String(document.work_order_id),
    template_type: document.template_type || null,
    title: document.title || null,
    document_content_sha256: document.content_sha256,
    rendered_body_sha256: sha256(document.rendered_body),
    contract_template_mx_id: document.contract_template_mx_id === null
      || document.contract_template_mx_id === undefined
      ? null : String(document.contract_template_mx_id),
    mx_registration_number: document.mx_registration_number || null,
    mx_registered_at: mxRegisteredTemplateService.dateOnly(document.mx_registered_at),
    mx_template_version: document.mx_template_version || null,
    mx_source_sha256: document.mx_source_sha256 || null,
    signer_name: String(signerName || '').trim(),
    signature_image_sha256: sha256(signatureImage),
    signed_at: canonicalDateTime(signedAt),
    signed_ip: signedIp || null,
    captured_by: capturedBy === null || capturedBy === undefined ? null : String(capturedBy),
    communication_choices: normalizedCommunicationEvidence(communicationChoices),
  };
  if (formatVersion >= 3) {
    canonical.mx_contract_environment = document.mx_contract_environment || null;
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function verifyEvidence(document) {
  if (!document?.evidence_sha256 || !document.signature_image) return null;
  if (sha256(document.rendered_body) !== document.content_sha256) return false;
  return evidenceDigest(document) === document.evidence_sha256;
}

function signatureEvidenceIsValid(document) {
  // Newly generated global acknowledgments and registered MX contracts have
  // no legacy representation: their status only counts when the complete
  // evidence envelope verifies. Older, unlinked document types remain
  // readable during migration, but an evidence hash that exists must verify.
  const evidenceRequired = document.template_type === GLOBAL_ACKNOWLEDGMENT_TYPE
    || (document.template_type === 'activation_contract'
      && document.contract_template_mx_id !== null
      && document.contract_template_mx_id !== undefined);
  const verified = verifyEvidence(document);
  return evidenceRequired ? verified === true : (verified === null || verified === true);
}

function signatureImageBytes(dataUrl) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 8) return null;
  const isPng = match[1] === 'png'
    && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const isJpeg = match[1] === 'jpeg'
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isPng || isJpeg ? bytes : null;
}

/** Capture the client's signature on a pending document. */
async function sign(documentId, {
  orgId,
  signerName,
  signatureImage,
  signedIp,
  performedBy,
  communicationOptIns,
  communicationChoicesConfirmed,
  privacyNoticeVersion,
  privacyNoticeHash,
}) {
  if (!signerName || !String(signerName).trim()) {
    throw new ValidationError('signer_name is required');
  }
  if (typeof signatureImage === 'string' && signatureImage.length > 500_000) {
    throw new ValidationError('signature_image is too large (max ~500 KB)');
  }
  if (!signatureImageBytes(signatureImage)) {
    throw new ValidationError('signature_image must contain valid PNG/JPEG bytes');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const params = [documentId];
    const orgCondition = orgId === null || orgId === undefined
      ? 'organization_id IS NULL'
      : 'organization_id = ?';
    if (orgId !== null && orgId !== undefined) params.push(orgId);
    const [scopeRows] = await conn.query(
      `SELECT service_order_id, organization_id, work_order_id, client_id,
              contract_id, template_type
         FROM signed_documents
        WHERE id = ? AND ${orgCondition} AND deleted_at IS NULL`,
      params,
    );
    const scope = scopeRows[0];
    if (!scope) throw new NotFoundError('Document');

    // Work-order transitions lock WO -> service order. Use the same order
    // here, which both serializes sibling signatures and avoids an inverted
    // lock order when a technician signs while completion is attempted.
    let lockedWorkOrder = null;
    if (scope.work_order_id !== null && scope.work_order_id !== undefined) {
      const [workOrders] = await conn.query(
        `SELECT id, status FROM work_orders
          WHERE id = ? AND organization_id <=> ?
            AND client_id = ? AND contract_id <=> ?
            AND service_order_id <=> ? AND work_type = 'installation'
            AND deleted_at IS NULL
          FOR UPDATE`,
        [
          scope.work_order_id,
          scope.organization_id,
          scope.client_id,
          scope.contract_id,
          scope.service_order_id,
        ],
      );
      lockedWorkOrder = workOrders[0] || null;
      if (!lockedWorkOrder) {
        throw new ValidationError('The document installation work order no longer matches this customer and contract');
      }
    }

    let lockedOrder = null;
    if (scope.service_order_id !== null && scope.service_order_id !== undefined) {
      const [orders] = await conn.query(
        `SELECT so.id, so.order_type, so.status, so.client_id, so.contract_id,
                c.status AS contract_status, c.contract_template_mx_id,
                c.mx_contract_environment
           FROM service_orders so
           LEFT JOIN contracts c ON c.id = so.contract_id
            AND c.organization_id <=> so.organization_id
            AND c.client_id = so.client_id AND c.deleted_at IS NULL
          WHERE so.id = ? AND so.organization_id <=> ?
            AND so.client_id = ? AND so.contract_id <=> ?
            AND so.deleted_at IS NULL
          FOR UPDATE`,
        [
          scope.service_order_id,
          scope.organization_id,
          scope.client_id,
          scope.contract_id,
        ],
      );
      lockedOrder = orders[0] || null;
      if (!lockedOrder) {
        throw new ValidationError('The document service order no longer matches this customer and contract');
      }
    }

    const [rows] = await conn.query(
      `SELECT * FROM signed_documents
        WHERE id = ? AND ${orgCondition} AND deleted_at IS NULL
        FOR UPDATE`,
      params,
    );
    const doc = rows[0];
    if (!doc) throw new NotFoundError('Document');
    if (doc.status !== 'pending') {
      throw new ValidationError(`Document is not pending (currently: ${doc.status})`);
    }

    if (lockedOrder
        && (lockedOrder.order_type !== 'new_install' || lockedOrder.status !== 'in_process')) {
      throw new ValidationError(
        'Signing documents can only be signed while their linked new installation is active',
      );
    }

    // Integrity: the body the client is signing must be the body frozen at
    // generation. A mismatch means the row was tampered with — refuse.
    const hash = sha256(doc.rendered_body);
    if (hash !== doc.content_sha256) {
      throw new ValidationError('Document integrity check failed — the stored body does not match its generation hash');
    }
    assertNoUnresolvedPlaceholders(doc.rendered_body);

    // Old renderers left unknown placeholders visible and could partially
    // consume malformed triple braces (for example, {{{client.name}}} became
    // {María}). That output no longer contains a {{...}} marker, so validate
    // the original tenant-owned template as well. Soft-deleted templates are
    // intentionally included: their frozen source remains signing evidence.
    // The bundled global acknowledgment has no physical template row. Every
    // other document must retain its physical source reference; a hard-deleted
    // template (FK SET NULL), orphaned row, or forged zero id cannot bypass
    // validation of the original legal text.
    if (doc.template_type !== GLOBAL_ACKNOWLEDGMENT_TYPE) {
      if (doc.template_id === null
          || doc.template_id === undefined
          || !Number.isInteger(Number(doc.template_id))
          || Number(doc.template_id) <= GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID) {
        throw new ValidationError(
          'The original legal document template is missing from this pending document',
        );
      }
      const [sourceTemplates] = await conn.query(
        `SELECT template_type, body_md
           FROM document_templates
          WHERE id = ? AND organization_id <=> ?
          LIMIT 1 FOR UPDATE`,
        [doc.template_id, doc.organization_id],
      );
      const sourceTemplate = sourceTemplates[0];
      if (!sourceTemplate || sourceTemplate.template_type !== doc.template_type) {
        throw new ValidationError(
          'The original legal document template no longer matches this pending document',
        );
      }
      assertSupportedPlaceholders(sourceTemplate.body_md);
    }

    // Validate the frozen chain, never the organization's current switch. A
    // switch is allowed only between flows and cannot relabel old contracts or
    // documents; these checks also detect direct database tampering.
    const documentEnvironment = mxRegisteredTemplateService.contractEnvironment(doc);
    if (documentEnvironment) {
      if (lockedOrder?.mx_contract_environment !== documentEnvironment) {
        throw new ValidationError(
          'The document contract environment does not match its frozen installation contract',
        );
      }
      if (doc.template_type === 'activation_contract') {
        if (Number(lockedOrder?.contract_template_mx_id)
            !== Number(doc.contract_template_mx_id)) {
          throw new ValidationError(
            'The document contract source does not match its frozen installation contract',
          );
        }
        const source = await mxRegisteredTemplateService.loadLinkedRecord(
          conn.query.bind(conn),
          {
            orgId: doc.organization_id,
            contractTemplateMxId: doc.contract_template_mx_id,
            lock: true,
          },
        );
        assertSupportedPlaceholders(source?.template_body);
        const snapshot = mxRegisteredTemplateService.assertReadyRecord(source, {
          orgId: doc.organization_id,
          bodyMd: source?.template_body,
          context: 'Signing document',
          expectedEnvironment: documentEnvironment,
        });
        if (!mxRegisteredTemplateService.snapshotMatchesRegisteredSource(doc, snapshot)) {
          throw new ValidationError(
            'The document no longer matches its frozen MX contract-source evidence',
          );
        }
      }
    }

    const isHandoffSignature = ['activation_contract', GLOBAL_ACKNOWLEDGMENT_TYPE]
      .includes(doc.template_type);
    let communicationChoicesJson = null;
    if (isHandoffSignature) {
      // A handoff document describes work presented to the customer. It must
      // not be signable immediately after lead conversion while the field
      // visit is still pending. Lock and verify the authoritative installation
      // WO, including every tenant/ownership edge carried by the document.
      if (!lockedOrder
          || Number(lockedOrder.client_id) !== Number(doc.client_id)
          || Number(lockedOrder.contract_id) !== Number(doc.contract_id)
          || lockedOrder.contract_status !== 'pending') {
        throw new ValidationError(
          'The customer handoff can only be signed while its linked new installation and pending contract are active',
        );
      }
      if (!lockedWorkOrder || !['in_progress', 'completed'].includes(lockedWorkOrder.status)) {
        throw new ValidationError('The installation visit must be in progress before the customer signs the handoff document');
      }

      const [priorChoices] = await conn.query(
        `SELECT id FROM signed_documents
          WHERE service_order_id <=> ? AND client_id = ?
            AND organization_id <=> ?
            AND id <> ? AND status = 'signed'
            AND communication_choices IS NOT NULL AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [doc.service_order_id, doc.client_id, doc.organization_id, doc.id],
      );
      if (!priorChoices[0]) {
        if (communicationChoicesConfirmed !== true) {
          throw new ValidationError('Confirm that the customer reviewed all optional communication choices');
        }
        const notice = await privacyNoticeService.getNotice(
          doc.organization_id,
          conn.query.bind(conn),
        );
        if (!privacyNoticeVersion || !privacyNoticeHash) {
          throw new ValidationError('The reviewed privacy notice version and hash are required');
        }
        if (privacyNoticeVersion !== notice.version || privacyNoticeHash !== notice.hash) {
          throw new ValidationError('The privacy notice changed while signing; reload and review the current notice');
        }
        const recordedChoices = await communicationConsentService.recordSignedChoices(
          conn.query.bind(conn),
          {
            organizationId: doc.organization_id,
            clientId: doc.client_id,
            serviceOrderId: doc.service_order_id,
            workOrderId: doc.work_order_id,
            signedDocumentId: doc.id,
            capturedBy: performedBy,
            ipAddress: signedIp,
            notice,
            choices: communicationOptIns,
          },
        );
        // Keep the complete decision (including three explicit declines) and
        // the exact notice evidence on the immutable signed document. Only
        // affirmative grants also receive subscriber_consents ledger rows.
        communicationChoicesJson = JSON.stringify({
          ...recordedChoices,
          confirmed: true,
          privacy_notice_version: notice.version,
          privacy_notice_hash: notice.hash,
        });
      }
    }

    const normalizedSignerName = String(signerName).trim();
    // MySQL DATETIME stores whole seconds. Truncate before hashing so a row
    // read back from the database reproduces the exact signing timestamp.
    const signedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    // A pending v2 row has never contributed signed evidence, so upgrade its
    // envelope at the moment evidence is first captured. Signed historical v2
    // rows are never touched (they cannot enter this pending-only path).
    const evidenceDocument = { ...doc, evidence_format_version: 3 };
    const evidenceSha256 = evidenceDigest(evidenceDocument, {
      signerName: normalizedSignerName,
      signatureImage,
      signedAt,
      signedIp: signedIp || null,
      capturedBy: performedBy || null,
      communicationChoices: communicationChoicesJson,
    });
    const updateParams = [
      normalizedSignerName, signatureImage, signedAt, signedIp || null,
      performedBy || null, communicationChoicesJson, evidenceSha256,
      documentId, doc.content_sha256,
    ];
    let updateOrg = 'organization_id IS NULL';
    if (doc.organization_id !== null && doc.organization_id !== undefined) {
      updateOrg = 'organization_id = ?';
      updateParams.push(doc.organization_id);
    }
    const [result] = await conn.query(
      `UPDATE signed_documents
          SET status = 'signed', signer_name = ?, signature_image = ?,
              signed_at = ?, signed_ip = ?, captured_by = ?,
              communication_choices = ?, evidence_sha256 = ?,
              evidence_format_version = 3
        WHERE id = ? AND content_sha256 = ? AND ${updateOrg}
          AND status = 'pending' AND deleted_at IS NULL`,
      updateParams,
    );
    if (result.affectedRows === 0) {
      throw new ValidationError('Document was signed or cancelled concurrently — reload');
    }
    const [fresh] = await conn.query('SELECT * FROM signed_documents WHERE id = ?', [documentId]);
    await conn.commit();
    return fresh[0];
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Work-order transition gate. `target` is 'in_progress' or 'completed'.
 * Returns a human-readable refusal, or null when the transition may proceed.
 */
async function pendingGateError(workOrder, target, { runner = db, lock = false } = {}) {
  if (workOrder.work_type !== 'installation' || !workOrder.service_order_id) return null;
  let gateType = target === 'in_progress' ? 'installation_authorization'
    : target === 'completed' ? 'activation_contract'
      : null;
  if (!gateType) return null;

  const run = typeof runner === 'function' ? runner : runner.query.bind(runner);
  const lockSql = lock ? ' FOR UPDATE' : '';

  // The work-order legal gates are just as jurisdictional as generation and
  // final activation. Resolve the organization from the authoritative service
  // order rather than trusting request-shaped WO data. A global org must not
  // be blocked by historical Mexican document rows left after a locale change.
  const [orderOrganizations] = await run(
    `SELECT so.organization_id, so.client_id, so.contract_id,
            c.contract_template_mx_id, c.mx_contract_environment,
            COALESCE(o.locale, 'global') AS locale
       FROM service_orders so
       LEFT JOIN organizations o ON o.id = so.organization_id
       LEFT JOIN contracts c ON c.id = so.contract_id
        AND c.organization_id = so.organization_id AND c.deleted_at IS NULL
      WHERE so.id = ? AND so.deleted_at IS NULL
      LIMIT 1${lockSql}`,
    [workOrder.service_order_id],
  );
  const orderOrganization = orderOrganizations[0];
  if (!orderOrganization) return null;
  if (orderOrganization.locale !== 'MX') {
    if (target !== 'completed') return null;
    gateType = GLOBAL_ACKNOWLEDGMENT_TYPE;
  }

  let templates;
  let registeredSource = null;
  if (orderOrganization.locale === 'MX') {
    [templates] = await run(
      `SELECT dt.*${mxRegisteredTemplateService.joinedRegistrationColumns('ctm')}
         FROM document_templates dt
         LEFT JOIN contract_templates_mx ctm ON ctm.id = dt.contract_template_mx_id
        WHERE dt.organization_id = ? AND dt.template_type = ?
          AND dt.is_active = 1 AND dt.deleted_at IS NULL
          AND (ctm.id IS NULL OR ctm.environment = ?)
        ORDER BY dt.id${lockSql}`,
      [
        orderOrganization.organization_id,
        gateType,
        orderOrganization.mx_contract_environment,
      ],
    );
    if (gateType === 'activation_contract' && templates.length) {
      try {
        registeredSource = mxRegisteredTemplateService.assertOneRegisteredSource(
          templates,
          orderOrganization.organization_id,
          orderOrganization.mx_contract_environment,
        );
      } catch (err) {
        if (err instanceof ValidationError) return err.message;
        throw err;
      }
      if (Number(orderOrganization.contract_template_mx_id)
          !== registeredSource.contractTemplateMxId) {
        return 'The contract is not linked to the registered MX template used by the active activation document';
      }
    }
  } else {
    templates = [{ id: GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID, name: GLOBAL_ACKNOWLEDGMENT_TITLE }];
  }

  // Arrival paperwork is optional: an MX organization with no active arrival
  // template may start work. A formal activation contract is mandatory before
  // an installation can be completed.
  if (!templates.length) {
    return gateType === 'activation_contract'
      ? 'Configure at least one active activation contract template and obtain the client signature before completing this installation'
      : null;
  }

  const [documents] = await run(
    `SELECT *
       FROM signed_documents
      WHERE service_order_id = ? AND organization_id = ?
        AND client_id <=> ? AND contract_id <=> ?
        AND template_type = ? AND deleted_at IS NULL${lockSql}`,
    [
      workOrder.service_order_id,
      orderOrganization.organization_id,
      orderOrganization.client_id,
      orderOrganization.contract_id,
      gateType,
    ],
  );
  const signedTemplateIds = new Set(
    documents
      .filter(document => document.status === 'signed'
        && signatureEvidenceIsValid(document)
        && (!registeredSource
          || mxRegisteredTemplateService.snapshotMatchesRegisteredSource(
            document,
            registeredSource,
          )))
      .map(document => Number(document.template_id)),
  );
  const unsignedTemplate = templates.find(
    template => !signedTemplateIds.has(Number(template.id)),
  );
  if (!unsignedTemplate) return null;

  return gateType === 'installation_authorization'
    ? `The client must sign "${unsignedTemplate.name}" (installation authorization) before work starts — open Documents on this work order`
    : gateType === GLOBAL_ACKNOWLEDGMENT_TYPE
      ? `The client must sign "${unsignedTemplate.name}" before this installation can be completed — open Documents on this work order`
      : `The client must sign "${unsignedTemplate.name}" (activation contract) before this installation can be completed — open Documents on this work order`;
}

module.exports = {
  render,
  assertSupportedPlaceholders,
  SUPPORTED_PLACEHOLDERS,
  buildContext,
  generateForOrder,
  sign,
  pendingGateError,
  GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID,
  GLOBAL_ACKNOWLEDGMENT_TYPE,
  GLOBAL_ACKNOWLEDGMENT_TITLE,
  SANDBOX_WATERMARK,
  evidenceDigest,
  verifyEvidence,
  signatureEvidenceIsValid,
};
