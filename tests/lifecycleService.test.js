// =============================================================================
// FireISP 5.0 — Lifecycle Service Tests (§1.2)
// =============================================================================

const crypto = require('crypto');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const Client = require('../src/models/Client');
const ServiceOrder = require('../src/models/ServiceOrder');
const provisioningService = require('../src/services/subscriberProvisioningService');
const billingService = require('../src/services/billingService');
const suspensionService = require('../src/services/suspensionService');
const radiusService = require('../src/services/radiusService');
const routerProvisioningService = require('../src/services/routerProvisioningService');
const testWindowService = require('../src/services/testWindowService');
const Nas = require('../src/models/Nas');
const legalDocumentService = require('../src/services/legalDocumentService');
const lifecycleService = require('../src/services/lifecycleService');

const MX_SOURCE_ID = 71;
const MX_SOURCE_BODY = 'Registered MX activation body';
const MX_SOURCE_HASH = crypto.createHash('sha256').update(MX_SOURCE_BODY).digest('hex');
function signedGlobalAcknowledgment() {
  const renderedBody = 'Frozen global handoff acknowledgment';
  const document = {
    id: 77,
    organization_id: 1,
    client_id: 50,
    contract_id: 900,
    service_order_id: 1,
    work_order_id: 70,
    template_id: null,
    template_type: legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TYPE,
    title: legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TITLE,
    rendered_body: renderedBody,
    content_sha256: crypto.createHash('sha256').update(renderedBody).digest('hex'),
    contract_template_mx_id: null,
    mx_registration_number: null,
    mx_registered_at: null,
    mx_template_version: null,
    mx_source_sha256: null,
    signer_name: 'Customer',
    signature_image: 'data:image/png;base64,c2lnbmF0dXJl',
    signed_at: '2026-08-10T11:00:00.000Z',
    signed_ip: '127.0.0.1',
    captured_by: 9,
    communication_choices: null,
    status: 'signed',
  };
  document.evidence_sha256 = legalDocumentService.evidenceDigest(document);
  return document;
}
function registeredTemplate(row) {
  return {
    template_type: 'activation_contract', is_active: 1, body_md: MX_SOURCE_BODY,
    contract_template_mx_id: MX_SOURCE_ID,
    mx_id: MX_SOURCE_ID, mx_organization_id: 1,
    mx_registration_number: 'IFT-2026-001', mx_registered_at: '2026-01-15',
    mx_template_version: '1.0', mx_template_body: MX_SOURCE_BODY,
    mx_status: 'registered', mx_deleted_at: null,
    ...row,
  };
}

jest.mock('../src/services/subscriberProvisioningService', () => ({
  provisionNewContract: jest.fn(),
}));

jest.mock('../src/services/billingService', () => ({
  createOneOffInvoice: jest.fn(),
}));

jest.mock('../src/services/routerProvisioningService', () => ({
  pushSubscriber: jest.fn(),
}));

jest.mock('../src/services/radiusService', () => ({
  syncFreeradiusContract: jest.fn().mockResolvedValue({ found: true }),
}));

// cancelOrder lazy-requires this (only when it deprovisions a contract) —
// jest.mock hoists regardless of where the real require() call happens.
jest.mock('../src/services/suspensionService', () => ({
  sendRadiusDisconnect: jest.fn(),
}));

