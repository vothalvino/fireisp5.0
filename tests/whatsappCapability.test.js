// =============================================================================
// FireISP 5.0 — WhatsApp capability service tests (read-only + report)
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/clientBalanceService', () => ({ computeClientBalance: jest.fn() }));
jest.mock('../src/services/portalServiceRequestService', () => ({ queueWifiPasswordCpeTask: jest.fn() }));
jest.mock('../src/services/emailTransport', () => ({ sendEmail: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../src/utils/logger', () => {
  const m = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => m) };
  return m;
});

const db = require('../src/config/database');
const { computeClientBalance } = require('../src/services/clientBalanceService');
const portalSR = require('../src/services/portalServiceRequestService');
const emailTransport = require('../src/services/emailTransport');
const cap = require('../src/services/whatsappCapabilityService');

beforeEach(() => jest.clearAllMocks());

describe('write actions', () => {
  it('generateWifiPassword: 12 unambiguous alphanumerics', () => {
    const pw = cap.generateWifiPassword();
    expect(pw).toMatch(/^[A-Za-z2-9]{12}$/);
    expect(pw).not.toMatch(/[0O1Il]/);
  });

  it('maskEmail masks the local part', () => {
    expect(cap.maskEmail('bob@x.com')).toBe('b***@x.com');
    expect(cap.maskEmail('a@x.com')).toBe('***@x.com');
    expect(cap.maskEmail('')).toBe('');
  });

  it('resetWifiPassword: re-validates, emails FIRST (org-routed), then applies (CPE present)', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 9 }]])                        // contractStillOwned
      .mockResolvedValueOnce([[{ name: 'Bob', email: 'bob@x.com' }]]) // client
      .mockResolvedValueOnce([{ insertId: 88 }])                   // INSERT request
      .mockResolvedValueOnce([{ affectedRows: 1 }]);               // UPDATE completed
    portalSR.queueWifiPasswordCpeTask.mockResolvedValue({ queued: true });
    const r = await cap.resetWifiPassword({ orgId: 3, clientId: 7, contract: { id: 9 } });
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 3, clientId: 7, emailFunction: 'general' }));
    expect(portalSR.queueWifiPasswordCpeTask).toHaveBeenCalledWith(expect.objectContaining({ contractId: 9 }));
    expect(r).toMatchObject({ ok: true, applied: true, emailMasked: 'b***@x.com', requestId: 88 });
  });

  it('resetWifiPassword: aborts (never applies) when the email does not send', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 9 }]])
      .mockResolvedValueOnce([[{ name: 'Bob', email: 'bob@x.com' }]])
      .mockResolvedValueOnce([{ insertId: 88 }]);
    emailTransport.sendEmail.mockResolvedValueOnce({ success: false });
    const r = await cap.resetWifiPassword({ orgId: 3, clientId: 7, contract: { id: 9 } });
    expect(r).toEqual({ ok: false, reason: 'email_failed', requestId: 88 });
    expect(portalSR.queueWifiPasswordCpeTask).not.toHaveBeenCalled();
  });

  it('resetWifiPassword: refuses without an email on file', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 9 }]])
      .mockResolvedValueOnce([[{ name: 'Bob', email: null }]]);
    expect(await cap.resetWifiPassword({ orgId: 3, clientId: 7, contract: { id: 9 } })).toEqual({ ok: false, reason: 'no_email' });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  it('resetWifiPassword: refuses when the contract is no longer owned (TOCTOU)', async () => {
    db.query.mockResolvedValueOnce([[]]); // contractStillOwned -> not found
    const r = await cap.resetWifiPassword({ orgId: 3, clientId: 7, contract: { id: 9 } });
    expect(r).toEqual({ ok: false, reason: 'contract_gone' });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  it('resetWifiPassword: files pending (no CPE) after confirmed delivery', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 9 }]])
      .mockResolvedValueOnce([[{ name: 'Bob', email: 'bob@x.com' }]])
      .mockResolvedValueOnce([{ insertId: 88 }]);
    portalSR.queueWifiPasswordCpeTask.mockResolvedValue({ queued: false });
    expect(await cap.resetWifiPassword({ orgId: 3, clientId: 7, contract: { id: 9 } })).toMatchObject({ ok: true, applied: false, requestId: 88 });
  });

  it('scheduleVisit files a visit_schedule request (contract re-validated)', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 9 }]])   // contractStillOwned
      .mockResolvedValueOnce([{ insertId: 91 }]); // INSERT
    const id = await cap.scheduleVisit({ orgId: 3, clientId: 7, contract: { id: 9 }, preferredDate: '2026-08-05', slot: 'morning' });
    expect(id).toBe(91);
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toMatch(/visit_schedule/);
    expect(params[2]).toBe(9);
  });

  it('recentServiceRequestCount counts by type', async () => {
    db.query.mockResolvedValueOnce([[{ n: 2 }]]);
    expect(await cap.recentServiceRequestCount(7, 'wifi_password_change')).toBe(2);
    expect(db.query.mock.calls[0][0]).toMatch(/request_type = \?/);
  });
});

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
