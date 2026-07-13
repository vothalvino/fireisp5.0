// =============================================================================
// FireISP 5.0 — Lifecycle Service Tests (§1.2)
// =============================================================================

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
const Lead = require('../src/models/Lead');
const Client = require('../src/models/Client');
const ServiceOrder = require('../src/models/ServiceOrder');
const provisioningService = require('../src/services/subscriberProvisioningService');
const billingService = require('../src/services/billingService');
const suspensionService = require('../src/services/suspensionService');
const lifecycleService = require('../src/services/lifecycleService');

jest.mock('../src/services/subscriberProvisioningService', () => ({
  provisionNewContract: jest.fn(),
}));

jest.mock('../src/services/billingService', () => ({
  createOneOffInvoice: jest.fn(),
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
  test('creates a client, marks the lead won, and commits', async () => {
    jest.spyOn(Lead, 'findById')
      .mockResolvedValueOnce({ id: 5, name: 'Acme', email: 'a@b.com', company: 'Acme Inc', organization_id: 1, converted_client_id: null })
      .mockResolvedValueOnce({ id: 5, status: 'won', converted_client_id: 99 });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 99, name: 'Acme' });

    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([{ insertId: 99 }]) // INSERT clients
        .mockResolvedValueOnce([{ affectedRows: 1 }]), // UPDATE leads
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);

    const result = await lifecycleService.convertLead(5, 1, {});

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(result.client.id).toBe(99);
    expect(conn.query.mock.calls[0][0]).toMatch(/INSERT INTO clients/);
    expect(conn.query.mock.calls[1][0]).toMatch(/UPDATE leads SET status = 'won'/);
  });

  test('rejects converting a lead that is already converted', async () => {
    jest.spyOn(Lead, 'findById').mockResolvedValue({ id: 5, converted_client_id: 99 });
    await expect(lifecycleService.convertLead(5, 1)).rejects.toThrow(/already been converted/i);
  });

  test('throws NotFoundError when the lead does not exist', async () => {
    jest.spyOn(Lead, 'findById').mockResolvedValue(null);
    await expect(lifecycleService.convertLead(5, 1)).rejects.toMatchObject({ statusCode: 404 });
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

  test('rejects when client_id does not resolve to a client in this organization', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'new', plan_id: 2, client_id: 999, lead_id: null });
    jest.spyOn(Client, 'findById').mockResolvedValue(null); // cross-org / nonexistent
    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toThrow(/not found in this organization/i);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('new_install with an existing client_id auto-creates and provisions the contract on an org-scoped plan check', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install',
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install' }]]) // FOR UPDATE lock
      .mockResolvedValueOnce([[{ id: 2 }]]) // plan is live + org-scoped
      .mockResolvedValueOnce([{ insertId: 900 }]) // INSERT contracts
      .mockResolvedValueOnce([[{ name: 'Acme' }]]) // seed lookup
      .mockResolvedValueOnce([[{ id: 900, status: 'pending' }]]) // SELECT contract after insert
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // guarded UPDATE service_orders

    db.query.mockResolvedValueOnce([[{ id: 1, status: 'in_process', contract_id: 900 }]]); // final re-fetch (pool, post-commit)
    provisioningService.provisionNewContract.mockResolvedValue({ pppoe: { username: 'acme01', password: 'x' } });

    const result = await lifecycleService.startOrder(1, { orgId: 1, userId: 9 });

    expect(conn.commit).toHaveBeenCalled();
    expect(provisioningService.provisionNewContract).toHaveBeenCalledWith(
      conn, expect.objectContaining({ id: 900, client_id: 50, plan_id: 2, status: 'pending' }), expect.any(Object),
    );
    // Plan check is org-scoped (allows this org's plans OR global plans).
    expect(conn.query.mock.calls[1][0]).toMatch(/organization_id = \? OR organization_id IS NULL/);
    expect(conn.query.mock.calls[1][1]).toEqual([2, 1]);
    expect(result.contract).toEqual({ id: 900, status: 'pending' });
    expect(result.provisioning).toEqual({ pppoe: { username: 'acme01', password: 'x' } });
    expect(result.order.status).toBe('in_process');
  });

  test('auto-converts an unconverted lead before creating the contract', async () => {
    // convertLead is a real (unmocked) internal call from startOrder — a
    // direct local-function reference, not `lifecycleService.convertLead`,
    // so it can't be jest.spyOn'd on the exports object. Drive it through its
    // own transaction (same fixture shape as the convertLead describe block),
    // then a second connection for startOrder's own transaction.
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: 5, contract_id: null, order_type: 'new_install',
    });
    // Three Lead.findById calls in sequence: (1) startOrder's own check to pick
    // the auto-convert branch, (2) convertLead's internal guard at its start,
    // (3) convertLead's post-commit re-fetch.
    jest.spyOn(Lead, 'findById')
      .mockResolvedValueOnce({ id: 5, name: 'New Co', organization_id: 1, converted_client_id: null })
      .mockResolvedValueOnce({ id: 5, name: 'New Co', organization_id: 1, converted_client_id: null })
      .mockResolvedValueOnce({ id: 5, status: 'won', converted_client_id: 60 });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 60, name: 'New Co' });

    const leadConn = makeConn();
    leadConn.query
      .mockResolvedValueOnce([{ insertId: 60 }]) // INSERT clients
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE leads

    const mainConn = makeConn();
    mainConn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', plan_id: 2, client_id: null, lead_id: 5, contract_id: null, order_type: 'new_install' }]]) // lock (client_id NOT yet persisted — see below)
      .mockResolvedValueOnce([[{ id: 2 }]]) // plan is live
      .mockResolvedValueOnce([{ insertId: 900 }]) // INSERT contracts
      .mockResolvedValueOnce([[{ name: 'New Co' }]]) // seed lookup
      .mockResolvedValueOnce([[{ id: 900, status: 'pending' }]]) // SELECT contract after insert
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // guarded UPDATE service_orders (sets client_id + contract_id)

    db.getConnection.mockResolvedValueOnce(leadConn).mockResolvedValueOnce(mainConn);
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'in_process', client_id: 60, contract_id: 900 }]]);
    provisioningService.provisionNewContract.mockResolvedValue({});

    const result = await lifecycleService.startOrder(1, { orgId: 1 });

    expect(leadConn.commit).toHaveBeenCalled();
    expect(mainConn.commit).toHaveBeenCalled();
    // The guarded UPDATE persists the resolved client_id (60) alongside the
    // new contract_id, since the row locked in the main transaction still
    // shows client_id: null (it was set on a separate connection/moment by
    // convertLead's own transaction).
    const updateCall = mainConn.query.mock.calls[5];
    expect(updateCall[0]).toMatch(/client_id = \?/);
    expect(updateCall[1]).toEqual(expect.arrayContaining([60, 900]));
    expect(result.contract.id).toBe(900);
  });

  test('non-new_install order types do not create a contract', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'upgrade',
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'upgrade' }]])
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
      .mockResolvedValueOnce([[]]); // plan not found for this org

    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toMatchObject({ statusCode: 422, code: 'PLAN_ARCHIVED' });
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('a provisioning failure rolls back the whole transaction — order stays new, no contract committed', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({
      id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install',
    });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, name: 'Acme' });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', plan_id: 2, client_id: 50, lead_id: null, contract_id: null, order_type: 'new_install' }]])
      .mockResolvedValueOnce([[{ id: 2 }]])
      .mockResolvedValueOnce([{ insertId: 900 }])
      .mockResolvedValueOnce([[{ name: 'Acme' }]]);

    provisioningService.provisionNewContract.mockRejectedValue(new Error('RADIUS pool exhausted'));

    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toThrow('RADIUS pool exhausted');
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
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // another call already transitioned it between our lock and this UPDATE

    await expect(lifecycleService.startOrder(1, { orgId: 1 })).rejects.toThrow(/modified concurrently/i);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe('completeOrder', () => {
  let conn;
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
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: 50, contract_id: 900, plan_id: null });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50, email: 'c@d.com' });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', client_id: 50, contract_id: 900 }]]) // FOR UPDATE lock
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE contracts -> active
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // guarded UPDATE service_orders -> done

    db.query.mockResolvedValueOnce([[{ id: 1, status: 'done', client_id: 50 }]]); // final re-fetch (pool, post-commit)

    const result = await lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' });

    expect(conn.query.mock.calls[1][0]).toMatch(/UPDATE contracts SET status = 'active'/);
    expect(conn.query.mock.calls[1][1]).toEqual([900]);
    expect(billingService.createOneOffInvoice).not.toHaveBeenCalled();
    expect(result.invoice).toBeNull();
    expect(result.order.status).toBe('done');
    expect(conn.commit).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('service_order.activated', expect.objectContaining({
      order: expect.objectContaining({ status: 'done' }),
    }));
  });

  test('create_invoice raises a one-off invoice on the SAME connection (currency from the order plan) and transitions to done', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: 50, contract_id: 900, plan_id: 2 });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });

    db.query
      .mockResolvedValueOnce([[{ currency: 'MXN' }]]) // plan currency lookup (pre-check phase, pool)
      .mockResolvedValueOnce([[{ id: 1, status: 'done', client_id: 50 }]]); // final re-fetch

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', client_id: 50, contract_id: 900 }]]) // lock
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE contracts
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

  test('does not fail when the linked contract is not pending — the guarded UPDATE simply matches 0 rows', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: 50, contract_id: 900, plan_id: null });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', client_id: 50, contract_id: 900 }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // contract wasn't pending — no-op, not an error
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    db.query.mockResolvedValueOnce([[{ id: 1, status: 'done', client_id: 50 }]]);

    const result = await lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' });

    expect(conn.commit).toHaveBeenCalled();
    expect(result.order.status).toBe('done');
  });

  test('a contract-trigger rejection (SIGNAL 45000) propagates the raw error (errno intact) and rolls back — order NOT transitioned', async () => {
    jest.spyOn(ServiceOrder, 'findById').mockResolvedValue({ id: 1, status: 'in_process', client_id: 50, contract_id: 900, plan_id: null });
    jest.spyOn(Client, 'findById').mockResolvedValue({ id: 50 });

    const triggerErr = new Error('PPPoE/PPPoE-dual contracts require at least one RADIUS account before activation');
    triggerErr.code = 'ER_SIGNAL_EXCEPTION';
    triggerErr.errno = 1644;

    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', client_id: 50, contract_id: 900 }]])
      .mockRejectedValueOnce(triggerErr); // UPDATE contracts fails the trigger

    await expect(lifecycleService.completeOrder(1, { orgId: 1, billing: 'already_paid' }))
      .rejects.toMatchObject({ errno: 1644, code: 'ER_SIGNAL_EXCEPTION' });

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
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

  test('cancels a new order with no linked contract', async () => {
    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'new', contract_id: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'cancelled' }]]);

    const result = await lifecycleService.cancelOrder(1, { orgId: 1 });

    expect(result.contractCancelled).toBe(false);
    expect(suspensionService.sendRadiusDisconnect).not.toHaveBeenCalled();
    expect(result.order.status).toBe('cancelled');
  });

  test('cancels a still-pending auto-created contract and deactivates its RADIUS account', async () => {
    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', contract_id: 900 }]]) // lock order
      .mockResolvedValueOnce([[{ id: 900, status: 'pending' }]]) // lock contract
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE contracts -> cancelled
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE radius -> inactive
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // guarded UPDATE service_orders
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'cancelled', contract_id: 900 }]]);

    const result = await lifecycleService.cancelOrder(1, { orgId: 1 });

    expect(conn.query.mock.calls[2][0]).toMatch(/UPDATE contracts SET status = 'cancelled'/);
    expect(conn.query.mock.calls[3][0]).toMatch(/UPDATE radius SET status = 'inactive'/);
    expect(conn.query.mock.calls[3][1]).toEqual([900]);
    expect(result.contractCancelled).toBe(true);
    expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(900);
  });

  test('leaves an ACTIVE (manually-linked) contract completely untouched', async () => {
    conn.query
      .mockResolvedValueOnce([[{ id: 1, status: 'in_process', contract_id: 900 }]]) // lock order
      .mockResolvedValueOnce([[{ id: 900, status: 'active' }]]) // lock contract — not pending
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // guarded UPDATE service_orders — only 3 conn.query calls total
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'cancelled', contract_id: 900 }]]);

    const result = await lifecycleService.cancelOrder(1, { orgId: 1 });

    expect(conn.query).toHaveBeenCalledTimes(3); // no cancel/radius UPDATEs issued for an active contract
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
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
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