/** Fresh mock transaction connection, matching the shape db.getConnection() resolves to. */
function makeConn() {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

// =========================================================================
// nextOrderNumber (migration 384 — atomic per-org sequence, mirrors
// billingService.nextInvoiceNumber / migration 381)
// =========================================================================
describe('nextOrderNumber', () => {
  /** Fresh mock transaction connection exposing both .execute() and .query(). */
  function makeSeqConn() {
    return {
      execute: jest.fn(),
      // nextOrderNumber() reads back LAST_INSERT_ID() via conn.query() (a
      // plain query, not a prepared .execute()) — separate mock queue from
      // conn.execute, matching nextInvoiceNumber's contract exactly.
      query: jest.fn().mockResolvedValue([[{ id: 1 }]]),
    };
  }

  test('first-ever call for an org: INSERT IGNORE seeds the row, UPDATE advances it, returns SO-000001', async () => {
    const conn = makeSeqConn();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT IGNORE actually inserted (no prior row)
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE next_number
    conn.query.mockResolvedValueOnce([[{ id: 1 }]]);

    const result = await lifecycleService.nextOrderNumber(conn, 7);

    expect(result).toBe('SO-000001');
    expect(conn.execute).toHaveBeenCalledTimes(2);

    const insertIgnoreCall = conn.execute.mock.calls[0];
    expect(insertIgnoreCall[0]).toContain('INSERT IGNORE INTO organization_order_sequences');
    expect(insertIgnoreCall[1]).toEqual([7]);

    const updateCall = conn.execute.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE organization_order_sequences');
    expect(updateCall[0]).toContain('LAST_INSERT_ID(next_number)');
    expect(updateCall[1]).toEqual([7]);

    expect(conn.query).toHaveBeenCalledWith('SELECT LAST_INSERT_ID() AS id');
  });

  test('increments across repeated calls for the same org (no gaps, no reuse)', async () => {
    const conn = makeSeqConn();
    conn.execute.mockResolvedValue([{ affectedRows: 1 }]);
    conn.query
      .mockResolvedValueOnce([[{ id: 1 }]])
      .mockResolvedValueOnce([[{ id: 2 }]])
      .mockResolvedValueOnce([[{ id: 3 }]]);

    const first = await lifecycleService.nextOrderNumber(conn, 7);
    const second = await lifecycleService.nextOrderNumber(conn, 7);
    const third = await lifecycleService.nextOrderNumber(conn, 7);

    expect([first, second, third]).toEqual(['SO-000001', 'SO-000002', 'SO-000003']);
  });

  test('uses sentinel 0 (not NULL) for a null orgId — single-tenant deployment bucket', async () => {
    const conn = makeSeqConn();
    conn.execute.mockResolvedValue([{ affectedRows: 1 }]);
    conn.query.mockResolvedValueOnce([[{ id: 5 }]]);

    const result = await lifecycleService.nextOrderNumber(conn, null);

    expect(result).toBe('SO-000005');
    // Both statements must target the sentinel bucket 0, never NULL — a
    // NULL primary key wouldn't de-duplicate against itself in MySQL.
    expect(conn.execute.mock.calls[0][1]).toEqual([0]);
    expect(conn.execute.mock.calls[1][1]).toEqual([0]);
  });

  // Regression test for the bug this migration fixes: the OLD algorithm
  // (`SELECT COUNT(*) FROM service_orders WHERE organization_id <=> ?` then
  // +1) could hand out an already-used number whenever the row count didn't
  // track the highest issued sequence value. nextOrderNumber() is
  // structurally immune: it never reads the `service_orders` table at all.
  test('never queries the service_orders table — immune to the COUNT(*)-based reuse bug', async () => {
    const conn = makeSeqConn();
    conn.execute.mockResolvedValue([{ affectedRows: 1 }]);
    conn.query
      .mockResolvedValueOnce([[{ id: 4 }]])
      .mockResolvedValueOnce([[{ id: 5 }]]);

    const afterFirstOrder = await lifecycleService.nextOrderNumber(conn, 9);
    const afterCancelledAndSecondOrder = await lifecycleService.nextOrderNumber(conn, 9);

    expect(afterFirstOrder).toBe('SO-000004');
    expect(afterCancelledAndSecondOrder).toBe('SO-000005'); // NOT reused as SO-000004
    expect(afterFirstOrder).not.toBe(afterCancelledAndSecondOrder);

    for (const call of conn.execute.mock.calls) {
      expect(call[0]).not.toMatch(/FROM service_orders/i);
      expect(call[0]).toContain('organization_order_sequences');
    }
  });
});

describe('convertLead', () => {
  let conn;
  const LEAD = {
    id: 5, name: 'Acme', email: 'a@b.com', company: 'Acme Inc',
    organization_id: 1, converted_client_id: null,
  };

  function wireConversion({ lead = LEAD, locale = 'global', affectedRows = 1 } = {}) {
    conn = makeConn();
    conn.query.mockImplementation(async (sql) => {
      const text = String(sql).replace(/\s+/g, ' ');
      if (/SELECT \* FROM leads .* FOR UPDATE/.test(text)) return [lead ? [{ ...lead }] : []];
      if (/SELECT locale FROM organizations/.test(text)) return [[{ locale }]];
      if (/INSERT INTO clients/.test(text)) return [{ insertId: 99 }];
      if (/INSERT INTO client_mx_profiles/.test(text)) return [{ insertId: 17 }];
      if (/UPDATE leads/.test(text)) return [{ affectedRows }];
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);
    return conn;
  }

  test('creates a client, marks the lead won, and commits', async () => {
    wireConversion();

    const result = await lifecycleService.convertLead(5, 1, {});

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(result.client.id).toBe(99);
    expect(conn.query.mock.calls[0][0]).toMatch(/FROM leads[\s\S]*organization_id = \?[\s\S]*FOR UPDATE/);
    expect(conn.query.mock.calls[0][1]).toEqual([5, 1]);
    const update = conn.query.mock.calls.find(([sql]) => /UPDATE leads/.test(sql));
    expect(update[0]).toMatch(/converted_client_id IS NULL/);
    expect(update[1]).toEqual([99, 5, 1]);
  });

  test('rejects converting a lead that is already converted', async () => {
    wireConversion({ lead: { ...LEAD, converted_client_id: 99 } });
    await expect(lifecycleService.convertLead(5, 1)).rejects.toThrow(/already been converted/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO clients/.test(sql))).toBe(false);
  });

  test('throws NotFoundError when the lead does not exist', async () => {
    wireConversion({ lead: null });
    await expect(lifecycleService.convertLead(5, 1)).rejects.toMatchObject({ statusCode: 404 });
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('guarded lead update rolls back the inserted client on a concurrent conversion', async () => {
    wireConversion({ affectedRows: 0 });

    await expect(lifecycleService.convertLead(5, 1)).rejects.toThrow(/converted concurrently/i);

    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO clients/.test(sql))).toBe(true);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('null org preserves unscoped lookup semantics but scopes the guarded write to the locked lead org', async () => {
    wireConversion();

    await lifecycleService.convertLead(5, null);

    expect(conn.query.mock.calls[0][0]).toMatch(/WHERE id = \? AND 1 = 1/);
    expect(conn.query.mock.calls[0][1]).toEqual([5]);
    const update = conn.query.mock.calls.find(([sql]) => /UPDATE leads/.test(sql));
    expect(update[0]).toMatch(/organization_id = \?/);
    expect(update[1]).toEqual([99, 5, 1]);
  });

  // ---- MX fiscal chain (migration 446) ----
  const MX_LEAD = {
    id: 5, name: 'Juan Perez', email: 'j@p.mx', company: null, organization_id: 1,
    converted_client_id: null, rfc: 'pepj800101ab1', curp: 'PEPJ800101HDFRRN09',
    razon_social: 'Juan Perez', regimen_fiscal: '612', codigo_postal_fiscal: '03100',
  };

  test('MX org: client inherits locale/tax_id/curp and gets a fiscal profile — RFC uppercased', async () => {
    wireConversion({ lead: MX_LEAD, locale: 'MX' });

    await lifecycleService.convertLead(5, 1, {});

    const clientInsert = conn.query.mock.calls.find(([sql]) => /INSERT INTO clients/.test(sql));
    expect(clientInsert[0]).toMatch(/`locale`/);
    expect(clientInsert[0]).toMatch(/`tax_id`/);
    expect(clientInsert[0]).toMatch(/`curp`/);
    expect(clientInsert[1]).toContain('MX');
    const profileInsert = conn.query.mock.calls.find(([sql]) => /INSERT INTO client_mx_profiles/.test(sql));
    expect(profileInsert).toBeDefined();
    expect(profileInsert[0]).not.toMatch(/rfc_unique_check/); // GENERATED column — never written
    expect(profileInsert[1][1]).toBe('PEPJ800101AB1'); // uppercased
    expect(profileInsert[1][4]).toBe('612');
  });

  test('MX org with PARTIAL fiscal data: no profile row (NOT NULL columns), but tax_id still lands on the client', async () => {
    wireConversion({
      lead: { ...MX_LEAD, regimen_fiscal: null, codigo_postal_fiscal: null },
      locale: 'MX',
    });

    await lifecycleService.convertLead(5, 1, {});

    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO client_mx_profiles/.test(sql))).toBe(false);
    const clientInsert = conn.query.mock.calls.find(([sql]) => /INSERT INTO clients/.test(sql));
    expect(clientInsert[0]).toMatch(/`tax_id`/);
  });

  test('global org: no locale/fiscal columns, no profile row — pre-446 behavior intact', async () => {
    wireConversion({ lead: MX_LEAD });

    await lifecycleService.convertLead(5, 1, {});

    const clientInsert = conn.query.mock.calls.find(([sql]) => /INSERT INTO clients/.test(sql));
    expect(clientInsert[0]).not.toMatch(/`locale`/);
    expect(clientInsert[0]).not.toMatch(/`tax_id`/);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO client_mx_profiles/.test(sql))).toBe(false);
  });
});

