'use strict';
// =============================================================================
// FireISP 5.0 — legal document templates + on-site signing (migration 447)
// =============================================================================
// render() placeholder semantics, generateForOrder freezing+hashing, sign()
// integrity/validation, the WO transition gates, and the /generate dedupe.
// =============================================================================

const crypto = require('crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');
const svc = require('../src/services/legalDocumentService');
const { mockTxConnection } = require('./fixtures/mockTxConnection');

const TOKEN = jwt.sign(
  { sub: 1, email: 'a@b.c', role: 'admin', orgId: 42 },
  config.jwt.secret, { expiresIn: '1h' },
);
const isAuthLookup = (s) => typeof s === 'string' && /`users`/.test(s);
const ADMIN_ROW = [[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 42 }]];
const MX_SOURCE_ID = 71;
function registeredTemplate(template) {
  if (template.template_type !== 'activation_contract') return template;
  if (template.__unlinked) {
    const { __unlinked: _marker, ...unlinked } = template;
    return unlinked;
  }
  const bodyMd = template.body_md ?? 'Registered MX activation body';
  return {
    is_active: 1,
    body_md: bodyMd,
    contract_template_mx_id: MX_SOURCE_ID,
    mx_id: MX_SOURCE_ID,
    mx_organization_id: 42,
    mx_registration_number: 'IFT-2026-001',
    mx_registered_at: '2026-01-15',
    mx_template_version: '1.0',
    mx_template_body: bodyMd,
    mx_contract_environment: 'production',
    mx_status: 'registered',
    mx_deleted_at: null,
    ...template,
  };
}

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------
describe('render', () => {
  it('substitutes nested paths and dashes supported empty values', () => {
    const out = svc.render(
      'Yo {{client.name}} (RFC {{client.rfc}}, razón social {{client.razon_social}}) autorizo a {{org.name}}',
      {
        client: { name: 'María', rfc: null, razon_social: undefined },
        org: { name: 'MX ISP' },
      },
    );
    expect(out).toBe('Yo María (RFC —, razón social —) autorizo a MX ISP');
  });

  it('rejects unknown placeholders instead of returning signable-looking text', () => {
    expect(() => svc.render(
      'Yo {{client.name}} — {{client.raozn_social}}',
      { client: { name: 'María', razon_social: null } },
    )).toThrow(/unsupported or unresolved.*client\.raozn_social/i);
  });

  it.each([
    '{{{client.name}}}',
    '{{client.name}}}',
    '{{{client.name}}',
    '{{client.name}',
    '{client.name}}',
    '{{}}',
    '{{client.{{name}}',
    '{{client-name}}',
  ])('rejects malformed placeholder syntax: %s', (body) => {
    expect(() => svc.render(body, { client: { name: 'María' } }))
      .toThrow(/unsupported or unresolved.*placeholder/i);
  });
});

