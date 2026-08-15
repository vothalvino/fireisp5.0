'use strict';

const crypto = require('crypto');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 7, role: 'admin', organizationId: 10 };
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = 10;
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
}));

jest.mock('../src/services/auditLog', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/cgnatAttributionService', () => ({
  isGloballyRoutableIpv4: value => value === '8.8.8.8',
  normalizeProtocol: (value) => {
    const normalized = String(value).toLowerCase();
    if (normalized === 'tcp' || normalized === '6') return 6;
    if (normalized === 'udp' || normalized === '17') return 17;
    throw new Error('Invalid protocol');
  },
}));

const express = require('express');
const request = require('supertest');
const db = require('../src/config/database');
const auditLog = require('../src/services/auditLog');
const regulatoryCompliance = require('../src/routes/regulatoryCompliance');

const app = express();
app.use(express.json());
app.use('/api/v1/regulatory-compliance', regulatoryCompliance);
app.use((error, _req, res, _next) => {
  res.status(error.statusCode || 500).json({
    error: error.code || 'INTERNAL_ERROR',
    message: error.message,
  });
});

const CREATED_AT = new Date('2026-08-01T00:00:00.000Z');
const OBSERVED_AT = new Date('2026-07-31T23:30:00.000Z');

function rowHash(row) {
  return crypto.createHash('sha256').update(JSON.stringify({
    organization_id: Number(row.organization_id),
    authority_name: row.authority_name,
    authority_ref: row.authority_ref,
    request_type: row.request_type,
    client_id: row.client_id === null ? null : Number(row.client_id),
    contract_id: row.contract_id === null ? null : Number(row.contract_id),
    ip_address: row.ip_address,
    public_port: row.public_port === null ? null : Number(row.public_port),
    protocol: row.protocol,
    observed_at: row.observed_at ? new Date(row.observed_at).toISOString() : null,
    legal_basis: row.legal_basis,
    created_at: new Date(row.created_at).toISOString(),
  })).digest('hex');
}

function caseRow(overrides = {}) {
  const row = {
    id: 21,
    organization_id: 10,
    created_by: 7,
    authority_name: 'Fiscalia de prueba',
    authority_ref: 'CASE-2026-001',
    request_type: 'ip_traceability',
    client_id: 101,
    contract_id: 201,
    ip_address: '8.8.8.8',
    public_port: 43210,
    protocol: 'tcp',
    observed_at: OBSERVED_AT,
    status: 'pending_legal_review',
    legal_basis: 'Written, grounded authority request for this exact tuple and time',
    created_at: CREATED_AT,
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'row_hash')) {
    row.row_hash = rowHash(row);
  }
  return row;
}

function transactionFor(row, {
  clientRows = [{ id: 101 }],
  contractRows = [{ id: 201, client_id: 101 }],
  updateResult = { affectedRows: 1 },
} = {}) {
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(async (sql) => {
      if (/SELECT \* FROM gov_data_requests/.test(sql)) return [[row]];
      if (/SELECT id FROM clients/.test(sql)) return [clientRows];
      if (/SELECT id, client_id FROM contracts/.test(sql)) return [contractRows];
      if (/UPDATE gov_data_requests SET status = 'processing'/.test(sql)) return [updateResult];
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    }),
  };
  db.getConnection.mockResolvedValue(connection);
  return connection;
}

function createBody(overrides = {}) {
  return {
    authority_name: 'Fiscalia de prueba',
    authority_ref: 'CASE-2026-001',
    request_type: 'ip_traceability',
    client_id: 101,
    contract_id: 201,
    ip_address: '8.8.8.8',
    public_port: 43210,
    protocol: 'tcp',
    observed_at: '2026-07-31T23:30:00.000Z',
    legal_basis: 'Written, grounded authority request for this exact tuple and time',
    ...overrides,
  };
}

function put(path, body) {
  return request(app).put(`/api/v1/regulatory-compliance${path}`).send(body);
}

beforeEach(() => {
  jest.clearAllMocks();
  auditLog.log.mockResolvedValue(undefined);
  db.query.mockResolvedValue([[]]);
});

