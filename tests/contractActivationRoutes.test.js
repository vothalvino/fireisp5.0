'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/contractActivationService', () => ({
  getActivationState: jest.fn(),
  prepareActivation: jest.fn(),
  activate: jest.fn(),
  cancelActivation: jest.fn(),
  retryNetworkActivation: jest.fn(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const activationService = require('../src/services/contractActivationService');
const mxRegisteredTemplateService = require('../src/services/mxRegisteredContractTemplateService');
const provisioningService = require('../src/services/subscriberProvisioningService');
const { ValidationError } = require('../src/utils/errors');
const app = require('../src/app');

const TOKEN = jwt.sign(
  { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
  config.jwt.secret,
  { expiresIn: '1h' },
);
const VIEWER_TOKEN = jwt.sign(
  { sub: 2, email: 'viewer@example.com', role: 'technician', orgId: 42 },
  config.jwt.secret,
  { expiresIn: '1h' },
);
const STATE = {
  contract_id: 33, status: 'pending', connection_type: 'pppoe',
  test_window_expires_at: null, radius_status: 'inactive',
  arrival_authorization_pending: false,
  document_sync_required: false,
  service_order: { id: 16, status: 'in_process' },
  service_order_prepared: true,
  work_order: { id: 13, status: 'assigned' },
  work_order_prepared: true,
  documents: [], speed_test: null, can_activate: false,
  speed_test_recorded: false,
  blockers: ['work_order_not_completed', 'speed_test_missing'],
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation(async (sql) => {
    if (/`users`/.test(String(sql))) {
      return [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];
    }
    return [[]];
  });
});
afterEach(() => jest.restoreAllMocks());

test('GET /contracts/:id/activation returns the org-scoped readiness payload', async () => {
  activationService.getActivationState.mockResolvedValue(STATE);
  const res = await request(app)
    .get('/api/v1/contracts/33/activation')
    .set('Authorization', `Bearer ${TOKEN}`);

  expect(res.status).toBe(200);
  expect(res.body.data.blockers).toContain('speed_test_missing');
  expect(activationService.getActivationState).toHaveBeenCalledWith('33', {
    orgId: 42, includeDocuments: true, includeServiceOrder: true,
    includeWorkOrder: true, includeSpeedTest: true,
  });
});

test('GET readiness hides MX document metadata when the caller lacks signed_documents.view', async () => {
  jest.spyOn(User, 'getPermissions').mockResolvedValue(['contracts.view']);
  db.query.mockImplementation(async (sql) => {
    if (/`users`/.test(String(sql))) {
      return [[{
        id: 2, email: 'viewer@example.com', role: 'technician', status: 'active', organization_id: 42,
      }]];
    }
    return [[]];
  });
  activationService.getActivationState.mockResolvedValue({
    ...STATE,
    documents: [],
    service_order: null,
    work_order: null,
    speed_test: null,
    speed_test_recorded: true,
    arrival_authorization_pending: true,
  });

  const res = await request(app)
    .get('/api/v1/contracts/33/activation')
    .set('Authorization', `Bearer ${VIEWER_TOKEN}`);

  expect(res.status).toBe(200);
  expect(res.body.data.arrival_authorization_pending).toBe(true);
  expect(res.body.data.documents).toEqual([]);
  expect(res.body.data.service_order).toBeNull();
  expect(res.body.data.work_order).toBeNull();
  expect(res.body.data.speed_test).toBeNull();
  expect(res.body.data.speed_test_recorded).toBe(true);
  expect(activationService.getActivationState).toHaveBeenCalledWith('33', {
    orgId: 42, includeDocuments: false, includeServiceOrder: false,
    includeWorkOrder: false, includeSpeedTest: false,
  });
});

test('contracts.update alone cannot prepare an installation or create its side effects', async () => {
  jest.spyOn(User, 'getPermissions').mockResolvedValue(['contracts.view', 'contracts.update']);
  db.query.mockImplementation(async (sql) => {
    if (/`users`/.test(String(sql))) {
      return [[{
        id: 2, email: 'viewer@example.com', role: 'technician', status: 'active',
        organization_id: 42,
      }]];
    }
    return [[]];
  });
  const res = await request(app)
    .post('/api/v1/contracts/33/activation/prepare')
    .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
    .send({});

  expect(res.status).toBe(403);
  expect(res.body.error.message).toMatch(/installations\.start/i);
  expect(activationService.prepareActivation).not.toHaveBeenCalled();
});

test('operator with installations.start can prepare without receiving unauthorized metadata', async () => {
  jest.spyOn(User, 'getPermissions').mockResolvedValue([
    'contracts.view', 'contracts.update', 'installations.start',
  ]);
  db.query.mockImplementation(async (sql) => {
    if (/`users`/.test(String(sql))) {
      return [[{
        id: 2, email: 'viewer@example.com', role: 'technician', status: 'active',
        organization_id: 42,
      }]];
    }
    return [[]];
  });
  activationService.prepareActivation.mockResolvedValue({
    ...STATE,
    documents: [],
    speed_test: null,
    document_sync_required: false,
  });

  const res = await request(app)
    .post('/api/v1/contracts/33/activation/prepare')
    .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
    .send({});

  expect(res.status).toBe(200);
  expect(activationService.prepareActivation).toHaveBeenCalledWith('33', {
    orgId: 42,
    userId: 2,
    assignedTo: null,
    canStartInstallation: true,
    includeDocuments: false,
    includeServiceOrder: true,
    includeWorkOrder: true,
    includeSpeedTest: false,
  });
});

test('POST /contracts/:id/activation/prepare delegates optional technician assignment', async () => {
  activationService.prepareActivation.mockResolvedValue(STATE);
  const res = await request(app)
    .post('/api/v1/contracts/33/activation/prepare')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ assigned_to: 7, status: 'active' }); // undeclared status is stripped

  expect(res.status).toBe(200);
  expect(activationService.prepareActivation).toHaveBeenCalledWith('33', {
    orgId: 42, userId: 1, assignedTo: 7,
    canStartInstallation: true,
    includeDocuments: true, includeServiceOrder: true,
    includeWorkOrder: true, includeSpeedTest: true,
  });
});

test('POST /contracts/:id/activate validates billing before calling the lifecycle', async () => {
  const res = await request(app)
    .post('/api/v1/contracts/33/activate')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({});

  expect(res.status).toBe(422);
  expect(activationService.activate).not.toHaveBeenCalled();
});

test('POST /contracts/:id/activate forwards completion billing and returns the invoice', async () => {
  activationService.activate.mockResolvedValue({
    ...STATE, status: 'active', can_activate: false, blockers: ['contract_not_pending'],
    invoice: { id: 6, invoice_number: 'INV-000006' },
  });
  const res = await request(app)
    .post('/api/v1/contracts/33/activate')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ billing: 'create_invoice', installation_fee: 500, description: 'Installation' });

  expect(res.status).toBe(200);
  expect(res.body.data.invoice.id).toBe(6);
  expect(activationService.activate).toHaveBeenCalledWith('33', {
    orgId: 42, userId: 1, billing: 'create_invoice', installationFee: 500,
    description: 'Installation', canCreateInvoice: true,
    includeDocuments: true, includeServiceOrder: true,
    includeWorkOrder: true, includeSpeedTest: true,
  });
});