// ---------------------------------------------------------------------------
// generateForOrder
// ---------------------------------------------------------------------------
describe('generateForOrder', () => {
  function runner(state) {
    return async (sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT locale FROM organizations/.test(s)) return [[{ locale: state.locale ?? 'MX' }]];
      if (/FROM document_templates/.test(s)) return [state.templates.map(registeredTemplate)];
      if (/FROM clients WHERE/.test(s)) return [[{ id: 9, name: 'María', email: 'm@x.mx', address: 'Calle 1', city: 'CDMX' }]];
      if (/FROM contracts WHERE/.test(s)) return [[{
        id: 33,
        plan_id: 2,
        connection_type: 'pppoe',
        start_date: state.contractStartDate ?? '2026-08-05',
        contract_template_mx_id: MX_SOURCE_ID,
        mx_contract_environment: state.contractEnvironment || 'production',
      }]];
      if (/FROM plans WHERE/.test(s)) return [[state.plan ?? { id: 2, name: 'Inalambrico 50', price: '400.00' }]];
      if (/FROM service_orders WHERE/.test(s)) return [[{ id: 16, order_number: 'SO-000016', address: 'Calle 1, CDMX' }]];
      if (/FROM organizations WHERE/.test(s)) return [[state.org ?? { id: 42, name: 'MX ISP', legal_name: 'MX ISP SA' }]];
      if (/FROM organization_mx_profiles/.test(s)) return [[{ rfc: 'AAA010101AAA', razon_social: 'MX ISP SA de CV', profeco_registro: state.profeco ?? null, carta_derechos_url: null }]];
      if (/FROM client_mx_profiles/.test(s)) return [[state.clientMx ?? { rfc: 'FAPM900215AB7' }]];
      if (/^INSERT INTO signed_documents/.test(s.trim())) {
        state.inserts.push(sql);
        state.insertParams = state.insertParams || [];
        state.insertParams.push(params);
        return [{ insertId: state.inserts.length }];
      }
      return [[]];
    };
  }

  it('freezes one hashed pending instance per active template, skipping skipTypes', async () => {
    const state = {
      templates: [
        { id: 1, template_type: 'installation_authorization', name: 'Autorización', body_md: 'Cliente {{client.name}}, orden {{order.number}}' },
        { id: 2, template_type: 'activation_contract', name: 'Contrato', body_md: 'Plan {{plan.name}} para {{client.name}}' },
      ],
      inserts: [],
    };
    const created = await svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    });
    expect(created).toHaveLength(2);
    expect(created.map(c => c.template_type)).toEqual(['installation_authorization', 'activation_contract']);
    expect(state.insertParams[1].slice(10, 15)).toEqual([
      MX_SOURCE_ID,
      'IFT-2026-001',
      '2026-01-15',
      '1.0',
      crypto.createHash('sha256').update('Plan {{plan.name}} para {{client.name}}').digest('hex'),
    ]);

    const skipped = await svc.generateForOrder(runner({ ...state, inserts: [] }), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
      skipTypes: new Set(['installation_authorization']),
    });
    expect(skipped).toHaveLength(1);
    expect(skipped[0].template_type).toBe('activation_contract');
  });

  it('can backfill an exact newly-active template ID without duplicating another template of the same type', async () => {
    const state = {
      templates: [
        { id: 2, template_type: 'activation_contract', name: 'Contrato original', body_md: 'Original' },
        { id: 7, template_type: 'activation_contract', name: 'Nuevo anexo', body_md: 'Nuevo {{client.name}}' },
      ],
      inserts: [],
    };
    const created = await svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
      onlyTemplateIds: new Set([7]),
    });

    expect(created).toEqual([{ id: 1, template_type: 'activation_contract', title: 'Nuevo anexo' }]);
    expect(state.inserts).toHaveLength(1);
  });

  it('watermarks sandbox contracts and snapshots mode without fake official registration data', async () => {
    const state = {
      contractEnvironment: 'sandbox',
      templates: [{
        id: 8,
        template_type: 'activation_contract',
        name: 'Sandbox contract',
        body_md: 'Test plan for {{client.name}}',
        mx_contract_environment: 'sandbox',
        mx_status: 'sandbox_ready',
        mx_registration_number: null,
        mx_registered_at: null,
      }],
      inserts: [],
    };

    await svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    });

    const params = state.insertParams[0];
    expect(params[8]).toMatch(/^> \*\*PRUEBA \/ SIMULACIÓN — NO REGISTRADO ANTE PROFECO — SIN EFECTOS LEGALES\*\*/);
    expect(params[8]).toMatch(/not an official PROFECO sandbox or registration/i);
    expect(params.slice(11, 13)).toEqual([null, null]);
    expect(params[15]).toBe('sandbox');
    expect(state.inserts[0]).toMatch(/evidence_format_version[\s\S]*3/);
  });

  it('renders an absent optional client razon_social deterministically', async () => {
    const state = {
      clientMx: { rfc: 'FAPM900215AB7', curp: null },
      templates: [{
        id: 9,
        template_type: 'activation_contract',
        name: 'Contrato',
        body_md: 'RFC {{client.rfc}} — CURP {{client.curp}} — Razón social {{client.razon_social}}',
      }],
      inserts: [],
    };

    await svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    });

    expect(state.insertParams[0][8]).toBe(
      'RFC FAPM900215AB7 — CURP — — Razón social —',
    );
  });

  it('uses current plan speed columns and the organization tax-id fallback', async () => {
    const state = {
      plan: {
        id: 2, name: 'Fibra 100', download_speed_mbps: 100,
        upload_speed_mbps: 25, price: '500.00',
      },
      org: { id: 42, name: 'MX ISP', tax_id: 'ORG010101AAA' },
      templates: [{
        id: 11,
        template_type: 'activation_contract',
        name: 'Contrato',
        body_md: 'Velocidad {{plan.download}}/{{plan.upload}} Mbps — RFC {{org.rfc}}',
      }],
      inserts: [],
    };
    const base = runner(state);
    const run = async (sql, params) => {
      if (/FROM organization_mx_profiles/.test(String(sql).replace(/\s+/g, ' '))) return [[]];
      return base(sql, params);
    };

    await svc.generateForOrder(run, {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    });

    expect(state.insertParams[0][8]).toBe(
      'Velocidad 100/25 Mbps — RFC ORG010101AAA',
    );
  });

  it('renders a mysql2 Date contract start_date as a timezone-safe calendar date', async () => {
    const state = {
      contractStartDate: new Date('2026-08-05T00:00:00.000Z'),
      templates: [{
        id: 12,
        template_type: 'activation_contract',
        name: 'Contrato',
        body_md: 'Inicio {{contract.start_date}}',
      }],
      inserts: [],
    };

    await svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    });

    expect(state.insertParams[0][8]).toBe('Inicio 2026-08-05');
  });

  it('fails closed before freezing a template with an unknown placeholder', async () => {
    const state = {
      templates: [{
        id: 10,
        template_type: 'activation_contract',
        name: 'Contrato con error',
        body_md: 'Razón social {{client.raozn_social}}',
      }],
      inserts: [],
    };

    await expect(svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    })).rejects.toThrow(/unsupported or unresolved.*client\.raozn_social/i);
    expect(state.inserts).toHaveLength(0);
  });

  it('generates one bundled neutral acknowledgment for a global-locale org', async () => {
    const state = {
      locale: 'global',
      templates: [{ id: 1, template_type: 'installation_authorization', name: 'X', body_md: 'Y' }],
      inserts: [],
    };
    const created = await svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    });
    expect(created).toEqual([{
      id: 1,
      template_type: 'service_acknowledgment',
      title: 'Service installation acknowledgment',
    }]);
    expect(state.inserts).toHaveLength(1);
    expect(state.insertParams[0].slice(10, 15)).toEqual([null, null, null, null, null]);
  });

  it('fails closed before rendering when the order is outside the exact tenant/client/contract chain', async () => {
    const state = { locale: 'global', templates: [], inserts: [] };
    const base = runner(state);
    const run = async (sql, params) => {
      if (/FROM service_orders WHERE/.test(String(sql).replace(/\s+/g, ' '))) return [[]];
      return base(sql, params);
    };

    await expect(svc.generateForOrder(run, {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    })).rejects.toThrow(/one active tenant-scoped chain/i);
    expect(state.inserts).toHaveLength(0);
  });

  it('fails closed for an active legacy MX activation template with no registered-source link', async () => {
    const state = {
      templates: [{
        id: 2, template_type: 'activation_contract', name: 'Legacy contract',
        body_md: 'Unregistered body', is_active: 1, __unlinked: true,
      }],
      inserts: [],
    };
    await expect(svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    })).rejects.toThrow(/not linked|missing registered-source/i);
    expect(state.inserts).toHaveLength(0);
  });

  it('an org-less (single-tenant legacy) context generates nothing', async () => {
    const created = await svc.generateForOrder(async () => { throw new Error('must not query'); }, {
      orgId: null, clientId: 9, contractId: 33, orderId: 16, workOrderId: null, createdBy: 1,
    });
    expect(created).toEqual([]);
  });

  it('renders {{org.profeco_registro}} and defaults {{org.carta_derechos_url}} to the official IFT document', async () => {
    const state = {
      profeco: 'PROFECO-4321-2026',
      templates: [{ id: 3, template_type: 'activation_contract', name: 'Contrato', body_md: 'Registro {{org.profeco_registro}} — derechos: {{org.carta_derechos_url}}' }],
      inserts: [],
    };
    let renderedBody = null;
    const base = runner(state);
    const run = async (sql, params) => {
      if (/^INSERT INTO signed_documents/.test(String(sql).replace(/\s+/g, ' ').trim())) renderedBody = params[8];
      return base(sql, params);
    };
    await svc.generateForOrder(run, { orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1 });
    expect(renderedBody).toContain('Registro PROFECO-4321-2026');
    expect(renderedBody).toContain('https://www.ift.org.mx/');
  });

  it('returns [] and reads nothing else when no template is active', async () => {
    const reads = [];
    const run = async (sql) => {
      reads.push(String(sql));
      if (/SELECT locale FROM organizations/.test(sql)) return [[{ locale: 'MX' }]];
      if (/FROM document_templates/.test(sql)) return [[]];
      return [[]];
    };
    const created = await svc.generateForOrder(run, { orgId: 42, clientId: 9, contractId: null, orderId: 16, workOrderId: null, createdBy: 1 });
    expect(created).toEqual([]);
    expect(reads).toHaveLength(2); // locale + templates, nothing else
  });
});