describe('startOrder', () => {
  let conn;
  beforeEach(() => {
    jest.restoreAllMocks();
    conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
  });

  test('rejects an order that is not new (no transaction opened)', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process' });
    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toThrow(/Invalid service order transition/);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('rejects a new order with no plan', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'new', plan_id: null });
    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toThrow(/no plan/i);
  });

  test('rejects a new order with neither client nor lead', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: null });
    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toThrow(/client or lead/i);
  });

  test('new_install fails closed before opening a transaction or converting its lead', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: 5,
      contract_id: null, order_type: 'new_install', organization_id: 1,
    });

    await expect(lifecycleService.startOrder(1, { orgId: 1 }))
      .rejects.toThrow(/installations\.start/i);

    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('rejects when client_id does not resolve to a client in this organization', async () => {
    const order = {
      id: 1, status: 'new', plan_id: 2, client_id: 999, lead_id: null,
      order_type: 'upgrade', organization_id: 1,
    };
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[]]);
    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toThrow(/not found in this organization/i);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('locked relabel to new_install is denied before lead conversion writes', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: 5,
      order_type: 'upgrade', organization_id: 1,
    });
    conn.query.mockResolvedValueOnce([[
      {
        id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: 5,
        order_type: 'new_install', organization_id: 1,
      },
    ]]);

    await expect(lifecycleService.startOrder(1, { orgId: 1 }))
      .rejects.toThrow(/installations\.start/i);

    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /FROM leads|INSERT INTO clients/.test(sql))).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('MX new_install fails transactionally before dispatch writes when no activation template is active', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null,
      contract_id: null, order_type: 'new_install', organization_id: 1,
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });
    conn.query
      .mockResolvedValueOnce([[
        {
          id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null,
          contract_id: null, order_type: 'new_install', organization_id: 1,
        },
      ]])
      .mockResolvedValueOnce([[{ id: 50, name: 'Acme' }]])
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[]]);

    await expect(lifecycleService.startOrder(1, {
      orgId: 1, userId: 9, canStartInstallation: true,
    }))
      .rejects.toThrow(/activation-contract template before dispatching/i);

    expect(conn.query).toHaveBeenCalledTimes(4);
    expect(conn.query.mock.calls[2][0]).toMatch(/organizations o[\s\S]*FOR UPDATE/);
    expect(conn.rollback).toHaveBeenCalled();
    expect(provisioningService.provisionNewContract).not.toHaveBeenCalled();
  });

  test('new_install with an existing client_id auto-creates and provisions the contract on an org-scoped plan check', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install',
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install' }]]) // FOR UPDATE lock
      .mockResolvedValueOnce([[{ id: 50, name: 'Acme' }]]) // client lock + tenant validation
      .mockResolvedValueOnce([[{ locale: 'global' }]]) // transactional jurisdiction precondition
      .mockResolvedValueOnce([[{ id: 2 }]]) // plan is live + org-scoped
      .mockResolvedValueOnce([{ insertId: 900 }]) // INSERT contracts
      .mockResolvedValueOnce([[{ name: 'Acme' }]]) // seed lookup
      .mockResolvedValueOnce([[{ id: 900, status: 'pending' }]]) // SELECT contract after insert
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // guarded UPDATE service_orders
      .mockResolvedValueOnce([[]]) // no open install WO for this order yet
      .mockResolvedValueOnce([{ insertId: 70 }]) // INSERT work_orders (installation)
      .mockResolvedValueOnce([[{ id: 70, organization_id: 1, service_order_id: 1, work_type: 'installation', status: 'pending', assigned_to: null }]]) // SELECT WO
      .mockResolvedValueOnce([[{ locale: 'global' }]]) // acknowledgment locale
      .mockResolvedValueOnce([[{ id: 50, name: 'Acme' }]]) // document client context
      .mockResolvedValueOnce([[{ id: 900, plan_id: 2, status: 'pending' }]])
      .mockResolvedValueOnce([[{ id: 2, name: '50 Mbps' }]])
      .mockResolvedValueOnce([[{ id: 1, order_number: 'SO-000001' }]])
      .mockResolvedValueOnce([[{ id: 1, name: 'Global ISP' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 501 }]); // bundled global acknowledgment

    db.query.mockResolvedValueOnce([[{ id: 1, status: 'in_process', contract_id: 900 }]]); // final re-fetch (pool, post-commit)
    provisioningService.provisionNewContract.mockResolvedValue({ pppoe: { username: 'acme01', password: 'x' } });

    const result = await lifecycleService.startOrder(1, {
      orgId: 1, userId: 9, canStartInstallation: true,
    });

    expect(conn.commit).toHaveBeenCalled();
    const contractInsert = conn.query.mock.calls.find(([sql]) => /INSERT INTO contracts/.test(sql));
    expect(contractInsert[0]).not.toMatch(/contract_template_mx_id/);
    // The dispatch half: starting a new_install auto-creates the install WO
    // in the same transaction, created_by the caller.
    const woInsert = conn.query.mock.calls.find(([sql]) => /INSERT INTO work_orders/.test(sql));
    expect(woInsert).toBeDefined();
    expect(woInsert[0]).toMatch(/'installation'/);
    expect(woInsert[1][5]).toBe(9); // created_by = userId
    expect(result.workOrder).toEqual(expect.objectContaining({ id: 70, work_type: 'installation' }));
    expect(provisioningService.provisionNewContract).toHaveBeenCalledWith(
      conn, expect.objectContaining({ id: 900, client_id: 50, plan_id: 2, status: 'pending' }), expect.any(Object),
    );
    // Plan check is org-scoped (allows this org's plans OR global plans).
    expect(conn.query.mock.calls[3][0]).toMatch(/organization_id = \? OR organization_id IS NULL/);
    expect(conn.query.mock.calls[3][1]).toEqual([2, 1]);
    expect(result.contract).toEqual({ id: 900, status: 'pending' });
    expect(result.provisioning).toEqual({ pppoe: { username: 'acme01', password: 'x' } });
    expect(result.order.status).toBe('in_process');
  });

  test('auto-converts an unconverted lead before creating the contract', async () => {
    const order = {
      id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: 5,
      contract_id: null, order_type: 'new_install', organization_id: 1,
      order_number: 'SO-000001',
    };
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    conn.query.mockImplementation(async (sql) => {
      const text = String(sql).replace(/\s+/g, ' ');
      if (/FROM service_orders WHERE id = \?.*FOR UPDATE/.test(text)) return [[order]];
      if (/SELECT \* FROM leads .*FOR UPDATE/.test(text)) {
        return [[{ id: 5, name: 'New Co', organization_id: 1, converted_client_id: null }]];
      }
      if (/SELECT locale FROM organizations/.test(text)) return [[{ locale: 'global' }]];
      if (/INSERT INTO clients/.test(text)) return [{ insertId: 60 }];
      if (/UPDATE leads/.test(text)) return [{ affectedRows: 1 }];
      if (/SELECT o\.locale FROM organizations o/.test(text)) return [[{ locale: 'global' }]];
      if (/SELECT id FROM plans/.test(text)) return [[{ id: 2 }]];
      if (/INSERT INTO contracts/.test(text)) return [{ insertId: 900 }];
      if (/SELECT name FROM clients/.test(text)) return [[{ name: 'New Co' }]];
      if (/SELECT \* FROM contracts WHERE id = \?/.test(text)) return [[{ id: 900, status: 'pending', plan_id: 2 }]];
      if (/UPDATE service_orders SET/.test(text)) return [{ affectedRows: 1 }];
      if (/SELECT id, assigned_to FROM work_orders/.test(text)) return [[]];
      if (/INSERT INTO work_orders/.test(text)) return [{ insertId: 71 }];
      if (/SELECT \* FROM work_orders WHERE id = \?/.test(text)) return [[{ id: 71, organization_id: 1, work_type: 'installation', assigned_to: null }]];
      if (/FROM clients WHERE/.test(text)) return [[{ id: 60, name: 'New Co' }]];
      if (/FROM plans WHERE/.test(text)) return [[{ id: 2, name: '50 Mbps' }]];
      if (/FROM service_orders WHERE/.test(text)) return [[order]];
      if (/FROM organizations WHERE/.test(text)) return [[{ id: 1, name: 'Global ISP' }]];
      if (/INSERT INTO signed_documents/.test(text)) return [{ insertId: 502 }];
      return [[]];
    });
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'in_process', client_id: 60, contract_id: 900 }]]);
    provisioningService.provisionNewContract.mockResolvedValue({});

    const result = await lifecycleService.startOrder(1, {
      orgId: 1, canStartInstallation: true,
    });

    expect(db.getConnection).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    const leadUpdate = conn.query.mock.calls.find(([sql]) => /UPDATE leads/.test(sql));
    expect(leadUpdate[0]).toMatch(/converted_client_id IS NULL/);
    const updateCall = conn.query.mock.calls.find(([sql]) => /UPDATE service_orders SET/.test(sql));
    expect(updateCall[0]).toMatch(/client_id = \?/);
    expect(updateCall[1]).toEqual(expect.arrayContaining([60, 900]));
    expect(result.contract.id).toBe(900);
  });

  test('reuses the client from a concurrently converted locked lead without inserting another client', async () => {
    const order = {
      id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: 5,
      contract_id: 900, order_type: 'upgrade', organization_id: 1,
    };
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    conn.query.mockImplementation(async (sql) => {
      const text = String(sql).replace(/\s+/g, ' ');
      if (/FROM service_orders WHERE id = \?.*FOR UPDATE/.test(text)) return [[order]];
      if (/SELECT \* FROM leads .*FOR UPDATE/.test(text)) {
        return [[{ id: 5, organization_id: 1, converted_client_id: 60 }]];
      }
      if (/SELECT \* FROM clients .*FOR UPDATE/.test(text)) return [[{ id: 60, organization_id: 1 }]];
      if (/UPDATE service_orders SET/.test(text)) return [{ affectedRows: 1 }];
      return [[]];
    });
    db.query.mockResolvedValueOnce([[{ ...order, status: 'in_process', client_id: 60 }]]);

    const result = await lifecycleService.startOrder(1, { orgId: 1 });

    expect(result.order.client_id).toBe(60);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO clients/.test(sql))).toBe(false);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE leads/.test(sql))).toBe(false);
    expect(conn.commit).toHaveBeenCalled();
  });

  test('new_install generates one pending legal document per ACTIVE template, in the same transaction', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install',
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });

    conn.query.mockImplementation(async (sql) => {
      const t = String(sql).replace(/\s+/g, ' ');
      if (/FROM service_orders WHERE id = \?.*FOR UPDATE/.test(t)) return [[{ id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install', organization_id: 1, order_number: 'SO-000001' }]];
      if (/SELECT id FROM plans/.test(t)) return [[{ id: 2 }]];
      if (/SELECT \* FROM plans/.test(t)) return [[{ id: 2, name: '50 Mbps' }]];
      if (/INSERT INTO contracts/.test(t)) return [{ insertId: 900 }];
      if (/SELECT name FROM clients/.test(t)) return [[{ name: 'Acme' }]];
      if (/SELECT \* FROM contracts WHERE id = \?/.test(t)) return [[{ id: 900, status: 'pending', plan_id: 2 }]];
      if (/SELECT \* FROM service_orders/.test(t)) return [[{ id: 1, order_number: 'SO-000001' }]];
      if (/UPDATE service_orders SET/.test(t)) return [{ affectedRows: 1 }];
      if (/SELECT id, assigned_to FROM work_orders/.test(t)) return [[]];
      if (/INSERT INTO work_orders/.test(t)) return [{ insertId: 70 }];
      if (/SELECT \* FROM work_orders WHERE id = \?/.test(t)) return [[{ id: 70, organization_id: 1, assigned_to: null }]];
      if (/SELECT o\.locale FROM organizations o/.test(t)) return [[{ locale: 'MX' }]];
      if (/SELECT locale FROM organizations/.test(t)) return [[{ locale: 'MX' }]];
      if (/FROM document_templates/.test(t)) return [[
        { id: 4, template_type: 'installation_authorization', name: 'Autorización', body_md: 'Cliente {{client.name}}' },
        registeredTemplate({ id: 5, name: 'Contrato registrado' }),
      ]];
      if (/FROM clients WHERE/.test(t)) return [[{ id: 50, name: 'Acme' }]];
      if (/FROM organizations WHERE/.test(t)) return [[{ id: 1, name: 'ISP' }]];
      if (/INSERT INTO signed_documents/.test(t)) return [{ insertId: 501 }];
      return [[]];
    });
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'in_process', contract_id: 900 }]]);
    provisioningService.provisionNewContract.mockResolvedValue({});

    await lifecycleService.startOrder(1, {
      orgId: 1, userId: 9, canStartInstallation: true,
    });

    const contractInsert = conn.query.mock.calls.find(([sql]) => /INSERT INTO contracts/.test(sql));
    expect(contractInsert[0]).toMatch(/contract_template_mx_id/);
    expect(contractInsert[1]).toContain(MX_SOURCE_ID);
    const docInsert = conn.query.mock.calls.find(([sql]) => /INSERT INTO signed_documents/.test(sql));
    expect(docInsert).toBeDefined();
    expect(docInsert[1][6]).toBe('installation_authorization'); // template_type
    expect(docInsert[1][8]).toBe('Cliente Acme');               // rendered + frozen
    expect(String(docInsert[1][9])).toMatch(/^[a-f0-9]{64}$/);  // sha256
  });

  test('non-new_install order types do not create a contract', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'upgrade',
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'upgrade' }]])
      .mockResolvedValueOnce([[{ id: 50, name: 'Acme' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // guarded UPDATE — no contract-creation queries at all

    db.query.mockResolvedValueOnce([[{ id: 1, status: 'in_process' }]]);

    const result = await lifecycleService.startOrder(1, { orgId: 1 });

    expect(provisioningService.provisionNewContract).not.toHaveBeenCalled();
    expect(result.contract).toBeNull();
    expect(result.order.status).toBe('in_process');
  });

  test('rejects with PLAN_ARCHIVED when the plan is archived or belongs to a different org, and rolls back', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install',
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install' }]])
      .mockResolvedValueOnce([[{ id: 50, name: 'Acme' }]])
      .mockResolvedValueOnce([[{ locale: 'global' }]])
      .mockResolvedValueOnce([[]]); // plan not found for this org

    await expect(lifecycleService.startOrder(1, {
      orgId: 1, canStartInstallation: true,
    })).rejects.toMatchObject({ statusCode: 422, code: 'PLAN_ARCHIVED' });
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('a provisioning failure rolls lead conversion and contract creation back together', async () => {
    const order = {
      id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: 5,
      contract_id: null, order_type: 'new_install', organization_id: 1,
    };
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    conn.query.mockImplementation(async (sql) => {
      const text = String(sql).replace(/\s+/g, ' ');
      if (/FROM service_orders WHERE id = \?.*FOR UPDATE/.test(text)) return [[order]];
      if (/SELECT \* FROM leads .*FOR UPDATE/.test(text)) {
        return [[{ id: 5, name: 'New Co', organization_id: 1, converted_client_id: null }]];
      }
      if (/SELECT locale FROM organizations/.test(text)) return [[{ locale: 'global' }]];
      if (/INSERT INTO clients/.test(text)) return [{ insertId: 60 }];
      if (/UPDATE leads/.test(text)) return [{ affectedRows: 1 }];
      if (/SELECT o\.locale FROM organizations o/.test(text)) return [[{ locale: 'global' }]];
      if (/SELECT id FROM plans/.test(text)) return [[{ id: 2 }]];
      if (/INSERT INTO contracts/.test(text)) return [{ insertId: 900 }];
      if (/SELECT name FROM clients/.test(text)) return [[{ name: 'New Co' }]];
      return [[]];
    });

    provisioningService.provisionNewContract.mockRejectedValue(new Error('RADIUS pool exhausted'));

    await expect(lifecycleService.startOrder(1, {
      orgId: 1, canStartInstallation: true,
    })).rejects.toThrow('RADIUS pool exhausted');
    expect(db.getConnection).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO clients/.test(sql))).toBe(true);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE leads/.test(sql))).toBe(true);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('concurrency guard: two /start calls on the same order — the loser gets 0 affected rows and rolls back', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'upgrade',
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'upgrade' }]])
      .mockResolvedValueOnce([[{ id: 50, name: 'Acme' }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // another call already transitioned it between our lock and this UPDATE

    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toThrow(/modified concurrently/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe('completeOrder', () => {
  let conn;
  const startedAt = new Date('2026-08-10T10:00:00Z');
  const newInstallOrder = (overrides = {}) => ({
    id: 1,
    status: 'in_process',
    order_type: 'new_install',
    organization_id: 1,
    client_id: 50,
    contract_id: 900,
    plan_id: null,
    started_at: startedAt,
    ...overrides,
  });
  beforeEach(() => {
    jest.restoreAllMocks();
    conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
  });

  test('rejects an order that is not in_process (no transaction opened)', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'new' });
    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/Invalid service order transition/);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('create_invoice requires a positive installation_fee — validated BEFORE any write (a real linked contract is NOT touched)', async () => {
    // contract_id is a REAL linked contract here (not null) — proves the fee
    // check runs before the transaction opens at all, so a fixture that DOES
    // have a contract to activate can't mask a premature-write bug.
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: 50, contract_id: 900, plan_id: null });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'create_invoice', installationFee: 0 }))
      .rejects.toThrow(/installation_fee must be greater than 0/);
    expect(billingService.createOneOffInvoice).not.toHaveBeenCalled();
    expect(db.getConnection).not.toHaveBeenCalled(); // never opened — the linked contract was never touched
  });

  test('create_invoice refuses a caller lacking invoices.create before opening a transaction', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'in_process', order_type: 'upgrade', client_id: 50,
      contract_id: null, plan_id: null,
    });

    await expect(lifecycleService.completeOrder(1, {
      orgId: 1,
      billing: 'create_invoice',
      installationFee: 500,
      canCreateInvoice: false,
    })).rejects.toThrow(/invoices\.create/i);

    expect(db.getConnection).not.toHaveBeenCalled();
    expect(billingService.createOneOffInvoice).not.toHaveBeenCalled();
  });

  test('locked new_install type cannot race an ordinary-order authorization pre-read', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'in_process', order_type: 'upgrade', client_id: 50,
      contract_id: 900, plan_id: null,
    });
    conn.query.mockResolvedValueOnce([[newInstallOrder()]]);

    await expect(lifecycleService.completeOrder(1, {
      orgId: 1,
      billing: 'already_paid',
      canActivateContract: false,
    })).rejects.toThrow(/contracts\.update/i);

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /FROM contracts/.test(sql))).toBe(false);
  });

  test('create_invoice requires a client on the order', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: null, contract_id: null });
    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'create_invoice', installationFee: 500 }))
      .rejects.toThrow(/has no client/);
  });

  test('create_invoice requires the client to belong to this organization (a real linked contract is NOT touched)', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: 999, contract_id: 900, plan_id: null });
    jest.spyOn(Client, 'findById').mockResolvedValue(null);
    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'create_invoice', installationFee: 500 }))
      .rejects.toThrow(/not found in this organization/i);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('already_paid activates the pending contract, skips invoicing, transitions to done, and emits AFTER commit', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'in_process', order_type: 'new_install', client_id: 50,
      contract_id: 900, plan_id: null, organization_id: 1, started_at: startedAt,
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, email: 'c@d.com' });

    conn.query
      .mockResolvedValueOnce([[{
        id: 1, status: 'in_process', order_type: 'new_install', client_id: 50,
        contract_id: 900, plan_id: null, organization_id: 1, started_at: startedAt,
      }]]) // FOR UPDATE lock
      .mockResolvedValueOnce([[{ id: 900, status: 'pending', organization_id: 1, client_id: 50, plan_id: null, test_window_expires_at: null }]]) // contract lock
      .mockResolvedValueOnce([[{ id: 70, status: 'completed', acceptance_rx_dbm: -18, acceptance_waived: 0 }]]) // completed install WO + evidence
      .mockResolvedValueOnce([[{ id: 80 }]]) // technician speed test after order start
      .mockResolvedValueOnce([[{ locale: 'global' }]])
      .mockResolvedValueOnce([[signedGlobalAcknowledgment()]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE contracts -> active (+ clears test window, migration 448)
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE radius -> active (formal activation turns the line on)
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // guarded UPDATE service_orders -> done

    db.query
      .mockResolvedValueOnce([[{ id: 1, status: 'done', client_id: 50 }]]) // final re-fetch (pool, post-commit)
      .mockResolvedValueOnce([[]]); // no direct-API NAS push needed

    const result = await lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' });

    const activation = conn.query.mock.calls.find(([sql]) => /UPDATE contracts[\s\S]*SET status = 'active'/.test(sql));
    expect(activation[1]).toEqual([900]);
    expect(billingService.createOneOffInvoice).not.toHaveBeenCalled();
    expect(result.invoice).toBeNull();
    expect(result.order.status).toBe('done');
    expect(conn.commit).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('service_order.activated', expect.objectContaining({
      order: expect.objectContaining({ status: 'done' }),
    }));
  });

  test('create_invoice raises a one-off invoice on the SAME connection (currency from the order plan) and transitions to done', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'in_process', order_type: 'new_install', client_id: 50,
      contract_id: 900, plan_id: 2, organization_id: 1, started_at: startedAt,
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });

    db.query
      .mockResolvedValueOnce([[{ currency: 'MXN' }]]) // plan currency lookup (pre-check phase, pool)
      .mockResolvedValueOnce([[{ id: 1, status: 'done', client_id: 50 }]]) // final re-fetch
      .mockResolvedValueOnce([[]]); // no direct-API NAS push needed

    conn.query
      .mockResolvedValueOnce([[{
        id: 1, status: 'in_process', order_type: 'new_install', client_id: 50,
        contract_id: 900, plan_id: 2, organization_id: 1, started_at: startedAt,
      }]]) // lock
      .mockResolvedValueOnce([[{ id: 900, status: 'pending', organization_id: 1, client_id: 50, plan_id: 2, test_window_expires_at: null }]])
      .mockResolvedValueOnce([[{ id: 70, status: 'completed', acceptance_waived: 1 }]])
      .mockResolvedValueOnce([[{ id: 80 }]])
      .mockResolvedValueOnce([[{ locale: 'global' }]])
      .mockResolvedValueOnce([[signedGlobalAcknowledgment()]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE contracts
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE radius -> active (migration 448)
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE service_orders

    billingService.createOneOffInvoice.mockResolvedValue({ id: 5, invoice_number: 'INV-000005', total: 580 });

    const result = await lifecycleService.completeOrder(1, {
      orgId: 1, billing: 'create_invoice', installationFee: 500, description: 'Install fee',
    });

    expect(billingService.createOneOffInvoice).toHaveBeenCalledWith({
      orgId: 1, clientId: 50, contractId: 900, description: 'Install fee', amount: 500, currency: 'MXN', conn,
    });
    expect(result.invoice).toEqual({ id: 5, invoice_number: 'INV-000005', total: 580 });
  });

  test('defaults the invoice description and passes a null currency override when the order has no plan', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: 50, contract_id: null, plan_id: null });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', client_id: 50, contract_id: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // no contract to activate

    db.query.mockResolvedValueOnce([[{ id: 1, status: 'done', client_id: 50 }]]);
    billingService.createOneOffInvoice.mockResolvedValue({ id: 6, invoice_number: 'INV-000006', total: 100 });

    await lifecycleService.completeOrder(1, { orgId: 1, billing: 'create_invoice', installationFee: 100 });

    expect(billingService.createOneOffInvoice).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Installation fee', currency: null, contractId: null,
    }));
  });

  test('a non-install order completes without activating its linked pending contract', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'in_process', order_type: 'upgrade', client_id: 50,
      contract_id: 900, plan_id: null,
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', order_type: 'upgrade', client_id: 50, contract_id: 900 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    db.query.mockResolvedValueOnce([[{ id: 1, status: 'done', client_id: 50 }]]);

    const result = await lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' });

    expect(conn.commit).toHaveBeenCalled();
    expect(result.order.status).toBe('done');
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE contracts[\s\S]*SET status = 'active'/.test(sql))).toBe(false);
  });

  test('a contract-trigger rejection (SIGNAL 45000) propagates the raw error (errno intact) and rolls back — order NOT transitioned', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'in_process', order_type: 'new_install', client_id: 50,
      contract_id: 900, plan_id: null, organization_id: 1, started_at: startedAt,
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });

    const triggerErr = new Error('PPPoE/PPPoE-dual contracts require at least one RADIUS account before activation');
    triggerErr.code = 'ER_SIGNAL_EXCEPTION';
    triggerErr.errno = 1644;

    conn.query
      .mockResolvedValueOnce([[{
        id: 1, status: 'in_process', order_type: 'new_install', client_id: 50,
        contract_id: 900, organization_id: 1, started_at: startedAt,
      }]])
      .mockResolvedValueOnce([[{
        id: 900, status: 'pending', organization_id: 1, client_id: 50,
        plan_id: null, test_window_expires_at: null,
      }]])
      .mockResolvedValueOnce([[{ id: 70, status: 'completed', acceptance_waived: 1 }]])
      .mockResolvedValueOnce([[{ id: 80 }]])
      .mockResolvedValueOnce([[{ locale: 'global' }]])
      .mockResolvedValueOnce([[signedGlobalAcknowledgment()]])
      .mockRejectedValueOnce(triggerErr); // UPDATE contracts fails the trigger

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toMatchObject({ errno: 1644, code: 'ER_SIGNAL_EXCEPTION' });

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('new_install blocks while the bounded technician test window is still open', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[{
        id: 900, status: 'pending', organization_id: 1, client_id: 50, plan_id: null,
        test_window_expires_at: '2026-08-10 11:00:00',
      }]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/End the technician test window/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE contracts[\s\S]*SET status = 'active'/.test(sql))).toBe(false);
  });

  test('new_install blocks while external test-window cleanup is pending', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1, client_id: 50, plan_id: null,
          test_window_expires_at: null, test_window_cleanup_pending: 1,
        },
      ]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/network cleanup must finish/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) =>
      /UPDATE contracts[\s\S]*SET status = 'active'/.test(sql))).toBe(false);
  });

  test.each([
    ['client', { client_id: 51, plan_id: null }],
    ['plan', { client_id: 50, plan_id: 99 }],
  ])('new_install refuses activation when the locked contract %s differs from the order', async (_field, contractIdentity) => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1,
          ...contractIdentity, test_window_expires_at: null,
        },
      ]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/client\/plan no longer matches/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /FROM work_orders/.test(sql))).toBe(false);
  });

  test('new_install requires a completed installation work order with acceptance evidence', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1, client_id: 50,
          plan_id: null, test_window_expires_at: null,
        },
      ]])
      .mockResolvedValueOnce([[{ id: 70, status: 'completed', acceptance_waived: 0 }]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/acceptance reading or explicit waiver/i);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('new_install cannot reuse an older completed visit when the newest replacement is still assigned', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1, client_id: 50, plan_id: null,
          test_window_expires_at: null, test_window_cleanup_pending: 0,
        },
      ]])
      // The query is newest-first and deliberately does not pre-filter status.
      .mockResolvedValueOnce([[{ id: 71, status: 'assigned', acceptance_waived: 0 }]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/newest linked installation work order/i);
    const workOrderQuery = conn.query.mock.calls.find(([sql]) => /FROM work_orders/.test(sql));
    expect(workOrderQuery[0]).not.toMatch(/status = 'completed'/);
    expect(conn.query.mock.calls.some(([sql]) => /FROM speed_tests/.test(sql))).toBe(false);
  });

  test('new_install requires a technician speed test bound to the exact installation work order', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[{ id: 900, status: 'pending', organization_id: 1, client_id: 50, plan_id: null, test_window_expires_at: null }]])
      .mockResolvedValueOnce([[{ id: 70, status: 'completed', acceptance_link_mbps: 100, acceptance_waived: 0 }]])
      .mockResolvedValueOnce([[]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/speed test bound to this installation work order/i);
    const speedQuery = conn.query.mock.calls.find(([sql]) => /FROM speed_tests/.test(sql));
    expect(speedQuery[0]).toMatch(/test_source = 'technician'/);
    expect(speedQuery[0]).toMatch(/work_order_id = \?/);
    expect(speedQuery[1]).toEqual([900, 70, startedAt]);
  });

  test('MX new_install blocks when any currently-active activation template lacks a signed instance', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1, client_id: 50,
          plan_id: null, test_window_expires_at: null,
          contract_template_mx_id: MX_SOURCE_ID,
        },
      ]])
      .mockResolvedValueOnce([[{ id: 70, status: 'completed', acceptance_rx_dbm: -17, acceptance_waived: 0 }]])
      .mockResolvedValueOnce([[{ id: 80 }]])
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[
        registeredTemplate({ id: 4, name: 'Contrato PROFECO vigente' }),
        registeredTemplate({ id: 5, name: 'Anexo vigente' }),
      ]])
      .mockResolvedValueOnce([[
        {
          template_id: 4, contract_template_mx_id: MX_SOURCE_ID,
          mx_registration_number: 'IFT-2026-001',
          mx_registered_at: '2026-01-15',
          mx_template_version: '1.0',
          mx_source_sha256: MX_SOURCE_HASH,
        },
      ]]); // template 5 missing/cancelled/not generated

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/Anexo vigente/);
    expect(conn.query.mock.calls[4][0]).toMatch(/organizations[\s\S]*FOR UPDATE/);
    expect(conn.query.mock.calls[5][0]).toMatch(/document_templates[\s\S]*FOR UPDATE/);
    expect(conn.query.mock.calls[6][0]).toMatch(/signed_documents[\s\S]*FOR UPDATE/);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE contracts[\s\S]*SET status = 'active'/.test(sql))).toBe(false);
  });

  test('global new_install blocks until the client signs the neutral service acknowledgment', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[{
        id: 900, status: 'pending', organization_id: 1, client_id: 50,
        plan_id: null, test_window_expires_at: null, test_window_cleanup_pending: 0,
      }]])
      .mockResolvedValueOnce([[{
        id: 70, status: 'completed', acceptance_rx_dbm: -17, acceptance_waived: 0,
      }]])
      .mockResolvedValueOnce([[{ id: 80 }]])
      .mockResolvedValueOnce([[{ locale: 'global' }]])
      .mockResolvedValueOnce([[]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/service installation acknowledgment/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) =>
      /UPDATE contracts[\s\S]*SET status = 'active'/.test(sql))).toBe(false);
  });

  test('global new_install rejects a signed acknowledgment with tampered evidence', async () => {
    const order = newInstallOrder();
    const tampered = signedGlobalAcknowledgment();
    tampered.rendered_body = `${tampered.rendered_body} altered`;
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1, client_id: 50,
          plan_id: null, test_window_expires_at: null, test_window_cleanup_pending: 0,
        },
      ]])
      .mockResolvedValueOnce([[
        { id: 70, status: 'completed', acceptance_waived: 1 },
      ]])
      .mockResolvedValueOnce([[{ id: 80 }]])
      .mockResolvedValueOnce([[{ locale: 'global' }]])
      .mockResolvedValueOnce([[tampered]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/service installation acknowledgment/i);

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) =>
      /UPDATE contracts[\s\S]*SET status = 'active'/.test(sql))).toBe(false);
  });

  test('MX new_install blocks when no reviewed activation-contract template is active', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1, client_id: 50,
          plan_id: null, test_window_expires_at: null, test_window_cleanup_pending: 0,
        },
      ]])
      .mockResolvedValueOnce([[{
        id: 70, status: 'completed', acceptance_rx_dbm: -17, acceptance_waived: 0,
      }]])
      .mockResolvedValueOnce([[{ id: 80 }]])
      .mockResolvedValueOnce([[{ locale: 'MX' }]])
      .mockResolvedValueOnce([[]]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/at least one reviewed MX activation-contract template/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) =>
      /UPDATE contracts[\s\S]*SET status = 'active'/.test(sql))).toBe(false);
  });

  test('new_install requires the guarded pending -> active update to affect exactly one row', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[{ id: 900, status: 'pending', organization_id: 1, client_id: 50, plan_id: null, test_window_expires_at: null }]])
      .mockResolvedValueOnce([[{ id: 70, status: 'completed', acceptance_waived: 1 }]])
      .mockResolvedValueOnce([[{ id: 80 }]])
      .mockResolvedValueOnce([[{ locale: 'global' }]])
      .mockResolvedValueOnce([[signedGlobalAcknowledgment()]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/modified concurrently/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE service_orders SET status = 'done'/.test(sql))).toBe(false);
  });

  test('restores a RouterOS direct-API subscriber only after permanent activation commits', async () => {
    const order = newInstallOrder();
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue(order);
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });
    jest.spyOn(Nas, 'findByIdOrFail').mockResolvedValue({ id: 12, nas_type: 'mikrotik_api' });
    routerProvisioningService.pushSubscriber.mockResolvedValue({ created: true });
    conn.query
      .mockResolvedValueOnce([[order]])
      .mockResolvedValueOnce([[{ id: 900, status: 'pending', organization_id: 1, client_id: 50, plan_id: null, test_window_expires_at: null }]])
      .mockResolvedValueOnce([[{ id: 70, status: 'completed', acceptance_waived: 1 }]])
      .mockResolvedValueOnce([[{ id: 80 }]])
      .mockResolvedValueOnce([[{ locale: 'global' }]])
      .mockResolvedValueOnce([[signedGlobalAcknowledgment()]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    db.query
      .mockResolvedValueOnce([[{ ...order, status: 'done' }]])
      .mockResolvedValueOnce([[{
        id: 91, contract_id: 900, nas_id: 12,
        username: 'client01', password: 'secret', profile: '50M',
      }]]);

    const result = await lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' });

    expect(routerProvisioningService.pushSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
      expect.objectContaining({
        username: 'client01', password: 'secret', profile: '50M',
        comment: 'FireISP permanent activation contract#900',
      }),
    );
    expect(conn.commit.mock.invocationCallOrder[0])
      .toBeLessThan(routerProvisioningService.pushSubscriber.mock.invocationCallOrder[0]);
    expect(result.activation).toEqual({ contract_id: 900, nas_pushed: true });
  });

  test('concurrency guard: a lost race on the final UPDATE raises ValidationError and rolls back', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: 50, contract_id: null, plan_id: null });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', client_id: 50, contract_id: null }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toThrow(/modified concurrently/i);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('cancelOrder', () => {
  let conn;
  beforeEach(() => {
    jest.restoreAllMocks();
    conn = makeConn();
    db.getConnection.mockResolvedValue(conn);
    suspensionService.sendRadiusDisconnect.mockResolvedValue({ sent: true });
  });

  test('rejects a terminal-status order and rolls back', async () => {
    conn.query.mockResolvedValueOnce([[{ id: 1, status: 'done', contract_id: null }]]);
    await expect(lifecycleService.cancelOrder(1, { orgId: 1 })).rejects.toThrow(/Invalid service order transition/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('transaction-locked new_install type requires explicit contract-cancel authority', async () => {
    conn.query.mockResolvedValueOnce([[
      { id: 1, order_type: 'new_install', status: 'in_process', contract_id: 900 },
    ]]);

    await expect(lifecycleService.cancelOrder(1, {
      orgId: 1, canCancelContract: false,
    })).rejects.toThrow(/contracts\.update/i);

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  test('cancels a new order with no linked contract, and its auto-created install WO with it', async () => {
    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', contract_id: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 2 }]) // pending signed documents -> cancelled
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE work_orders -> cancelled
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'cancelled' }]]);

    const result = await lifecycleService.cancelOrder(1, { orgId: 1 });

    expect(result.contractCancelled).toBe(false);
    expect(suspensionService.sendRadiusDisconnect).not.toHaveBeenCalled();
    expect(result.order.status).toBe('cancelled');
    // The open install visit dies with its order; completed WOs are excluded.
    const woCancel = conn.query.mock.calls.find(([sql]) => /UPDATE work_orders SET status = 'cancelled'/.test(sql));
    expect(woCancel).toBeDefined();
    expect(woCancel[0]).toMatch(/work_type = 'installation'/);
    expect(woCancel[0]).toMatch(/NOT IN \('completed', 'cancelled'\)/);
    const documentCancel = conn.query.mock.calls.find(([sql]) => /UPDATE signed_documents/.test(sql));
    expect(documentCancel).toBeDefined();
    expect(documentCancel[0]).toMatch(/status = 'pending'/);
    expect(documentCancel[1]).toEqual([1, 1]);
  });

  test('cancels a no-marker legacy PPPoE contract with durable NAS/session cleanup', async () => {
    const radius = {
      id: 91, contract_id: 900, username: 'client01', nas_id: 12,
    };
    const finalize = jest.spyOn(testWindowService, 'finalizeMarkedCleanup')
      .mockResolvedValue({ nas_disabled: true, disconnect_confirmed: true });
    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', contract_id: 900 }]]) // lock order
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1, connection_type: 'pppoe',
          test_window_expires_at: null, test_window_cleanup_pending: 0,
        },
      ]]) // lock contract
      .mockResolvedValueOnce([[radius]]) // lock RADIUS cleanup target
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE contracts -> cancelled
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE radius -> inactive
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // guarded UPDATE service_orders
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // pending signed documents -> cancelled
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE work_orders -> cancelled
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'cancelled', contract_id: 900 }]]);

    const result = await lifecycleService.cancelOrder(1, { orgId: 1 });

    expect(conn.query.mock.calls[3][0]).toMatch(
      /SET status = 'cancelled', test_window_cleanup_pending = 1/,
    );
    expect(conn.query.mock.calls[3][0]).not.toMatch(/DATE_SUB|COALESCE/);
    expect(conn.query.mock.calls[4][0]).toMatch(/UPDATE radius SET status = 'inactive'/);
    expect(conn.query.mock.calls[4][1]).toEqual([900]);
    expect(finalize).toHaveBeenCalledWith(900, {
      orgId: 1, radius: [radius], reason: 'service_order_cancel',
    });
    expect(conn.commit.mock.invocationCallOrder[0]).toBeLessThan(finalize.mock.invocationCallOrder[0]);
    expect(result.contractCancelled).toBe(true);
  });

  test('cancelling an order with an open test window persists cleanup and deletes NAS access after commit', async () => {
    const radius = {
      id: 91, contract_id: 900, username: 'client01', nas_id: 12,
    };
    const finalize = jest.spyOn(testWindowService, 'finalizeMarkedCleanup')
      .mockResolvedValue({ nas_disabled: true });
    conn.query
      .mockResolvedValueOnce([[{
        id: 1, status: 'in_process', contract_id: 900, organization_id: 1,
      }]])
      .mockResolvedValueOnce([[
        {
          id: 900, status: 'pending', organization_id: 1,
          test_window_expires_at: new Date('2099-01-01T00:00:00Z'),
          test_window_cleanup_pending: 0,
        },
      ]])
      .mockResolvedValueOnce([[radius]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'cancelled', contract_id: 900 }]]);

    const result = await lifecycleService.cancelOrder(1, { orgId: 1 });

    const contractUpdate = conn.query.mock.calls.find(([sql]) =>
      /SET status = 'cancelled', test_window_cleanup_pending = 1/.test(sql));
    expect(contractUpdate).toBeDefined();
    expect(radiusService.syncFreeradiusContract).toHaveBeenCalledWith(900, {
      organizationId: 1, enabled: false, runner: conn,
    });
    expect(finalize).toHaveBeenCalledWith(900, {
      orgId: 1, radius: [radius], reason: 'service_order_cancel',
    });
    expect(conn.commit.mock.invocationCallOrder[0]).toBeLessThan(finalize.mock.invocationCallOrder[0]);
    expect(result.contractCancelled).toBe(true);
  });

  test('leaves an ACTIVE (manually-linked) contract completely untouched', async () => {
    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', contract_id: 900 }]]) // lock order
      .mockResolvedValueOnce([[{ id: 900, status: 'active' }]]) // lock contract — not pending
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // guarded UPDATE service_orders
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // pending signed documents -> cancelled
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE work_orders -> cancelled
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'cancelled', contract_id: 900 }]]);

    const result = await lifecycleService.cancelOrder(1, { orgId: 1 });

    expect(conn.query).toHaveBeenCalledTimes(5); // no contract/radius UPDATEs issued for an active contract
    expect(result.contractCancelled).toBe(false);
    expect(suspensionService.sendRadiusDisconnect).not.toHaveBeenCalled();
  });

  test('concurrency guard: a lost race raises ValidationError and rolls back', async () => {
    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', contract_id: null }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(lifecycleService.cancelOrder(1, { orgId: 1 })).rejects.toThrow(/modified concurrently/i);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('a post-commit RADIUS disconnect failure does not fail the cancel (best-effort)', async () => {
    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', contract_id: 900 }]])
      .mockResolvedValueOnce([[{ id: 900, status: 'pending' }]])
      .mockResolvedValueOnce([[{ id: 91, contract_id: 900, username: 'client01', nas_id: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE work_orders -> cancelled
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'cancelled' }]]);
    suspensionService.sendRadiusDisconnect.mockRejectedValue(new Error('NAS unreachable'));

    const result = await lifecycleService.cancelOrder(1, { orgId: 1 });

    expect(result.order.status).toBe('cancelled'); // did not throw despite the CoA failure
  });
});