test('POST activation cannot create an invoice without invoices.create', async () => {
  jest.spyOn(User, 'getPermissions').mockResolvedValue(['contracts.update']);
  db.query.mockImplementation(async (sql) => {
    if (/`users`/.test(String(sql))) {
      return [[{
        id: 2, email: 'viewer@example.com', role: 'technician', status: 'active',
        organization_id: 42,
      }]];
    }
    return [[]];
  });

  const res = await request(app)
    .post('/api/v1/contracts/33/activate')
    .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
    .send({ billing: 'create_invoice', installation_fee: 500 });

  expect(res.status).toBe(403);
  expect(res.body.error.message).toMatch(/invoices\.create/i);
  expect(activationService.activate).not.toHaveBeenCalled();
});

test('POST activation surfaces the MX zero-template final gate as 422', async () => {
  activationService.activate.mockRejectedValue(new ValidationError(
    'Configure and activate at least one reviewed MX activation-contract template before service goes live',
  ));

  const res = await request(app)
    .post('/api/v1/contracts/33/activate')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ billing: 'already_paid' });

  expect(res.status).toBe(422);
  expect(res.body.error.message).toMatch(/activation-contract template/i);
});

test('POST /contracts/:id/activation/retry-network returns an explicit RouterOS repair result', async () => {
  activationService.retryNetworkActivation.mockResolvedValue({
    contract_id: 33, service_order_id: 16, radius_id: 91, nas_id: 12,
    success: false, error: 'connect ETIMEDOUT',
  });
  const res = await request(app)
    .post('/api/v1/contracts/33/activation/retry-network')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.data).toEqual(expect.objectContaining({
    contract_id: 33, success: false, error: 'connect ETIMEDOUT',
  }));
  expect(activationService.retryNetworkActivation).toHaveBeenCalledWith('33', { orgId: 42 });
});

