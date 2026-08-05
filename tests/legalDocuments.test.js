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

const TOKEN = jwt.sign(
  { sub: 1, email: 'a@b.c', role: 'admin', orgId: 42 },
  config.jwt.secret, { expiresIn: '1h' },
);
const isAuthLookup = (s) => typeof s === 'string' && /`users`/.test(s);
const ADMIN_ROW = [[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 42 }]];

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------
describe('render', () => {
  it('substitutes nested paths, keeps unknown placeholders visible, and dashes empty values', () => {
    const out = svc.render(
      'Yo {{client.name}} (RFC {{client.rfc}}) autorizo a {{org.name}} — {{typo.here}}',
      { client: { name: 'María', rfc: null }, org: { name: 'MX ISP' } },
    );
    expect(out).toBe('Yo María (RFC —) autorizo a MX ISP — {{typo.here}}');
  });
});

// ---------------------------------------------------------------------------
// generateForOrder
// ---------------------------------------------------------------------------
describe('generateForOrder', () => {
  function runner(state) {
    return async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT locale FROM organizations/.test(s)) return [[{ locale: state.locale ?? 'MX' }]];
      if (/FROM document_templates/.test(s)) return [state.templates];
      if (/FROM clients WHERE/.test(s)) return [[{ id: 9, name: 'María', email: 'm@x.mx', address: 'Calle 1', city: 'CDMX' }]];
      if (/FROM contracts WHERE/.test(s)) return [[{ id: 33, plan_id: 2, connection_type: 'pppoe', start_date: '2026-08-05' }]];
      if (/FROM plans WHERE/.test(s)) return [[{ id: 2, name: 'Inalambrico 50', price: '400.00' }]];
      if (/FROM service_orders WHERE/.test(s)) return [[{ id: 16, order_number: 'SO-000016', address: 'Calle 1, CDMX' }]];
      if (/FROM organizations WHERE/.test(s)) return [[{ id: 42, name: 'MX ISP', legal_name: 'MX ISP SA' }]];
      if (/FROM organization_mx_profiles/.test(s)) return [[{ rfc: 'AAA010101AAA', razon_social: 'MX ISP SA de CV' }]];
      if (/FROM client_mx_profiles/.test(s)) return [[{ rfc: 'FAPM900215AB7' }]];
      if (/^INSERT INTO signed_documents/.test(s.trim())) {
        state.inserts.push(sql);
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

    const skipped = await svc.generateForOrder(runner({ ...state, inserts: [] }), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
      skipTypes: new Set(['installation_authorization']),
    });
    expect(skipped).toHaveLength(1);
    expect(skipped[0].template_type).toBe('activation_contract');
  });

  it('STRICTLY MX: a global-locale org generates nothing, even with active templates', async () => {
    const state = {
      locale: 'global',
      templates: [{ id: 1, template_type: 'installation_authorization', name: 'X', body_md: 'Y' }],
      inserts: [],
    };
    const created = await svc.generateForOrder(runner(state), {
      orgId: 42, clientId: 9, contractId: 33, orderId: 16, workOrderId: 13, createdBy: 1,
    });
    expect(created).toEqual([]);
    expect(state.inserts).toHaveLength(0);
  });

  it('an org-less (single-tenant legacy) context generates nothing', async () => {
    const created = await svc.generateForOrder(async () => { throw new Error('must not query'); }, {
      orgId: null, clientId: 9, contractId: 33, orderId: 16, workOrderId: null, createdBy: 1,
    });
    expect(created).toEqual([]);
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

  function wire(doc) {
    db.query.mockImplementation(async (sql) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT \* FROM signed_documents WHERE id = \?/.test(sql)) return [doc ? [{ ...doc }] : []];
      if (/UPDATE signed_documents\s+SET status = 'signed'/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM signed_documents WHERE id = \?$/.test(String(sql).trim())) return [[{ ...doc, status: 'signed' }]];
      return [[]];
    });
  }

  it('signs a pending, hash-intact document', async () => {
    wire({ id: 7, organization_id: 42, status: 'pending', rendered_body: BODY, content_sha256: HASH });
    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María Fiscal Prueba', signature_image: SIG });
    expect(res.status).toBe(200);
    const upd = db.query.mock.calls.find(([s]) => /SET status = 'signed'/.test(s));
    expect(upd[0]).toMatch(/status = 'pending'/); // guarded — no double-sign race
    expect(upd[1][0]).toBe('María Fiscal Prueba');
  });

  it('refuses when the stored body no longer matches its generation hash', async () => {
    wire({ id: 7, organization_id: 42, status: 'pending', rendered_body: BODY + ' tampered', content_sha256: HASH });
    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/integrity/i);
  });

  it('refuses a non-pending document and a non-image payload', async () => {
    wire({ id: 7, organization_id: 42, status: 'signed', rendered_body: BODY, content_sha256: HASH });
    const res = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: SIG });
    expect(res.status).toBe(422);

    wire({ id: 7, organization_id: 42, status: 'pending', rendered_body: BODY, content_sha256: HASH });
    const res2 = await request(app)
      .post('/api/v1/signed-documents/7/sign')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ signer_name: 'María', signature_image: 'javascript:alert(1)//AAAAAAAAAAAAAAAAAAAAAA' });
    expect(res2.status).toBe(422);
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

  function wire({ before, pendingDocs }) {
    db.query.mockImplementation(async (sql, params) => {
      if (isAuthLookup(sql)) return ADMIN_ROW;
      if (/SELECT \* FROM work_orders WHERE id = \? AND organization_id = \?/.test(sql)) return [[{ ...before }]];
      if (/FROM signed_documents/.test(sql)) {
        const type = params[1];
        const hit = pendingDocs.find(d => d.template_type === type);
        return [hit ? [{ id: hit.id, title: hit.title }] : []];
      }
      if (/UPDATE work_orders SET/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM work_orders WHERE id = \?$/.test(String(sql).trim())) return [[{ ...before, status: 'x' }]];
      return [[]];
    });
  }

  it('blocks in_progress while the arrival authorization is pending', async () => {
    wire({ before: INSTALL_WO, pendingDocs: [{ id: 1, template_type: 'installation_authorization', title: 'Autorización de instalación' }] });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toMatch(/Autorización de instalación.*before work starts/);
    expect(db.query.mock.calls.some(([s]) => /UPDATE work_orders SET/.test(s))).toBe(false);
  });

  it('blocks completed while the activation contract is pending', async () => {
    wire({ before: { ...INSTALL_WO, status: 'in_progress' }, pendingDocs: [{ id: 2, template_type: 'activation_contract', title: 'Contrato de adhesión' }] });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toMatch(/Contrato de adhesión.*before this installation can be completed/);
  });

  it('passes both transitions once nothing is pending', async () => {
    wire({ before: { ...INSTALL_WO, status: 'in_progress' }, pendingDocs: [] });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });
    expect(res.status).toBe(200);
  });

  it('never gates a non-installation work order', async () => {
    wire({ before: { ...INSTALL_WO, work_type: 'repair' }, pendingDocs: [{ id: 1, template_type: 'installation_authorization', title: 'X' }] });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });
});