// ---------------------------------------------------------------------------
// sign()
// ---------------------------------------------------------------------------
describe('POST /signed-documents/:id/sign', () => {
  const BODY = 'Yo María autorizo la instalación.';
  const HASH = crypto.createHash('sha256').update(BODY, 'utf8').digest('hex');
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const NOTICE = 'Reviewed installation privacy notice';
  const NOTICE_VERSION = 'install-v1';
  const NOTICE_HASH = crypto.createHash('sha256').update(NOTICE, 'utf8').digest('hex');

  function wire(inputDoc, { templateBody = 'Reviewed {{client.name}}' } = {}) {
    const doc = inputDoc?.template_type === 'service_acknowledgment'
      ? inputDoc
      : { template_id: 17, ...inputDoc };
    mockTxConnection(db);
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT service_order_id, organization_id, work_order_id/.test(sql)) {
        return [doc ? [{ ...doc }] : []];
      }
      if (/SELECT \* FROM signed_documents[\s\S]*FOR UPDATE/.test(sql)) return [doc ? [{ ...doc }] : []];
      if (/FROM document_templates[\s\S]*LIMIT 1 FOR UPDATE/.test(sql)) {
        return [templateBody === null ? [] : [{
          template_type: doc.template_type,
          body_md: templateBody,
        }]];
      }
      if (/UPDATE signed_documents[\s\S]*SET status = 'signed'/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM signed_documents WHERE id = \?$/.test(String(sql).trim())) return [[{ ...doc, status: 'signed' }]];
      return [[]];
    });
  }

  it('signs a pending, hash-intact document', async () => {
    wire({ id: 7, organization_id: 42, template_type: 'installation_authorization', status: 'pending', rendered_body: BODY, content_sha256: HASH });
    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María Fiscal Prueba', signature_image: SIG });
    expect(res.status).toBe(200);
    const upd = db.query.mock.calls.find(([s]) => /SET status = 'signed'/.test(s));
    expect(upd[0]).toMatch(/status = 'pending'/); // guarded — no double-sign race
    expect(upd[0]).toMatch(/evidence_format_version = 3/);
    expect(upd[1][0]).toBe('María Fiscal Prueba');
  });

  it('refuses when the stored body no longer matches its generation hash', async () => {
    wire({ id: 7, organization_id: 42, template_type: 'installation_authorization', status: 'pending', rendered_body: BODY + ' tampered', content_sha256: HASH });
    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/integrity/i);
  });

  it('refuses to sign a previously frozen body that still contains a placeholder', async () => {
    const unresolvedBody = 'Yo {{client.razon_social}} autorizo la instalación.';
    wire({
      id: 7,
      organization_id: 42,
      template_type: 'installation_authorization',
      status: 'pending',
      rendered_body: unresolvedBody,
      content_sha256: crypto.createHash('sha256').update(unresolvedBody, 'utf8').digest('hex'),
    });

    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/unsupported or unresolved.*placeholder/i);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE signed_documents/.test(sql))).toBe(false);
  });

  it('refuses a legacy partially-rendered body when its original template has malformed braces', async () => {
    const legacyRenderedBody = 'Yo {María} autorizo la instalación.';
    wire({
      id: 7,
      organization_id: 42,
      template_id: 17,
      template_type: 'installation_authorization',
      status: 'pending',
      rendered_body: legacyRenderedBody,
      content_sha256: crypto.createHash('sha256').update(legacyRenderedBody, 'utf8').digest('hex'),
    }, { templateBody: 'Yo {{{client.name}}} autorizo la instalación.' });

    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/unsupported or unresolved.*placeholder/i);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE signed_documents/.test(sql))).toBe(false);
  });

  it.each([null, 0])(
    'refuses a non-global pending document whose physical template id is %s',
    async (templateId) => {
      wire({
        id: 7,
        organization_id: 42,
        template_id: templateId,
        template_type: 'installation_authorization',
        status: 'pending',
        rendered_body: BODY,
        content_sha256: HASH,
      });

      const res = await request(app)
        .post('/api/v1/signed-documents/7/sign')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ signer_name: 'María', signature_image: SIG });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/original legal document template is missing/i);
      expect(db.query.mock.calls.some(([sql]) => /UPDATE signed_documents/.test(sql))).toBe(false);
    },
  );

  it('refuses a non-pending document and a non-image payload', async () => {
    wire({ id: 7, organization_id: 42, template_type: 'installation_authorization', status: 'signed', rendered_body: BODY, content_sha256: HASH });
    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });
    expect(res.status).toBe(422);

    wire({ id: 7, organization_id: 42, template_type: 'installation_authorization', status: 'pending', rendered_body: BODY, content_sha256: HASH });
    const res2 = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: 'javascript:alert(1)//AAAAAAAAAAAAAAAAAAAAAA' });
    expect(res2.status).toBe(422);

    wire({ id: 7, organization_id: 42, template_type: 'installation_authorization', status: 'pending', rendered_body: BODY, content_sha256: HASH });
    const res3 = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: 'data:image/png;base64,bm90LXJlYWxseS1wbmc=' });
    expect(res3.status).toBe(422);
    expect(res3.body.error.message).toMatch(/valid PNG\/JPEG bytes/i);
  });

  it('captures channel-specific marketing choices atomically with a handoff signature', async () => {
    const doc = {
      id: 7,
      organization_id: 42,
      client_id: 9,
      contract_id: 33,
      service_order_id: 16,
      work_order_id: 13,
      template_type: 'service_acknowledgment',
      status: 'pending',
      rendered_body: BODY,
      content_sha256: HASH,
    };
    const conn = mockTxConnection(db);
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT service_order_id, organization_id, work_order_id/.test(sql)) {
        return [[{ ...doc }]];
      }
      if (/FROM service_orders so/.test(sql)) {
        return [[{
          id: doc.service_order_id, order_type: 'new_install', status: 'in_process',
          client_id: doc.client_id, contract_id: doc.contract_id, contract_status: 'pending',
        }]];
      }
      if (/SELECT \* FROM signed_documents[\s\S]*FOR UPDATE/.test(sql)) return [[{ ...doc }]];
      if (/FROM work_orders/.test(sql)) return [[{ id: 13, status: 'in_progress' }]];
      if (/communication_choices IS NOT NULL/.test(sql)) return [[]];
      if (/FROM organizations WHERE id/.test(sql)) {
        return [[{
          name: 'Global ISP', legal_name: 'Global ISP LLC', email: 'privacy@example.test',
          locale: 'global', privacy_notice: NOTICE, privacy_notice_version: NOTICE_VERSION,
        }]];
      }
      if (/SELECT email, phone FROM clients/.test(sql)) {
        return [[{ email: 'client@example.test', phone: '+526141234567' }]];
      }
      if (/UPDATE signed_documents/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM signed_documents WHERE id = \?$/.test(String(sql).trim())) {
        return [[{ ...doc, status: 'signed', signer_name: 'María' }]];
      }
      return [{ affectedRows: 1, insertId: 91 }];
    });

    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        signer_name: 'María',
        signature_image: SIG,
        communication_opt_ins: { email: true, sms: false, whatsapp: true },
        communication_choices_confirmed: true,
        privacy_notice_version: NOTICE_VERSION,
        privacy_notice_hash: NOTICE_HASH,
      });

    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    const consentWrites = conn.query.mock.calls.filter(([sql]) => /INSERT INTO subscriber_consents/.test(sql));
    expect(consentWrites).toHaveLength(2);
    const signedUpdate = conn.query.mock.calls.find(([sql]) => /UPDATE signed_documents/.test(sql));
    expect(signedUpdate[0]).toMatch(/captured_by = \?/);
    expect(signedUpdate[0]).toMatch(/evidence_sha256 = \?/);
    expect(signedUpdate[1]).toContain(1);
    expect(JSON.parse(signedUpdate[1][5])).toEqual({
      email: true,
      sms: false,
      whatsapp: true,
      confirmed: true,
      privacy_notice_version: NOTICE_VERSION,
      privacy_notice_hash: NOTICE_HASH,
    });
  });

  it('refuses to record choices when the notice changed after it was reviewed', async () => {
    const doc = {
      id: 7, organization_id: 42, client_id: 9, contract_id: 33,
      service_order_id: 16, work_order_id: 13,
      template_type: 'service_acknowledgment', status: 'pending',
      rendered_body: BODY, content_sha256: HASH,
    };
    const conn = mockTxConnection(db);
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT service_order_id, organization_id, work_order_id/.test(sql)) {
        return [[{ ...doc }]];
      }
      if (/FROM service_orders so/.test(sql)) {
        return [[{
          id: doc.service_order_id, order_type: 'new_install', status: 'in_process',
          client_id: doc.client_id, contract_id: doc.contract_id, contract_status: 'pending',
        }]];
      }
      if (/SELECT \* FROM signed_documents[\s\S]*FOR UPDATE/.test(sql)) return [[doc]];
      if (/FROM work_orders/.test(sql)) return [[{ id: 13, status: 'in_progress' }]];
      if (/communication_choices IS NOT NULL/.test(sql)) return [[]];
      if (/FROM organizations WHERE id/.test(sql)) {
        return [[{
          name: 'Global ISP', legal_name: 'Global ISP LLC', locale: 'global',
          privacy_notice: NOTICE, privacy_notice_version: NOTICE_VERSION,
        }]];
      }
      return [[]];
    });

    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        signer_name: 'María',
        signature_image: SIG,
        communication_opt_ins: { email: false, sms: false, whatsapp: false },
        communication_choices_confirmed: true,
        privacy_notice_version: NOTICE_VERSION,
        privacy_notice_hash: 'a'.repeat(64),
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/privacy notice changed/i);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE signed_documents/.test(sql))).toBe(false);
  });

  it('refuses a handoff signature until every optional communication choice is reviewed', async () => {
    const conn = mockTxConnection(db);
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT service_order_id, organization_id, work_order_id/.test(sql)) {
        return [[{
          service_order_id: 16, organization_id: 42, work_order_id: 13,
          client_id: 9, contract_id: 33, template_type: 'activation_contract',
        }]];
      }
      if (/FROM service_orders so/.test(sql)) {
        return [[{
          id: 16, order_type: 'new_install', status: 'in_process',
          client_id: 9, contract_id: 33, contract_status: 'pending',
        }]];
      }
      if (/SELECT \* FROM signed_documents[\s\S]*FOR UPDATE/.test(sql)) {
        return [[{
          id: 7, organization_id: 42, client_id: 9, contract_id: 33,
          service_order_id: 16, work_order_id: 13,
          template_id: 17, template_type: 'activation_contract', status: 'pending',
          rendered_body: BODY, content_sha256: HASH,
        }]];
      }
      if (/FROM document_templates[\s\S]*LIMIT 1 FOR UPDATE/.test(sql)) {
        return [[{ template_type: 'activation_contract', body_md: 'Reviewed {{client.name}}' }]];
      }
      if (/FROM work_orders/.test(sql)) return [[{ id: 13, status: 'in_progress' }]];
      if (/communication_choices IS NOT NULL/.test(sql)) return [[]];
      return [[]];
    });

    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/communication choices/i);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE signed_documents/.test(sql))).toBe(false);
  });

  it('refuses a handoff signature before the installation visit is in progress', async () => {
    const conn = mockTxConnection(db);
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT service_order_id, organization_id, work_order_id/.test(sql)) {
        return [[{
          service_order_id: 16, organization_id: 42, work_order_id: 13,
          client_id: 9, contract_id: 33, template_type: 'service_acknowledgment',
        }]];
      }
      if (/FROM service_orders so/.test(sql)) {
        return [[{
          id: 16, order_type: 'new_install', status: 'in_process',
          client_id: 9, contract_id: 33, contract_status: 'pending',
        }]];
      }
      if (/SELECT \* FROM signed_documents[\s\S]*FOR UPDATE/.test(sql)) {
        return [[{
          id: 7, organization_id: 42, client_id: 9, contract_id: 33,
          service_order_id: 16, work_order_id: 13,
          template_type: 'service_acknowledgment', status: 'pending',
          rendered_body: BODY, content_sha256: HASH,
        }]];
      }
      if (/FROM work_orders/.test(sql)) return [[{ id: 13, status: 'assigned' }]];
      return [[]];
    });

    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/visit must be in progress/i);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it('refuses a pending signature after its installation order was cancelled', async () => {
    const doc = {
      id: 7, organization_id: 42, client_id: 9, contract_id: 33,
      service_order_id: 16, work_order_id: 13,
      template_type: 'service_acknowledgment', status: 'pending',
      rendered_body: BODY, content_sha256: HASH,
    };
    const conn = mockTxConnection(db);
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT service_order_id, organization_id, work_order_id/.test(sql)) return [[{ ...doc }]];
      if (/FROM work_orders/.test(sql)) return [[{ id: 13, status: 'completed' }]];
      if (/FROM service_orders so/.test(sql)) {
        return [[{
          id: 16, order_type: 'new_install', status: 'cancelled',
          client_id: 9, contract_id: 33, contract_status: 'cancelled',
        }]];
      }
      if (/SELECT \* FROM signed_documents[\s\S]*FOR UPDATE/.test(sql)) return [[doc]];
      return [[]];
    });

    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/installation is active/i);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE signed_documents/.test(sql))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it('does not reset communication choices when a second required MX document is signed', async () => {
    const doc = {
      id: 8, organization_id: 42, client_id: 9, contract_id: 33,
      service_order_id: 16, work_order_id: 13,
      template_id: 17, template_type: 'activation_contract', status: 'pending',
      rendered_body: BODY, content_sha256: HASH,
    };
    const conn = mockTxConnection(db);
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT service_order_id, organization_id, work_order_id/.test(sql)) {
        return [[{ ...doc }]];
      }
      if (/FROM service_orders so/.test(sql)) {
        return [[{
          id: doc.service_order_id, order_type: 'new_install', status: 'in_process',
          client_id: doc.client_id, contract_id: doc.contract_id, contract_status: 'pending',
        }]];
      }
      if (/SELECT \* FROM signed_documents[\s\S]*FOR UPDATE/.test(sql)) return [[doc]];
      if (/FROM document_templates[\s\S]*LIMIT 1 FOR UPDATE/.test(sql)) {
        return [[{ template_type: 'activation_contract', body_md: 'Reviewed {{client.name}}' }]];
      }
      if (/FROM work_orders/.test(sql)) return [[{ id: 13, status: 'in_progress' }]];
      if (/communication_choices IS NOT NULL/.test(sql)) return [[{ id: 7 }]];
      if (/UPDATE signed_documents/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM signed_documents WHERE id = \?$/.test(String(sql).trim())) {
        return [[{ ...doc, status: 'signed' }]];
      }
      return [[]];
    });

    const res = await request(app)
      .post('/api/v1/signed-documents/8/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });

    expect(res.status).toBe(200);
    expect(conn.query.mock.calls.some(([sql]) => /subscriber_consents/.test(sql))).toBe(false);
    expect(conn.query.mock.calls.some(([sql]) => /client_dnd_preferences/.test(sql))).toBe(false);
    const update = conn.query.mock.calls.find(([sql]) => /UPDATE signed_documents/.test(sql));
    expect(update[1][5]).toBeNull();
  });

  it('detects tampering in the complete signed-evidence envelope', () => {
    const document = {
      id: 7, organization_id: 42, client_id: 9, contract_id: 33,
      service_order_id: 16, work_order_id: 13,
      template_type: 'activation_contract', title: 'Registered service contract',
      rendered_body: BODY, content_sha256: HASH, signed_at: '2026-08-11T06:00:00.000Z',
      contract_template_mx_id: MX_SOURCE_ID,
      mx_registration_number: 'IFT-2026-001', mx_registered_at: '2026-01-15',
      mx_template_version: '1.0', mx_source_sha256: crypto.createHash('sha256').update('Official').digest('hex'),
      signer_name: 'María', signature_image: SIG, signed_ip: '127.0.0.1',
      captured_by: 1,
      communication_choices: JSON.stringify({
        email: false, sms: false, whatsapp: false, confirmed: true,
        privacy_notice_version: NOTICE_VERSION, privacy_notice_hash: NOTICE_HASH,
      }),
    };
    document.evidence_sha256 = svc.evidenceDigest(document);
    expect(svc.verifyEvidence(document)).toBe(true);
    expect(svc.verifyEvidence({ ...document, rendered_body: `${BODY} tampered` })).toBe(false);
    expect(svc.verifyEvidence({ ...document, signed_at: '2026-08-11T06:00:01.000Z' })).toBe(false);
    expect(svc.verifyEvidence({ ...document, title: 'Changed title' })).toBe(false);
    expect(svc.verifyEvidence({ ...document, signer_name: 'Changed name' })).toBe(false);
    expect(svc.verifyEvidence({ ...document, mx_template_version: 'tampered' })).toBe(false);
    expect(svc.verifyEvidence({
      ...document,
      communication_choices: JSON.stringify({
        email: true, sms: false, whatsapp: false, confirmed: true,
        privacy_notice_version: NOTICE_VERSION, privacy_notice_hash: NOTICE_HASH,
      }),
    })).toBe(false);
  });

  it('keeps historical v2 evidence valid while v3 binds the frozen contract environment', () => {
    const base = {
      id: 7, organization_id: 42, client_id: 9, contract_id: 33,
      service_order_id: 16, work_order_id: 13,
      template_type: 'activation_contract', title: 'Contract',
      rendered_body: BODY, content_sha256: HASH,
      contract_template_mx_id: MX_SOURCE_ID,
      mx_registration_number: 'IFT-2026-001', mx_registered_at: '2026-01-15',
      mx_template_version: '1.0', mx_source_sha256: crypto.createHash('sha256').update('Official').digest('hex'),
      signer_name: 'María', signature_image: SIG, signed_at: '2026-08-11T06:00:00.000Z',
      signed_ip: '127.0.0.1', captured_by: 1, communication_choices: null,
    };
    const legacy = { ...base, evidence_format_version: 2 };
    legacy.evidence_sha256 = svc.evidenceDigest(legacy);
    expect(svc.verifyEvidence({ ...legacy, mx_contract_environment: 'sandbox' })).toBe(true);

    const current = {
      ...base,
      evidence_format_version: 3,
      mx_contract_environment: 'sandbox',
    };
    current.evidence_sha256 = svc.evidenceDigest(current);
    expect(svc.verifyEvidence(current)).toBe(true);
    expect(svc.verifyEvidence({ ...current, mx_contract_environment: 'production' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Templates surface is STRICTLY MX
// ---------------------------------------------------------------------------
describe('document-templates routes refuse non-MX orgs', () => {
  const Organization = require('../src/models/Organization');

  it('403s MX_ONLY for a global-locale org', async () => {
    jest.spyOn(Organization, 'getLocale').mockResolvedValue('global');
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      return [[]];
    });
    const res = await request(app)
      .get('/api/v1/document-templates')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MX_ONLY');
  });

  it('passes for an MX org', async () => {
    jest.spyOn(Organization, 'getLocale').mockResolvedValue('MX');
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/FROM document_templates/.test(sql)) return [[]];
      return [[]];
    });
    const res = await request(app)
      .get('/api/v1/document-templates')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Template-version integrity
// ---------------------------------------------------------------------------
describe('document-template version integrity', () => {
  const Organization = require('../src/models/Organization');

  function connection(handler) {
    return {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(handler),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
  }

  function authorizeMx() {
    jest.spyOn(Organization, 'getLocale').mockResolvedValue('MX');
    db.query.mockImplementation(async (sql) => (isAuthLookup(sql) ? ADMIN_ROW : [[]]));
  }

  it('rejects an unsupported placeholder before creating a template', async () => {
    authorizeMx();
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/document-templates')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        name: 'Contrato con typo',
        template_type: 'installation_authorization',
        body_md: 'Cliente {{client.nmae}}',
        is_active: false,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/unsupported or unresolved.*client\.nmae/i);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO document_templates/.test(sql)))
      .toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it('rejects activating an inactive legacy template with a bad frozen body', async () => {
    authorizeMx();
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/SELECT \* FROM document_templates/.test(sql) && /FOR UPDATE/.test(sql)) {
        return [[{
          id: 7,
          organization_id: 42,
          template_type: 'installation_authorization',
          name: 'Legacy typo',
          body_md: 'Cliente {{client.nmae}}',
          contract_template_mx_id: null,
          is_active: 0,
        }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .put('/api/v1/document-templates/7')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ is_active: true });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/unsupported or unresolved.*client\.nmae/i);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE document_templates/.test(sql)))
      .toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it('rejects material edits while a template is active', async () => {
    authorizeMx();
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/SELECT \* FROM document_templates/.test(sql) && /FOR UPDATE/.test(sql)) {
        return [[{
          id: 7, organization_id: 42, template_type: 'activation_contract',
          name: 'Contrato v1', body_md: 'Reviewed body', is_active: 1,
        }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .put('/api/v1/document-templates/7')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ body_md: 'Silently changed body' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/deactivate.*before changing/i);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE document_templates/.test(sql)))
      .toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('permanently rejects material edits after any generated instance exists', async () => {
    authorizeMx();
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/SELECT \* FROM document_templates/.test(sql) && /FOR UPDATE/.test(sql)) {
        return [[{
          id: 7, organization_id: 42, template_type: 'activation_contract',
          name: 'Contrato v1', body_md: 'Reviewed body', is_active: 0,
        }]];
      }
      if (/FROM signed_documents WHERE template_id/.test(sql)) return [[{ id: 91 }]];
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .put('/api/v1/document-templates/7')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: 'Rewritten signed version' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/permanently immutable.*new template version/i);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE document_templates/.test(sql)))
      .toBe(false);
  });

  it('allows deactivation without changing immutable legal content', async () => {
    authorizeMx();
    const active = {
      id: 7, organization_id: 42, template_type: 'activation_contract',
      name: 'Contrato v1', body_md: 'Reviewed body', is_active: 1,
    };
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/SELECT \* FROM document_templates/.test(sql) && /FOR UPDATE/.test(sql)) {
        return [[active]];
      }
      if (/UPDATE document_templates/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM document_templates WHERE id/.test(sql)) {
        return [[{ ...active, is_active: 0 }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .put('/api/v1/document-templates/7')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ is_active: false });

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(0);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /FROM signed_documents/.test(sql)))
      .toBe(false);
  });

  it.each(['expired', 'revoked'])(
    'allows active-template deactivation after its registered source becomes %s',
    async (sourceStatus) => {
      authorizeMx();
      const active = {
        id: 7, organization_id: 42, template_type: 'activation_contract',
        name: 'Contrato v1', body_md: 'Reviewed body', is_active: 1,
        contract_template_mx_id: MX_SOURCE_ID,
      };
      const conn = connection(async (sql) => {
        if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
        if (/SELECT \* FROM document_templates/.test(sql) && /FOR UPDATE/.test(sql)) {
          return [[active]];
        }
        if (/FROM contract_templates_mx/.test(sql)) {
          return [[{
            id: MX_SOURCE_ID, organization_id: 42, template_name: 'Registered v1',
            ift_registration_number: 'IFT-2026-001', registered_at: '2026-01-15',
            version: '1.0', template_body: 'Reviewed body', status: sourceStatus,
            deleted_at: null,
          }]];
        }
        if (/UPDATE document_templates/.test(sql)) return [{ affectedRows: 1 }];
        if (/SELECT \* FROM document_templates WHERE id/.test(sql)) {
          return [[{ ...active, is_active: 0 }]];
        }
        return [[]];
      });
      db.getConnection.mockResolvedValue(conn);

      const res = await request(app)
        .put('/api/v1/document-templates/7')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ is_active: false });

      expect(res.status).toBe(200);
      expect(res.body.data.is_active).toBe(0);
      expect(conn.commit).toHaveBeenCalled();
    },
  );

  it('does not use deactivation to rewrite active legal content after source revocation', async () => {
    authorizeMx();
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/SELECT \* FROM document_templates/.test(sql) && /FOR UPDATE/.test(sql)) {
        return [[{
          id: 7, organization_id: 42, template_type: 'activation_contract',
          name: 'Contrato v1', body_md: 'Reviewed body', is_active: 1,
          contract_template_mx_id: MX_SOURCE_ID,
        }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .put('/api/v1/document-templates/7')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ is_active: false, body_md: 'Rewritten while deactivating' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/deactivate.*before changing/i);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE document_templates/.test(sql)))
      .toBe(false);
  });

  it('serializes template creation on the organization row', async () => {
    authorizeMx();
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/FROM contract_templates_mx/.test(sql)) {
        return [[{
          id: MX_SOURCE_ID, organization_id: 42, template_name: 'Registered v2',
          ift_registration_number: 'IFT-2026-001', registered_at: '2026-01-15',
          version: '2.0', template_body: 'New reviewed body', status: 'registered',
        }]];
      }
      if (/INSERT INTO document_templates/.test(sql)) return [{ insertId: 8 }];
      if (/SELECT \* FROM document_templates WHERE id/.test(sql)) {
        return [[{ id: 8, organization_id: 42, is_active: 1 }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/document-templates')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        name: 'Contrato v2', template_type: 'activation_contract',
        body_md: 'New reviewed body', contract_template_mx_id: MX_SOURCE_ID, is_active: true,
      });

    expect(res.status).toBe(201);
    const orgLock = conn.query.mock.calls.find(([sql]) => /SELECT id FROM organizations/.test(sql));
    expect(orgLock[0]).toMatch(/FOR UPDATE/);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rejects a second active source in the same contract environment at write time', async () => {
    authorizeMx();
    const proposedBody = 'Production source A';
    const existingBody = 'Production source B';
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/FROM contract_templates_mx[\s\S]*WHERE id =/.test(sql)) {
        return [[{
          id: 71, organization_id: 42, environment: 'production',
          template_name: 'Source A', ift_registration_number: 'PROFECO-A',
          registered_at: '2026-08-01', version: '1', template_body: proposedBody,
          status: 'registered', deleted_at: null,
        }]];
      }
      if (/FROM document_templates dt/.test(sql)) {
        return [[registeredTemplate({
          id: 9, template_type: 'activation_contract',
          name: 'Existing production contract', body_md: existingBody,
          contract_template_mx_id: 72, mx_id: 72,
          mx_template_body: existingBody, mx_registration_number: 'PROFECO-B',
        })]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/document-templates')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        name: 'Production source A', template_type: 'activation_contract',
        body_md: proposedBody, contract_template_mx_id: 71, is_active: true,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/same contract source/i);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO document_templates/.test(sql)))
      .toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('allows active sandbox and production sources to coexist in separate lanes', async () => {
    authorizeMx();
    const sandboxBody = 'Sandbox exact text';
    const conn = connection(async (sql, params) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/FROM contract_templates_mx[\s\S]*WHERE id =/.test(sql)) {
        return [[{
          id: 81, organization_id: 42, environment: 'sandbox',
          template_name: 'Simulation source', ift_registration_number: null,
          registered_at: null, version: 'test-1', template_body: sandboxBody,
          status: 'sandbox_ready', deleted_at: null,
        }]];
      }
      if (/FROM document_templates dt/.test(sql)) {
        expect(params).toEqual([42, 'sandbox']);
        return [[]];
      }
      if (/INSERT INTO document_templates/.test(sql)) return [{ insertId: 10 }];
      if (/SELECT \* FROM document_templates WHERE id/.test(sql)) {
        return [[{ id: 10, organization_id: 42, is_active: 1 }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/document-templates')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        name: 'Sandbox simulation', template_type: 'activation_contract',
        body_md: sandboxBody, contract_template_mx_id: 81, is_active: true,
      });

    expect(res.status).toBe(201);
    const laneRead = conn.query.mock.calls.find(([sql]) => /FROM document_templates dt/.test(sql));
    expect(laneRead[0]).toMatch(/ctm\.environment = \?/);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rejects activation when the operational text differs from the registered MX source', async () => {
    authorizeMx();
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
      if (/FROM contract_templates_mx/.test(sql)) {
        return [[{
          id: MX_SOURCE_ID, organization_id: 42, template_name: 'Registered source',
          ift_registration_number: 'IFT-2026-001', registered_at: '2026-01-15',
          version: '1.0', template_body: 'Official exact text', status: 'registered',
        }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/document-templates')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        name: 'Changed copy', template_type: 'activation_contract',
        body_md: 'Official exact text with an edit',
        contract_template_mx_id: MX_SOURCE_ID, is_active: true,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/exactly match/i);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO document_templates/.test(sql))).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('generic generation requests every missing exact template ID instead of skipping a whole type', async () => {
    authorizeMx();
    const generate = jest.spyOn(svc, 'generateForOrder').mockResolvedValue([{
      id: 92, template_type: 'installation_authorization', title: 'Second arrival form',
    }]);
    const conn = connection(async (sql) => {
      if (/SELECT \* FROM service_orders/.test(sql)) {
        return [[{
          id: 16, organization_id: 42, client_id: 9, contract_id: 33,
          order_type: 'new_install', status: 'in_process',
        }]];
      }
      if (/SELECT id, status FROM work_orders/.test(sql)) {
        return [[{ id: 13, status: 'assigned' }]];
      }
      if (/SELECT locale FROM organizations/.test(sql)) return [[{ locale: 'MX' }]];
      if (/SELECT dt\.id FROM document_templates/.test(sql)) return [[{ id: 4 }]];
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post('/api/v1/signed-documents/generate')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ service_order_id: 16 });

    expect(res.status).toBe(201);
    expect(generate).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      orderId: 16,
      workOrderId: 13,
      onlyTemplateIds: new Set([4]),
    }));
    const missing = conn.query.mock.calls.find(([sql]) => /SELECT dt\.id FROM document_templates/.test(sql));
    expect(missing[0]).toMatch(/sd\.template_id = dt\.id/);
    expect(missing[0]).not.toMatch(/DISTINCT template_type/);
    const workOrderLookup = conn.query.mock.calls.find(([sql]) => /SELECT id, status FROM work_orders/.test(sql));
    expect(workOrderLookup[0]).toMatch(/organization_id <=> \?/);
    expect(workOrderLookup[0]).toMatch(/client_id = \? AND contract_id = \?/);
    expect(conn.commit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Work-order gates
// ---------------------------------------------------------------------------
describe('legal gates on work-order transitions', () => {
  const INSTALL_WO = {
    id: 13, organization_id: 42, client_id: 9, site_id: null, device_id: null,
    contract_id: 33, service_order_id: 16, ticket_id: null, assigned_to: null,
    title: 'Installation — SO-000016', description: null, status: 'assigned',
    priority: 'medium', work_type: 'installation', scheduled_at: null,
    started_at: null, completed_at: null, latitude: null, longitude: null,
    address: null, notes: null,
    acceptance_signal_dbm: -58, acceptance_link_mbps: null, acceptance_rx_dbm: null,
    acceptance_waived: 0, acceptance_notes: null, acceptance_recorded_at: null,
  };

  function wire({ before, templates = [], documents = [], locale = 'MX' }) {
    const conn = mockTxConnection(db);
    const linkedTemplates = templates.map(registeredTemplate);
    const linkedDocuments = documents.map((document, index) => {
      const template = linkedTemplates.find(row => Number(row.id) === Number(document.template_id));
      const renderedBody = document.rendered_body || `Signed fixture ${index + 1}`;
      const linked = {
        id: document.id ?? 100 + index,
        organization_id: document.organization_id ?? before.organization_id,
        client_id: document.client_id ?? before.client_id,
        contract_id: document.contract_id ?? before.contract_id,
        service_order_id: document.service_order_id ?? before.service_order_id,
        work_order_id: document.work_order_id ?? before.id,
        title: document.title || template?.name || 'Service installation acknowledgment',
        rendered_body: renderedBody,
        content_sha256: document.content_sha256
          || crypto.createHash('sha256').update(renderedBody).digest('hex'),
        signer_name: document.signer_name || 'María',
        signature_image: document.signature_image || 'data:image/png;base64,aGVsbG8=',
        signed_at: document.signed_at || '2026-08-11T06:00:00.000Z',
        signed_ip: document.signed_ip || '127.0.0.1',
        captured_by: document.captured_by || 1,
        ...(document.template_type === 'activation_contract' ? {
          contract_template_mx_id: MX_SOURCE_ID,
          mx_registration_number: 'IFT-2026-001',
          mx_registered_at: '2026-01-15',
          mx_template_version: '1.0',
          mx_source_sha256: crypto.createHash('sha256').update(template?.body_md || '').digest('hex'),
        } : {}),
        ...document,
      };
      if (linked.status === 'signed'
          && (linked.template_type === 'service_acknowledgment'
            || linked.template_type === 'activation_contract')) {
        linked.evidence_sha256 = document.evidence_sha256 || svc.evidenceDigest(linked);
      }
      return linked;
    });
    db.query.mockImplementation(async (sql, params) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT \* FROM work_orders\s+WHERE id = \? AND organization_id = \?/.test(sql)) return [[{ ...before }]];
      if (/SELECT so\.id, so\.order_type, so\.status, so\.contract_id/.test(sql)) {
        return [[{
          id: before.service_order_id,
          order_type: 'new_install',
          status: 'in_process',
          contract_id: before.contract_id,
          client_id: before.client_id,
          linked_contract_id: before.contract_id,
          contract_client_id: before.client_id,
        }]];
      }
      if (/SELECT so\.order_type, so\.contract_id AS order_contract_id/.test(sql)) {
        return [[{
          order_type: 'new_install',
          order_contract_id: before.contract_id,
          linked_contract_id: before.contract_id,
          test_window_expires_at: null,
          test_window_cleanup_pending: 0,
          has_commissioning_test: 1,
        }]];
      }
      if (/SELECT so\.organization_id, so\.client_id, so\.contract_id/.test(sql)) {
        return [[{
          organization_id: before.organization_id,
          client_id: before.client_id,
          contract_id: before.contract_id,
          contract_template_mx_id: locale === 'MX' ? MX_SOURCE_ID : null,
          locale,
        }]];
      }
      if (/FROM document_templates/.test(sql)) {
        return [linkedTemplates.filter(template => template.template_type === params[1])];
      }
      if (/FROM signed_documents/.test(sql)) {
        return [linkedDocuments.filter(document => (
          document.template_type === params[4]
          && (document.service_order_id ?? before.service_order_id) === params[0]
          && (document.organization_id ?? before.organization_id) === params[1]
          && (document.client_id ?? before.client_id) === params[2]
          && (document.contract_id ?? before.contract_id) === params[3]
        ))];
      }
      if (/UPDATE work_orders SET/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM work_orders WHERE id = \?$/.test(String(sql).trim())) return [[{ ...before, status: 'x' }]];
      return [[]];
    });
    return conn;
  }

  it('blocks in_progress while the arrival authorization is pending', async () => {
    wire({
      before: INSTALL_WO,
      templates: [{ id: 1, template_type: 'installation_authorization', name: 'Autorización de instalación' }],
      documents: [{ template_id: 1, template_type: 'installation_authorization', status: 'pending' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Autorización de instalación.*before work starts/);
    expect(db.query.mock.calls.some(([s]) => /UPDATE work_orders SET/.test(s))).toBe(false);
  });

  it('blocks in_progress when an active arrival template has no exact document instance', async () => {
    wire({
      before: INSTALL_WO,
      templates: [{ id: 1, template_type: 'installation_authorization', name: 'Autorización de llegada' }],
      documents: [],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Autorización de llegada.*before work starts/);
  });

  it('blocks in_progress when the exact arrival document was cancelled', async () => {
    wire({
      before: INSTALL_WO,
      templates: [{ id: 1, template_type: 'installation_authorization', name: 'Autorización de llegada' }],
      documents: [{ template_id: 1, template_type: 'installation_authorization', status: 'cancelled' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Autorización de llegada/);
  });

  it('allows in_progress only when each active arrival template has an exact signed instance', async () => {
    const conn = wire({
      before: INSTALL_WO,
      templates: [{ id: 1, template_type: 'installation_authorization', name: 'Autorización de llegada' }],
      documents: [{ template_id: 1, template_type: 'installation_authorization', status: 'signed' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    const transactionSql = conn.query.mock.calls.map(([sql]) => String(sql));
    const templateCheck = transactionSql.findIndex(sql => /FROM document_templates/.test(sql));
    const statusWrite = transactionSql.findIndex(sql => /UPDATE work_orders SET/.test(sql));
    expect(transactionSql[templateCheck]).toMatch(/FOR UPDATE/);
    expect(statusWrite).toBeGreaterThan(templateCheck);
  });

  it('blocks a late-added second arrival template until that exact template is signed', async () => {
    wire({
      before: INSTALL_WO,
      templates: [
        { id: 1, template_type: 'installation_authorization', name: 'Autorización original' },
        { id: 4, template_type: 'installation_authorization', name: 'Autorización adicional' },
      ],
      documents: [{ template_id: 1, template_type: 'installation_authorization', status: 'signed' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Autorización adicional/);
  });

  it('does not accept a signed arrival document from a different service order', async () => {
    wire({
      before: INSTALL_WO,
      templates: [{ id: 1, template_type: 'installation_authorization', name: 'Autorización de llegada' }],
      documents: [{
        template_id: 1,
        template_type: 'installation_authorization',
        status: 'signed',
        service_order_id: 999,
      }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(422);
  });

  it('allows in_progress when MX has no active arrival templates', async () => {
    wire({ before: INSTALL_WO });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
  });

  it('blocks completed while the activation contract is pending', async () => {
    wire({
      before: { ...INSTALL_WO, status: 'in_progress' },
      templates: [{ id: 2, template_type: 'activation_contract', name: 'Contrato de adhesión' }],
      documents: [{ template_id: 2, template_type: 'activation_contract', status: 'pending' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Contrato de adhesión.*before this installation can be completed/);
  });

  it('blocks completion when no active activation-contract template is configured', async () => {
    wire({ before: { ...INSTALL_WO, status: 'in_progress' } });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Configure at least one active activation contract template/);
  });

  it('requires a signed instance for every active activation-contract template', async () => {
    wire({
      before: { ...INSTALL_WO, status: 'in_progress' },
      templates: [
        { id: 2, template_type: 'activation_contract', name: 'Contrato principal' },
        { id: 3, template_type: 'activation_contract', name: 'Anexo contractual' },
      ],
      documents: [{ template_id: 2, template_type: 'activation_contract', status: 'signed' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Anexo contractual/);
  });

  it('passes completion once every active activation contract is signed', async () => {
    wire({
      before: { ...INSTALL_WO, status: 'in_progress' },
      templates: [{ id: 2, template_type: 'activation_contract', name: 'Contrato de adhesión' }],
      documents: [{ template_id: 2, template_type: 'activation_contract', status: 'signed' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });
    expect(res.status).toBe(200);
  });

  it('ignores historical MX documents after a locale switch but requires the global acknowledgment', async () => {
    wire({
      before: { ...INSTALL_WO, status: 'in_progress' },
      locale: 'global',
      templates: [{ id: 2, template_type: 'activation_contract', name: 'Old Mexican contract' }],
      documents: [
        { template_id: 2, template_type: 'activation_contract', status: 'cancelled' },
        { template_id: null, template_type: 'service_acknowledgment', status: 'signed' },
      ],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });

    expect(res.status).toBe(200);
    expect(db.query.mock.calls.some(([sql]) => /FROM signed_documents/.test(sql))).toBe(true);
  });

  it('never gates a non-installation work order', async () => {
    wire({
      before: { ...INSTALL_WO, work_type: 'repair' },
      templates: [{ id: 1, template_type: 'installation_authorization', name: 'X' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });
});