test('POST /contracts/:id/activation/cancel returns the cancellation activation state', async () => {
  activationService.cancelActivation.mockResolvedValue({
    ...STATE,
    status: 'cancelled',
    cancelled: true,
    cancellation: {
      contract_cancelled: true,
      service_order_id: 16,
      service_order_cancelled: true,
    },
  });

  const res = await request(app)
    .post('/api/v1/contracts/33/activation/cancel')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.data).toEqual(expect.objectContaining({
    status: 'cancelled',
    cancelled: true,
    cancellation: expect.objectContaining({ service_order_cancelled: true }),
  }));
  expect(activationService.cancelActivation).toHaveBeenCalledWith('33', {
    orgId: 42, includeDocuments: true, includeServiceOrder: true,
    includeWorkOrder: true, includeSpeedTest: true,
  });
});

test('GET activation preserves the MX activation_template_missing blocker for UI mapping', async () => {
  activationService.getActivationState.mockResolvedValue({
    ...STATE,
    blockers: ['activation_template_missing'],
    can_activate: false,
  });

  const res = await request(app)
    .get('/api/v1/contracts/33/activation')
    .set('Authorization', `Bearer ${TOKEN}`);

  expect(res.status).toBe(200);
  expect(res.body.data.blockers).toContain('activation_template_missing');
});

test('POST derives the registered source used by the active MX activation document', async () => {
  const conn = {
    query: jest.fn(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/FROM plans/.test(s)) return [[{ id: 2 }]];
      if (/^INSERT INTO contracts/.test(s)) return [{ insertId: 33, affectedRows: 1 }];
      if (/SELECT name FROM clients/.test(s)) return [[{ name: 'María' }]];
      return [[]];
    }),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  db.getConnection.mockResolvedValue(conn);
  db.query.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/`users`/.test(s)) {
      return [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];
    }
    if (/FROM `?clients`?/.test(s)) return [[{ id: 9, organization_id: 42, name: 'María' }]];
    if (/FROM `?contracts`?/.test(s)) {
      return [[{
        id: 33, organization_id: 42, client_id: 9, plan_id: 2,
        contract_template_mx_id: 71, status: 'pending',
      }]];
    }
    return [[]];
  });
  jest.spyOn(mxRegisteredTemplateService, 'resolveActiveContractSource').mockResolvedValue({
    contractTemplateMxId: 71,
  });
  jest.spyOn(provisioningService, 'provisionNewContract').mockResolvedValue({});

  const res = await request(app)
    .post('/api/v1/contracts')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ client_id: 9, plan_id: 2, start_date: '2026-08-11' });

  expect(res.status).toBe(201);
  expect(mxRegisteredTemplateService.resolveActiveContractSource).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({ orgId: 42, lock: true }),
  );
  const insert = conn.query.mock.calls.find(([sql]) => /^INSERT INTO contracts/.test(String(sql)));
  expect(insert[0]).toMatch(/`contract_template_mx_id`/);
  expect(insert[1]).toContain(71);
  expect(conn.commit).toHaveBeenCalledTimes(1);
});

test('PATCH rejects an MX source that is not used by the active activation document', async () => {
  const pending = {
    id: 33, organization_id: 42, client_id: 9, plan_id: 2,
    contract_template_mx_id: 71, connection_type: 'pppoe',
    start_date: '2026-08-10', status: 'pending', first_activated_at: null,
  };
  db.query.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/`users`/.test(s)) {
      return [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];
    }
    if (/SELECT \* FROM `?contracts`? WHERE `?id`? = \?/.test(s)) return [[pending]];
    return [[]];
  });
  jest.spyOn(mxRegisteredTemplateService, 'resolveActiveContractSource').mockRejectedValue(
    new ValidationError('Contract must use the registered MX template referenced by the active activation document'),
  );

  const res = await request(app)
    .patch('/api/v1/contracts/33')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ contract_template_mx_id: 72 });

  expect(res.status).toBe(422);
  expect(res.body.error.message).toMatch(/active activation document/i);
  expect(mxRegisteredTemplateService.resolveActiveContractSource).toHaveBeenCalledWith(
    expect.any(Function),
    { orgId: 42, contractTemplateMxId: 72 },
  );
  expect(db.query.mock.calls.some(([sql]) => /^UPDATE `?contracts`?/.test(String(sql)))).toBe(false);
});

test('PATCH cannot clear a pending MX source with an explicit null', async () => {
  const pending = {
    id: 33, organization_id: 42, client_id: 9, plan_id: 2,
    contract_template_mx_id: 71, connection_type: 'pppoe',
    start_date: '2026-08-10', status: 'pending', first_activated_at: null,
  };
  db.query.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/`users`/.test(s)) {
      return [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];
    }
    if (/SELECT \* FROM `?contracts`? WHERE `?id`? = \?/.test(s)) return [[pending]];
    if (/^UPDATE `contracts`/.test(s)) return [{ affectedRows: 1 }];
    return [[]];
  });
  jest.spyOn(mxRegisteredTemplateService, 'resolveActiveContractSource').mockResolvedValue({
    contractTemplateMxId: 71,
  });

  const res = await request(app)
    .patch('/api/v1/contracts/33')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ contract_template_mx_id: null });

  expect(res.status).toBe(200);
  expect(mxRegisteredTemplateService.resolveActiveContractSource).toHaveBeenCalledWith(
    expect.any(Function),
    { orgId: 42, contractTemplateMxId: null },
  );
  const guardedUpdate = db.query.mock.calls.find(([sql]) => /^UPDATE `contracts`/.test(String(sql)));
  expect(guardedUpdate[1][0]).toBe(71);
});