describe('government-request case creation', () => {
  test('binds client and contract checks and the inserted case to the authenticated tenant', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM clients/.test(sql)) return [[{ id: 101 }]];
      if (/SELECT id, client_id FROM contracts/.test(sql)) {
        return [[{ id: 201, client_id: 101 }]];
      }
      if (/INSERT INTO gov_data_requests/.test(sql)) return [{ insertId: 21, affectedRows: 1 }];
      return [[]];
    });

    const NativeDate = Date;
    global.Date = class FixedRequestDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : ['2026-08-01T00:00:00.123Z']));
      }

      static now() { return NativeDate.parse('2026-08-01T00:00:00.123Z'); }

      static parse(value) { return NativeDate.parse(value); }

      static UTC(...args) { return NativeDate.UTC(...args); }
    };
    let response;
    try {
      response = await request(app)
        .post('/api/v1/regulatory-compliance/gov-data-requests')
        .send(createBody());
    } finally {
      global.Date = NativeDate;
    }

    expect(response.status).toBe(201);
    const clientLookup = db.query.mock.calls.find(([sql]) => /SELECT id FROM clients/.test(sql));
    const contractLookup = db.query.mock.calls.find(([sql]) => /SELECT id, client_id FROM contracts/.test(sql));
    expect(clientLookup[1]).toEqual([101, 10]);
    expect(contractLookup[1]).toEqual([201, 10]);

    const [insertSql, insertParams] = db.query.mock.calls
      .find(([sql]) => /INSERT INTO gov_data_requests/.test(sql));
    expect(insertSql).toMatch(/'pending_legal_review'/);
    expect(insertParams[0]).toBe(10);
    expect(insertParams[15]).toBe(7);
    const persistedCreatedAt = new NativeDate(insertParams[16]);
    persistedCreatedAt.setUTCMilliseconds(0); // gov_data_requests.created_at is TIMESTAMP(0)
    expect(insertParams[14]).toBe(rowHash({
      organization_id: insertParams[0], authority_name: insertParams[1],
      authority_ref: insertParams[2], request_type: insertParams[3],
      client_id: insertParams[4], contract_id: insertParams[5],
      ip_address: insertParams[6], public_port: insertParams[7],
      protocol: insertParams[8], observed_at: insertParams[9],
      legal_basis: insertParams[12], created_at: persistedCreatedAt,
    }));
  });

  test('rejects a client outside the authenticated tenant before inserting a case', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM clients/.test(sql)) return [[]];
      throw new Error(`Unexpected SQL after rejected client: ${sql}`);
    });

    const response = await request(app)
      .post('/api/v1/regulatory-compliance/gov-data-requests')
      .send(createBody());

    expect(response.status).toBe(422);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO gov_data_requests/.test(sql))).toBe(false);
  });

  test('rejects a contract that does not belong to the named client', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM clients/.test(sql)) return [[{ id: 101 }]];
      if (/SELECT id, client_id FROM contracts/.test(sql)) {
        return [[{ id: 201, client_id: 999 }]];
      }
      throw new Error(`Unexpected SQL after rejected contract: ${sql}`);
    });

    const response = await request(app)
      .post('/api/v1/regulatory-compliance/gov-data-requests')
      .send(createBody());

    expect(response.status).toBe(422);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO gov_data_requests/.test(sql))).toBe(false);
  });
});

describe('pending legal review to processing', () => {
  test('revalidates subject ownership and advances exactly one locked same-tenant case', async () => {
    const connection = transactionFor(caseRow());

    const response = await put('/gov-data-requests/21/process', {});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, status: 'processing' });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    const [caseSql, caseParams] = connection.execute.mock.calls[0];
    expect(caseSql).toMatch(/id = \? AND organization_id = \?[\s\S]*FOR UPDATE/);
    expect(caseParams).toEqual([21, 10]);
    const [updateSql, updateParams] = connection.execute.mock.calls[3];
    expect(updateSql).toMatch(/status IN \('received','pending_legal_review'\)/);
    expect(updateParams).toEqual([7, 21, 10]);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, organizationId: 10, action: 'approve_processing', recordId: 21,
    }));
  });

  test('rejects a legacy case whose client is not owned by the authenticated tenant', async () => {
    const connection = transactionFor(caseRow(), { clientRows: [] });

    const response = await put('/gov-data-requests/21/process', {});

    expect(response.status).toBe(422);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE gov_data_requests/.test(sql))).toBe(false);
  });

  test('rejects a case whose protected row hash no longer matches its scope', async () => {
    const tampered = caseRow();
    tampered.authority_ref = 'TAMPERED-AFTER-CREATION';
    const connection = transactionFor(tampered);

    const response = await put('/gov-data-requests/21/process', {});

    expect(response.status).toBe(409);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE gov_data_requests/.test(sql))).toBe(false);
  });

  test('does not approve an already-processing case', async () => {
    const connection = transactionFor(caseRow({ status: 'processing' }));

    const response = await put('/gov-data-requests/21/process', {});

    expect(response.status).toBe(409);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe('terminal case transitions and scoped evidence-hold release', () => {
  test('fulfillment is conditional on the same-tenant case still processing', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await put('/gov-data-requests/21/fulfill', {});

    expect(response.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/organization_id = \? AND status = 'processing'/);
    expect(params).toEqual([7, '21', 10]);
  });

  test('a stale fulfill transition fails instead of reporting unconditional success', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect((await put('/gov-data-requests/21/fulfill', {})).status).toBe(409);
  });

  test('rejecting a terminal case fails closed', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const response = await put('/gov-data-requests/21/reject', { reason: 'Invalid authority' });
    expect(response.status).toBe(409);
  });

  test('hold release requires a terminal same-tenant case', async () => {
    db.query.mockResolvedValueOnce([[{ status: 'processing' }]]);

    const response = await put('/gov-data-requests/21/release-evidence-hold', {
      reason: 'Authority expired',
    });

    expect(response.status).toBe(409);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE ip_attribution_case_evidence/.test(sql))).toBe(false);
  });

  test('releases only active evidence links for the terminal case and tenant', async () => {
    db.query
      .mockResolvedValueOnce([[{ status: 'fulfilled' }]])
      .mockResolvedValueOnce([{ affectedRows: 2 }]);

    const response = await put('/gov-data-requests/21/release-evidence-hold', {
      reason: 'Authority expired',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, released_evidence_rows: 2 });
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toMatch(/organization_id = \? AND gov_data_request_id = \?/);
    expect(sql).toMatch(/hold_released_at IS NULL/);
    expect(params).toEqual([7, 'Authority expired', 10, 21]);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, organizationId: 10, action: 'release_evidence_hold', recordId: 21,
      newValues: { released_evidence_rows: 2, reason: 'Authority expired' },
    }));
  });
});
