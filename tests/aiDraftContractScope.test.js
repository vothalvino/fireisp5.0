'use strict';
// =============================================================================
// FireISP 5.0 — POST /ai/reply/draft must not accept a foreign contract_id
// =============================================================================
// contract_id arrives from the REQUEST BODY and was handed straight to
// serviceHealthService.getSnapshot / topologyContextService.summarize. Every
// query in those keys on contract_id or device_id and carries NO organization
// predicate, so a tenant could name another tenant's contract and read back
// its RADIUS session and username, connection logs, plan details, SNMP device
// metrics and last speed test — none of which GET /contracts/:id would show
// them (that route correctly 404s).
//
// Found while org-scoping speed_tests: getSnapshot's
// `SELECT ... FROM speed_tests WHERE contract_id = ?` was the unscoped read
// that led back here.
//
// Not reproducible against an install with AI disabled — generate() returns
// {skipped:'policy_disabled'} at step 1, before it builds context at step 3 —
// so these tests drive the route with a policy present.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(), off: jest.fn(), once: jest.fn(), removeListener: jest.fn(),
}));
// The service is stubbed so a passing test proves the ROUTE refused, not that
// some downstream failure happened to hide the read.
jest.mock('../src/services/aiReplyService', () => ({
  generate: jest.fn().mockResolvedValue({ draft: 'ok' }),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const aiReplyService = require('../src/services/aiReplyService');
const app = require('../src/app');

const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };
const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${token()}`);

// `owned` decides what the ownership probe returns — [] means the contract is
// not this org's (or does not exist), which is the attack being blocked.
function wireDb({ owned = true } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/FROM contracts WHERE id = \? AND organization_id = \?/.test(sql)) {
      return [owned ? [{ id: 22 }] : []];
    }
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const draft = (body) => auth(request(app).post('/api/v1/ai/reply/draft')).send(body);
const BASE = { ticket_id: 6, inbound_text: 'sin servicio' };

beforeEach(() => jest.clearAllMocks());

describe('a foreign contract_id is refused', () => {
  it("404s rather than snapshotting another tenant's contract", async () => {
    wireDb({ owned: false });
    const res = await draft({ ...BASE, contract_id: 22 });
    expect(res.status).toBe(404);
  });

  it('never reaches the service, so nothing is read at all', async () => {
    // The guard has to run BEFORE generate(). If it only filtered the response
    // the queries would still have executed.
    wireDb({ owned: false });
    await draft({ ...BASE, contract_id: 22 });
    expect(aiReplyService.generate).not.toHaveBeenCalled();
  });

  it('the ownership probe is bound to the ACTING org, not the body', async () => {
    wireDb({ owned: false });
    await draft({ ...BASE, contract_id: 22 });
    const probe = db.query.mock.calls.find(([s]) => /FROM contracts WHERE id = \?/.test(s));
    expect(probe).toBeDefined();
    expect(probe[0]).toMatch(/organization_id = \?/);
    expect(probe[0]).toMatch(/deleted_at IS NULL/);
    expect(probe[1]).toEqual([22, 1]);
  });

  it('does not leak existence via a distinguishable status', async () => {
    // 403 would confirm the contract exists — the disclosure being prevented.
    wireDb({ owned: false });
    const res = await draft({ ...BASE, contract_id: 22 });
    expect(res.status).not.toBe(403);
  });
});

describe('legitimate use is unaffected', () => {
  it("passes through a contract the caller's org owns", async () => {
    wireDb({ owned: true });
    const res = await draft({ ...BASE, contract_id: 22 });
    expect(res.status).toBe(200);
    expect(aiReplyService.generate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 1, contractId: 22 }),
    );
  });

  it('omitting contract_id skips the probe entirely', async () => {
    // The field is optional; a draft with no contract must not start 404ing.
    wireDb({ owned: false });
    const res = await draft(BASE);
    expect(res.status).toBe(200);
    expect(db.query.mock.calls.some(([s]) => /FROM contracts WHERE id = \?/.test(s))).toBe(false);
    expect(aiReplyService.generate).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: null }),
    );
  });
});