test('PATCH cannot relink an MX contract after its first activation', async () => {
  const active = {
    id: 33, organization_id: 42, client_id: 9, plan_id: 2,
    contract_template_mx_id: 71, connection_type: 'pppoe',
    start_date: '2026-08-10', status: 'active',
    first_activated_at: '2026-08-11 12:00:00',
  };
  db.query.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/`users`/.test(s)) {
      return [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];
    }
    if (/SELECT \* FROM `?contracts`? WHERE `?id`? = \?/.test(s)) return [[active]];
    return [[]];
  });
  const resolve = jest.spyOn(mxRegisteredTemplateService, 'resolveActiveContractSource');

  const res = await request(app)
    .patch('/api/v1/contracts/33')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ contract_template_mx_id: 72 });

  expect(res.status).toBe(422);
  expect(res.body.error.message).toMatch(/immutable after first activation/i);
  expect(resolve).not.toHaveBeenCalled();
  expect(db.query.mock.calls.some(([sql]) => /^UPDATE `?contracts`?/.test(String(sql)))).toBe(false);
});

test('PATCH freezes material contract fields while a new installation is in process', async () => {
  const pending = {
    id: 33, organization_id: 42, client_id: 9, plan_id: 2,
    connection_type: 'pppoe', start_date: '2026-08-10', end_date: '2027-08-10',
    billing_day: 1, price_override: 499, ip_address: '192.0.2.33', facturar: 0,
    status: 'pending',
  };
  db.query.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/`users`/.test(s)) {
      return [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];
    }
    if (/SELECT \* FROM `?contracts`? WHERE `?id`? = \?/.test(s)) return [[pending]];
    if (/UPDATE `contracts`/.test(s) && /NOT EXISTS/.test(s)) return [{ affectedRows: 0 }];
    return [[]];
  });

  const res = await request(app)
    .patch('/api/v1/contracts/33')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({
      client_id: 9,
      plan_id: 2,
      connection_type: 'pppoe',
      start_date: '2026-08-10',
      end_date: '2027-08-10',
      billing_day: 15,
      price_override: 499,
      ip_address: '192.0.2.33',
      facturar: false,
      status: 'pending',
    });

  expect(res.status).toBe(422);
  expect(res.body.error.message).toMatch(/prepared\/in-process installation.*billing_day/i);
  const guardedUpdate = db.query.mock.calls.find(([sql]) => /^UPDATE `contracts`/.test(String(sql)));
  expect(guardedUpdate).toBeDefined();
  expect(guardedUpdate[0]).toMatch(/NOT EXISTS[\s\S]*status IN \('new','in_process'\)/);
  for (const field of [
    'client_id', 'plan_id', 'connection_type', 'start_date', 'end_date',
    'billing_day', 'price_override', 'ip_address', 'facturar', 'status',
  ]) {
    expect(guardedUpdate[0]).toContain(`\`${field}\` <=> ?`);
  }
});

test('the activation-field guard rejects a stale write atomically when prepare races the initial read', async () => {
  const base = {
    id: 33, organization_id: 42, client_id: 9, plan_id: 2,
    connection_type: 'pppoe', start_date: '2026-08-10', end_date: null,
    billing_day: 1, price_override: null, ip_address: null, facturar: 0,
    status: 'pending',
  };
  let contractReads = 0;
  db.query.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/`users`/.test(s)) {
      return [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];
    }
    if (/SELECT \* FROM `?contracts`? WHERE `?id`? = \?/.test(s)) {
      contractReads += 1;
      // The first read saw plan 2. Before the guarded statement executed, a
      // prepared activation captured/currently owns plan 3.
      return [[{ ...base, plan_id: contractReads === 1 ? 2 : 3 }]];
    }
    if (/UPDATE `contracts`/.test(s) && /NOT EXISTS/.test(s)) return [{ affectedRows: 0 }];
    return [[]];
  });

  const res = await request(app)
    .patch('/api/v1/contracts/33')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ plan_id: 2 });

  expect(res.status).toBe(422);
  expect(res.body.error.message).toMatch(/activation fields: plan_id/i);
  expect(contractReads).toBe(2);
});