describe('churnReport', () => {
  test('computes churn rate per month', async () => {
    db.queryReplica.mockResolvedValue([[
      { month: '2026-05', new_contracts: 8, churned: 2 },
      { month: '2026-04', new_contracts: 0, churned: 0 },
    ]]);
    const report = await lifecycleService.churnReport(1, { months: 6 });
    expect(report.months[0]).toEqual({ month: '2026-05', new_contracts: 8, churned: 2, churn_rate_pct: 20 });
    expect(report.months[1].churn_rate_pct).toBe(0);
  });
});

describe('atRiskClients', () => {
  test('scores clients by suspended contracts and overdue invoices', async () => {
    db.queryReplica.mockResolvedValue([[
      { client_id: 1, name: 'A', email: 'a@x.com', suspended_contracts: 1, overdue_invoices: 2, max_days_overdue: 40 },
    ]]);
    const report = await lifecycleService.atRiskClients(1, {});
    // 1*40 + 2*15 + min(40,60)/2 = 40 + 30 + 20 = 90
    expect(report.clients[0].risk_score).toBe(90);
  });
});

describe('winbackTargets', () => {
  test('queries cancelled clients for the segment', async () => {
    db.queryReplica.mockResolvedValue([[{ client_id: 3, name: 'Gone', email: null, phone: '555' }]]);
    const rows = await lifecycleService.winbackTargets('cancelled_30d', 1);
    expect(rows).toHaveLength(1);
    expect(db.queryReplica.mock.calls[0][0]).toMatch(/co\.status = 'cancelled'/);
    expect(db.queryReplica.mock.calls[0][0]).toMatch(/INTERVAL 30 DAY/);
  });
});
