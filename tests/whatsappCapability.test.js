// =============================================================================
// FireISP 5.0 — WhatsApp capability service tests (read-only + report)
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/clientBalanceService', () => ({ computeClientBalance: jest.fn() }));

const db = require('../src/config/database');
const { computeClientBalance } = require('../src/services/clientBalanceService');
const cap = require('../src/services/whatsappCapabilityService');

beforeEach(() => jest.clearAllMocks());

describe('balanceText', () => {
  it('reports an amount owed with the next due date', async () => {
    computeClientBalance.mockResolvedValue({ balance: 150.5, currency: 'MXN' });
    db.query.mockResolvedValueOnce([[{ next_due: '2026-08-01' }]]);
    const t = await cap.balanceText(3, 7);
    expect(t).toMatch(/150\.50 MXN/);
    expect(t).toMatch(/due 2026-08-01/);
  });
  it('reports a credit when the balance is negative', async () => {
    computeClientBalance.mockResolvedValue({ balance: -30, currency: 'MXN' });
    db.query.mockResolvedValueOnce([[{ next_due: null }]]);
    expect(await cap.balanceText(3, 7)).toMatch(/credit of \*30\.00 MXN\*/);
  });
  it('reports paid-up at zero', async () => {
    computeClientBalance.mockResolvedValue({ balance: 0, currency: 'MXN' });
    db.query.mockResolvedValueOnce([[{ next_due: null }]]);
    expect(await cap.balanceText(3, 7)).toMatch(/all paid up/i);
  });
});

describe('getActiveContracts / planText', () => {
  it('labels a contract by site when present, else by plan + id', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 9, status: 'active', connection_type: 'pppoe', plan_name: 'Fiber 100', down: 100, up: 20, site_name: 'Main St' },
      { id: 10, status: 'active', connection_type: 'pppoe', plan_name: 'Fiber 50', down: 50, up: 10, site_name: null },
    ]]);
    const c = await cap.getActiveContracts(7);
    expect(c[0].label).toBe('Fiber 100 — Main St');
    expect(c[1].label).toBe('Fiber 50 (#10)');
  });
  it('planText lists active services with speed + status', async () => {
    db.query.mockResolvedValueOnce([[{ id: 9, status: 'active', connection_type: 'pppoe', plan_name: 'Fiber 100', down: 100, up: 20, site_name: null }]]);
    const t = await cap.planText(7);
    expect(t).toMatch(/Fiber 100/);
    expect(t).toMatch(/100\/20 Mbps/);
    expect(t).toMatch(/active/);
  });
  it('planText handles no active service', async () => {
    db.query.mockResolvedValueOnce([[]]);
    expect(await cap.planText(7)).toMatch(/don't have an active service/i);
  });
});

describe('invoicesText', () => {
  it('lists recent invoices with status', async () => {
    db.query.mockResolvedValueOnce([[
      { invoice_number: 'INV-001', total: '116.00', status: 'issued', due_date: '2026-08-01' },
    ]]);
    const t = await cap.invoicesText(7);
    expect(t).toMatch(/INV-001/);
    expect(t).toMatch(/116\.00/);
    expect(t).toMatch(/issued/);
  });
  it('handles no invoices', async () => {
    db.query.mockResolvedValueOnce([[]]);
    expect(await cap.invoicesText(7)).toMatch(/no invoices/i);
  });
});

describe('ticket creation', () => {
  it('createProblemTicket inserts a technical ticket linked to the contract', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 42 }]);
    const id = await cap.createProblemTicket({ orgId: 3, clientId: 7, description: 'no internet', contract: { id: 9, label: 'Home' } });
    expect(id).toBe(42);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO tickets/);
    expect(sql).toMatch(/'technical'/);
    expect(params[0]).toBe(3);      // organization_id
    expect(params[1]).toBe(7);      // client_id
    expect(params[2]).toBe(9);      // contract_id
    expect(params[3]).toMatch(/Home/);        // subject
    expect(params[4]).toMatch(/no internet/); // description body
    expect(params[4]).toMatch(/Home/);
  });

  it('recentWhatsappTicketCount counts WhatsApp-origin tickets', async () => {
    db.query.mockResolvedValueOnce([[{ n: 3 }]]);
    expect(await cap.recentWhatsappTicketCount(7)).toBe(3);
    expect(db.query.mock.calls[0][0]).toMatch(/subject LIKE 'WhatsApp:%'/);
  });
  it('createHumanHandoffTicket inserts a general ticket', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 77 }]);
    const id = await cap.createHumanHandoffTicket({ orgId: 3, clientId: 7 });
    expect(id).toBe(77);
    expect(db.query.mock.calls[0][0]).toMatch(/'general'/);
  });
});
