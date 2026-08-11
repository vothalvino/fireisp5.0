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
      if (/FROM organization_mx_profiles/.test(s)) return [[{ rfc: 'AAA010101AAA', razon_social: 'MX ISP SA de CV', profeco_registro: state.profeco ?? null, carta_derechos_url: null }]];
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

  it('serializes template creation on the organization row', async () => {
    authorizeMx();
    const conn = connection(async (sql) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: 42 }]];
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
        body_md: 'New reviewed body', is_active: true,
      });

    expect(res.status).toBe(201);
    const orgLock = conn.query.mock.calls.find(([sql]) => /SELECT id FROM organizations/.test(sql));
    expect(orgLock[0]).toMatch(/FOR UPDATE/);
    expect(conn.commit).toHaveBeenCalled();
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
        }]];
      }
      if (/SELECT id, status FROM work_orders/.test(sql)) {
        return [[{ id: 13, status: 'assigned' }]];
      }
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
          locale,
        }]];
      }
      if (/FROM document_templates/.test(sql)) {
        return [templates.filter(template => template.template_type === params[1])];
      }
      if (/FROM signed_documents/.test(sql)) {
        return [documents.filter(document => (
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

  it('never consults or blocks on historical MX documents after an organization switches to global', async () => {
    wire({
      before: { ...INSTALL_WO, status: 'in_progress' },
      locale: 'global',
      templates: [{ id: 2, template_type: 'activation_contract', name: 'Old Mexican contract' }],
      documents: [{ template_id: 2, template_type: 'activation_contract', status: 'cancelled' }],
    });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });

    expect(res.status).toBe(200);
    expect(db.query.mock.calls.some(([sql]) => /FROM signed_documents/.test(sql))).toBe(false);
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
