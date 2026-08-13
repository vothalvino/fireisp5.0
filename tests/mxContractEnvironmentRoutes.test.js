'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../src/middleware/orgLocale', () => ({
  requireMxLocale: (_req, _res, next) => next(),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const TOKEN = jwt.sign(
  { sub: 1, email: 'admin@example.test', role: 'admin', orgId: 42 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

const USER = [{
  id: 1,
  email: 'admin@example.test',
  role: 'admin',
  status: 'active',
  organization_id: 42,
}];

function productionTemplate() {
  const body = '# Registered production contract';
  return {
    id: 8,
    organization_id: 42,
    template_type: 'activation_contract',
    name: 'Production contract',
    body_md: body,
    is_active: 1,
    contract_template_mx_id: 71,
    mx_id: 71,
    mx_organization_id: 42,
    mx_registration_number: 'PROFECO-2026-001',
    mx_registered_at: '2026-08-01',
    mx_template_version: '1.0',
    mx_template_body: body,
    mx_contract_environment: 'production',
    mx_status: 'registered',
    mx_deleted_at: null,
  };
}

function connection({ inFlight = false, liveSandbox = false } = {}) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn(),
  };
  conn.query.mockImplementation(async (sql) => {
    const normalized = String(sql).replace(/\s+/g, ' ');
    if (/SELECT o\.id, o\.locale, omp\.id AS profile_id/.test(normalized)) {
      return [[{
        id: 42, locale: 'MX', profile_id: 99, contract_environment: 'sandbox',
      }]];
    }
    if (/SELECT o\.locale, CASE/.test(normalized)) {
      return [[{ locale: 'MX', contract_environment: 'production' }]];
    }
    if (/FROM document_templates dt/.test(normalized)) return [[productionTemplate()]];
    if (/AS pending_contract/.test(normalized)) {
      return [[{
        pending_contract: inFlight ? 1 : 0,
        open_installation: 0,
        pending_document: 0,
      }]];
    }
    if (/AS live_contract/.test(normalized)) {
      return [[{ live_contract: liveSandbox ? 1 : 0 }]];
    }
    if (/UPDATE organization_mx_profiles/.test(normalized)) return [{ affectedRows: 1 }];
    if (/INSERT INTO audit_logs/.test(normalized)) return [{ insertId: 700 }];
    return [[]];
  });
  db.getConnection.mockResolvedValue(conn);
  return conn;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation(async (sql) => {
    if (/`users`/.test(String(sql))) return [USER];
    if (/SELECT o\.locale,/.test(String(sql))) {
      return [[{ locale: 'MX', contract_environment: 'sandbox', mx_profile_id: 99 }]];
    }
    return [[]];
  });
});

describe('MX contract environment switch', () => {
  test('GET is independent and defaults explicitly to the organization contract lane', async () => {
    const response = await request(app)
      .get('/api/v1/consumer-protection/contract-environment')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ contract_environment: 'sandbox' });
  });

  test('preserves a pre-452 production setup when registry rows exist without an MX profile', async () => {
    db.query.mockImplementation(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ');
      if (/`users`/.test(normalized)) return [USER];
      if (/SELECT o\.locale,/.test(normalized)) {
        return [[{ locale: 'MX', contract_environment: 'production', mx_profile_id: null }]];
      }
      return [[]];
    });

    const response = await request(app)
      .get('/api/v1/consumer-protection/contract-environment')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ contract_environment: 'production' });
    const environmentQuery = db.query.mock.calls.find(([sql]) => /SELECT o\.locale,/.test(String(sql)));
    expect(environmentQuery[0]).toMatch(/EXISTS[\s\S]*contract_templates_mx[\s\S]*environment = 'production'/);
  });

  test('switches transactionally only after production source preflight and audits in the transaction', async () => {
    const conn = connection();
    const response = await request(app)
      .put('/api/v1/consumer-protection/contract-environment')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42')
      .send({ contract_environment: 'production' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      contract_environment: 'production',
      active_contract_source_id: 71,
    });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO audit_logs/.test(sql))).toBe(true);
    const inFlightPreflight = conn.query.mock.calls.find(([sql]) => /AS pending_contract/.test(sql));
    expect(inFlightPreflight[0]).toMatch(/c\.mx_contract_environment IS NULL/);
    expect(inFlightPreflight[0]).toMatch(/LEFT JOIN contracts c/);
    expect(inFlightPreflight[0]).toMatch(/so\.contract_id IS NULL/);
  });

  test('refuses a switch while a current-lane installation is nonterminal', async () => {
    const conn = connection({ inFlight: true });
    const response = await request(app)
      .put('/api/v1/consumer-protection/contract-environment')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42')
      .send({ contract_environment: 'production' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONTRACT_ENVIRONMENT_IN_FLIGHT');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE organization_mx_profiles/.test(sql)))
      .toBe(false);
  });

  test('never carries a live sandbox contract into production', async () => {
    const conn = connection({ liveSandbox: true });
    const response = await request(app)
      .put('/api/v1/consumer-protection/contract-environment')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42')
      .send({ contract_environment: 'production' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LIVE_SANDBOX_CONTRACTS');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
});

describe('profile-less MX contract-source configuration', () => {
  function profilelessSourceDb() {
    db.query.mockImplementation(async (sql, params) => {
      const normalized = String(sql).replace(/\s+/g, ' ');
      if (/`users`/.test(normalized)) return [USER];
      if (/SELECT o\.locale,/.test(normalized)) {
        return [[{ locale: 'MX', contract_environment: 'sandbox', mx_profile_id: null }]];
      }
      if (/INSERT INTO `contract_templates_mx`/.test(normalized)) {
        return [{ insertId: 81, affectedRows: 1 }];
      }
      if (/SELECT \* FROM `contract_templates_mx` WHERE id = \?/.test(normalized)) {
        return [[{
          id: 81, organization_id: 42, environment: 'sandbox',
          template_name: 'Simulation contract', template_body: 'Test-only text',
          version: 'test-1', status: 'sandbox_ready', deleted_at: null,
        }]];
      }
      if (/INSERT INTO audit_logs/.test(normalized)) return [{ insertId: 700 }];
      return [[], params];
    });
  }

  test('rejects creating a production source until an active MX profile exists', async () => {
    profilelessSourceDb();

    const response = await request(app)
      .post('/api/v1/consumer-protection/contract-templates-mx')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42')
      .send({
        template_name: 'Future production contract',
        template_body: 'Reviewed production text',
        version: '1.0', environment: 'production', status: 'draft',
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/MX profile.*production contract source/i);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO `contract_templates_mx`/.test(sql)))
      .toBe(false);
  });

  test('allows a profile-less MX organization to create its sandbox source explicitly', async () => {
    profilelessSourceDb();

    const response = await request(app)
      .post('/api/v1/consumer-protection/contract-templates-mx')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42')
      .send({
        template_name: 'Simulation contract', template_body: 'Test-only text',
        version: 'test-1', environment: 'sandbox', status: 'sandbox_ready',
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      environment: 'sandbox', status: 'sandbox_ready',
    }));
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO `contract_templates_mx`/.test(sql)))
      .toBe(true);
  });

  test('rejects a typoed placeholder before creating an immutable-ready sandbox source', async () => {
    profilelessSourceDb();

    const response = await request(app)
      .post('/api/v1/consumer-protection/contract-templates-mx')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42')
      .send({
        template_name: 'Simulation contract',
        template_body: 'Cliente {{client.nmae}}',
        version: 'test-1',
        environment: 'sandbox',
        status: 'sandbox_ready',
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/unsupported or unresolved.*client\.nmae/i);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO `contract_templates_mx`/.test(sql)))
      .toBe(false);
  });

  test('rejects promoting a legacy draft with a bad body to sandbox-ready', async () => {
    db.query.mockImplementation(async (sql) => (/`users`/.test(String(sql)) ? [USER] : [[]]));
    const old = {
      id: 81,
      organization_id: 42,
      environment: 'sandbox',
      template_name: 'Legacy draft',
      template_body: 'Cliente {{client.nmae}}',
      version: 'test-1',
      status: 'draft',
      deleted_at: null,
    };
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
      execute: jest.fn(async (sql) => {
        const normalized = String(sql).replace(/\s+/g, ' ');
        if (/SELECT \* FROM `contract_templates_mx`/.test(normalized)) return [[old]];
        return [[]];
      }),
    };
    db.getConnection.mockResolvedValue(conn);

    const response = await request(app)
      .put('/api/v1/consumer-protection/contract-templates-mx/81')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42')
      .send({ status: 'sandbox_ready' });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/unsupported or unresolved.*client\.nmae/i);
    expect(conn.execute.mock.calls.some(([sql]) => /^UPDATE `contract_templates_mx`/.test(sql)))
      .toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  test('requires an explicit immutable lane when creating a source', async () => {
    profilelessSourceDb();

    const response = await request(app)
      .post('/api/v1/consumer-protection/contract-templates-mx')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42')
      .send({
        template_name: 'Unclassified source', template_body: 'Text',
        version: '1.0', status: 'draft',
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/environment is required/i);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO `contract_templates_mx`/.test(sql)))
      .toBe(false);
  });

  test('rejects restoring a production source until an active MX profile exists', async () => {
    db.query.mockImplementation(async (sql) => (/`users`/.test(String(sql)) ? [USER] : [[]]));
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
      execute: jest.fn(async (sql) => {
        const normalized = String(sql).replace(/\s+/g, ' ');
        if (/FROM contract_templates_mx/.test(normalized)) {
          return [[{ id: 71, environment: 'production' }]];
        }
        if (/FROM organization_mx_profiles/.test(normalized)) return [[]];
        return [[]];
      }),
    };
    db.getConnection.mockResolvedValue(conn);

    const response = await request(app)
      .post('/api/v1/consumer-protection/contract-templates-mx/71/restore')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Org-Id', '42');

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/MX profile.*restoring.*production/i);
    expect(conn.execute.mock.calls.some(([sql]) => /^UPDATE `contract_templates_mx`/.test(sql)))
      .toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });
});
