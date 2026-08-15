'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));
jest.mock('../src/models/User', () => ({ getPermissions: jest.fn() }));
jest.mock('../src/services/orgPrincipalService', () => ({
  resolveOrgPrincipal: jest.fn().mockResolvedValue({ id: 50 }),
}));

const db = require('../src/config/database');
const { lookupAttribution } = require('../src/services/cgnatAttributionService');
const { governmentRequestRowHash } = require('../src/utils/govDataRequestIntegrity');

const ORGANIZATION_ID = 10;
const OBSERVED_AT = '2026-08-01T00:30:00.000Z';

function requestCase({ cgnat = false, observedAt = OBSERVED_AT } = {}) {
  const row = {
    id: 81,
    organization_id: ORGANIZATION_ID,
    request_type: 'ip_traceability',
    status: 'processing',
    authority_name: 'Authority',
    authority_ref: 'AUTH-1',
    legal_basis: 'Exact source attribution request',
    legal_reviewed_at: new Date('2026-07-31T00:00:00.000Z'),
    legal_reviewed_by: 1,
    client_id: null,
    contract_id: null,
    ip_address: '8.8.8.8',
    public_port: cgnat ? 45000 : null,
    protocol: cgnat ? 'tcp' : null,
    observed_at: new Date(observedAt),
    created_at: new Date('2026-07-31T00:00:00.000Z'),
  };
  row.row_hash = governmentRequestRowHash(row);
  return row;
}

function lookupBody({ cgnat = false, observedAt = OBSERVED_AT } = {}) {
  return {
    gov_data_request_id: 81,
    public_ipv4: '8.8.8.8',
    ...(cgnat ? { public_port: 45000, protocol: 'tcp' } : {}),
    observed_at: observedAt,
  };
}

function directRow(overrides = {}) {
  return {
    connection_log_id: 31,
    client_id: 41,
    contract_id: 51,
    username: 'subscriber-1',
    radius_session_id: 'radius-1',
    session_instance_id: '11111111-1111-4111-8111-111111111111',
    public_ipv4: '8.8.8.8',
    assigned_at: new Date('2026-08-01T00:05:00.000Z'),
    assignment_evidence_id: 61,
    assignment_evidence_event_at: new Date('2026-08-01T00:05:00.000Z'),
    assignment_evidence_received_at: new Date('2026-08-01T00:07:00.000Z'),
    assignment_evidence_integrity_hash: 'a'.repeat(64),
    closure_evidence_id: null,
    released_at: null,
    closure_evidence_received_at: null,
    closure_evidence_integrity_hash: null,
    last_accounting_at: new Date('2026-08-01T00:45:00.000Z'),
    last_accounting_received_at: new Date('2026-08-01T00:40:00.000Z'),
    client_name: 'Subscriber One',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('direct-public receipt-time certainty', () => {
  test('anchors assignment to the first IP-bearing evidence, not the latest interim', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[requestCase()]];
      if (/FROM connection_logs cl/.test(sql)) return [[directRow()]];
      throw new Error(`Unexpected direct certainty SQL: ${sql}`);
    });

    const result = await lookupAttribution(
      ORGANIZATION_ID, lookupBody(), { pin: false },
    );

    expect(result).toMatchObject({
      status: 'matched',
      attributionMethod: 'direct_public_assignment',
      attribution: {
        assignment_evidence_id: 61,
        assigned_at: '2026-08-01T00:05:00.000Z',
        certain_from: '2026-08-01T00:07:00.000Z',
        certain_until: '2026-08-01T00:40:00.000Z',
      },
    });
    const [sql, params] = db.query.mock.calls.find(([query]) => /FROM connection_logs cl/.test(query));
    expect(sql).toMatch(
      /ORDER BY GREATEST\(assignment_pick\.event_at, assignment_pick\.observed_at\) ASC,[\s\S]*assignment_pick\.id ASC LIMIT 1/,
    );
    expect(sql).not.toMatch(
      /ORDER BY GREATEST\(assignment_pick\.event_at, assignment_pick\.observed_at\) DESC/,
    );
    expect(params).toEqual([
      '8.8.8.8', new Date(OBSERVED_AT), new Date(OBSERVED_AT), '8.8.8.8',
      ORGANIZATION_ID, '8.8.8.8', new Date(OBSERVED_AT), new Date(OBSERVED_AT),
      new Date(OBSERVED_AT), new Date(OBSERVED_AT),
    ]);
  });

  test('requires event and receipt bounds for assignment, open liveness, and closed release', async () => {
    const closed = directRow({
      closure_evidence_id: 62,
      released_at: new Date('2026-08-01T00:50:00.000Z'),
      closure_evidence_received_at: new Date('2026-08-01T00:45:00.000Z'),
      closure_evidence_integrity_hash: 'b'.repeat(64),
    });
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[requestCase()]];
      if (/FROM connection_logs cl/.test(sql)) return [[closed]];
      throw new Error(`Unexpected direct certainty SQL: ${sql}`);
    });

    const result = await lookupAttribution(
      ORGANIZATION_ID, lookupBody(), { pin: false },
    );

    expect(result).toMatchObject({
      status: 'matched',
      attribution: {
        certain_from: '2026-08-01T00:07:00.000Z',
        certain_until: '2026-08-01T00:45:00.000Z',
        closure_evidence_event_at: '2026-08-01T00:50:00.000Z',
        closure_evidence_received_at: '2026-08-01T00:45:00.000Z',
      },
    });
    const [sql] = db.query.mock.calls.find(([query]) => /FROM connection_logs cl/.test(query));
    expect(sql).toMatch(/assignment_pick\.event_at <= \?/);
    expect(sql).toMatch(/assignment_pick\.observed_at <= \?/);
    expect(sql).toMatch(/closure_evidence\.event_at > \?[\s\S]*closure_evidence\.observed_at > \?/);
    expect(sql).toMatch(/cl\.last_accounting_at >= \?[\s\S]*cl\.last_accounting_received_at >= \?/);
  });
});

describe('CGNAT RADIUS-anchor receipt certainty', () => {
  test('requires both RADIUS event and receipt to precede the uncertainty-adjusted allocation', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[requestCase({ cgnat: true })]];
      if (/FROM cgnat_attribution_bindings binding/.test(sql)) return [[]];
      throw new Error(`Unexpected CGNAT certainty SQL: ${sql}`);
    });

    await expect(lookupAttribution(
      ORGANIZATION_ID, lookupBody({ cgnat: true }), { pin: false },
    )).resolves.toMatchObject({ status: 'unavailable', candidate_count: 0 });

    const [sql] = db.query.mock.calls.find(([query]) => (
      /FROM cgnat_attribution_bindings binding/.test(query)
    ));
    expect(sql).toMatch(
      /radius_anchor\.event_at <= TIMESTAMPADD\(MICROSECOND,[\s\S]*-1000 \* COALESCE\(binding\.allocation_clock_uncertainty_ms/,
    );
    expect(sql).toMatch(
      /radius_anchor\.observed_at <= TIMESTAMPADD\(MICROSECOND,[\s\S]*-1000 \* COALESCE\(binding\.allocation_clock_uncertainty_ms/,
    );
  });
});
