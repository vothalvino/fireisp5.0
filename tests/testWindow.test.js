'use strict';
// =============================================================================
// FireISP 5.0 — install test window (migration 448)
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/suspensionService', () => ({
  sendRadiusDisconnect: jest.fn().mockResolvedValue({
    sent: true, response: 'Disconnect-ACK', outcome: 'ack',
  }),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');
const svc = require('../src/services/testWindowService');
const suspensionService = require('../src/services/suspensionService');
const Nas = require('../src/models/Nas');
const routerProvisioningService = require('../src/services/routerProvisioningService');
const routerosService = require('../src/services/routerosService');
const legalDocumentService = require('../src/services/legalDocumentService');
const { mockTxConnection } = require('./fixtures/mockTxConnection');

const token = (sub, role = 'admin') => jwt.sign(
  { sub, email: `${role}@example.test`, role, orgId: 42 },
  config.jwt.secret, { expiresIn: '1h' },
);
const ADMIN_TOKEN = token(1, 'admin');
const TECH_TOKEN = token(2, 'technician');
const OTHER_TECH_TOKEN = token(3, 'technician');
const SUPPORT_TOKEN = token(4, 'support');
const CUSTOM_SUPERVISOR_TOKEN = token(5, 'support');
const SUPER_ADMIN_TOKEN = token(6, 'super_admin');

const AUTH_USERS = {
  1: { id: 1, email: 'admin@example.test', role: 'admin', status: 'active', organization_id: 42 },
  2: { id: 2, email: 'tech@example.test', role: 'technician', status: 'active', organization_id: 42 },
  3: { id: 3, email: 'other@example.test', role: 'technician', status: 'active', organization_id: 42 },
  4: { id: 4, email: 'support@example.test', role: 'support', status: 'active', organization_id: 42 },
  5: { id: 5, email: 'custom-supervisor@example.test', role: 'support', status: 'active', organization_id: 42 },
  6: { id: 6, email: 'super-admin@example.test', role: 'super_admin', status: 'active', organization_id: 42 },
};

const normalize = sql => String(sql).replace(/\s+/g, ' ').trim();
const isAuthLookup = sql => /FROM `users`/.test(sql);
const PENDING = {
  id: 33,
  organization_id: 42,
  client_id: 77,
  status: 'pending',
  connection_type: 'pppoe',
  test_window_expires_at: null,
  test_window_cleanup_pending: 0,
  test_window_open: 0,
};
const RADIUS = {
  id: 9,
  contract_id: 33,
  username: 'sub_x',
  password: 'pw',
  status: 'inactive',
  nas_id: null,
  profile: null,
  auth_method: 'pppoe',
  simultaneous_use: null,
  deleted_at: null,
};
const FUTURE = '2099-08-05T12:00:00.000Z';

function authAndPermissions(sql, params) {
  if (isAuthLookup(sql)) return [[AUTH_USERS[Number(params?.[0])] || AUTH_USERS[1]]];
  if (/SELECT g\.id AS group_id/.test(sql)) return [[]];
  if (/FROM organization_users ou/.test(sql) && /SELECT DISTINCT p\.name AS slug/.test(sql)) {
    const actorId = Number(params?.[0]);
    const slugs = actorId === 4
      ? ['work_orders.update', 'work_orders.create']
      : [
        'work_orders.update', 'work_orders.create', 'speed_tests.create',
        ...(actorId === 5 || actorId === 6 ? ['contracts.update'] : []),
      ];
    return [slugs.map(slug => ({ slug }))];
  }
  if (/FROM users u JOIN roles r/.test(sql) && /AS slug/.test(sql)) {
    const actorId = Number(params?.[0]);
    const slugs = actorId === 4
      ? ['work_orders.update', 'work_orders.create']
      : [
        'work_orders.update', 'work_orders.create', 'speed_tests.create',
        ...(actorId === 5 || actorId === 6 ? ['contracts.update'] : []),
      ];
    return [slugs.map(slug => ({ slug }))];
  }
  if (/SELECT 1 FROM users u LEFT JOIN organization_users ou/.test(sql)) {
    return [[{ authorized: 1 }]];
  }
  return null;
}

/**
 * One SQL dispatcher backs both pool reads and transaction-connection reads.
 * State is changed in memory so a fresh SELECT reflects the preceding write.
 */
function wireLine({
  contract = PENDING,
  radius = RADIUS,
  setting = null,
  failRadiusEnable = false,
  closeAffectedRows = 1,
  extra = null,
} = {}) {
  let current = { ...contract };
  let radiusState = radius ? { ...radius } : null;

  db.query.mockImplementation(async (rawSql, params = []) => {
    const sql = normalize(rawSql);
    const auth = authAndPermissions(sql, params);
    if (auth) return auth;
    if (extra) {
      const answer = await extra(sql, params, { current, radiusState });
      if (answer !== undefined) return answer;
    }
    if (/FROM contracts WHERE id = \?/.test(sql) && /FOR UPDATE/.test(sql)) {
      return [current ? [{ ...current }] : []];
    }
    if (/FROM radius WHERE contract_id = \?/.test(sql) && /FOR UPDATE/.test(sql)) {
      return [radiusState ? [{ ...radiusState }] : []];
    }
    if (/FROM contracts c JOIN radius r/.test(sql)) {
      if (!current || !radiusState) return [[]];
      return [[{
        radius_id: radiusState.id,
        username: radiusState.username,
        password: radiusState.password,
        auth_method: radiusState.auth_method,
        simultaneous_use: radiusState.simultaneous_use,
        radius_ip: radiusState.ip_address ?? null,
        nas_id: radiusState.nas_id,
        radius_status: radiusState.status,
        radius_deleted_at: radiusState.deleted_at,
        contract_status: current.status,
        connection_type: current.connection_type,
        test_window_expires_at: current.test_window_expires_at,
        test_window_cleanup_pending: current.test_window_cleanup_pending,
        radius_expiration: 'Aug 10 2099 12:00:00',
        window_seconds_remaining: 3600,
        contract_deleted_at: current.deleted_at ?? null,
        plan_id: null,
        may_authenticate: radiusState.status === 'active'
          && (current.status === 'active'
            || (current.status === 'pending' && current.test_window_open
              && Number(current.test_window_cleanup_pending) === 0)),
      }]];
    }
    if (/SELECT setting_value FROM organization_settings/.test(sql)) {
      return [setting === null ? [] : [{ setting_value: setting }]];
    }
    if (/SET test_window_expires_at = DATE_ADD/.test(sql)) {
      current = { ...current, test_window_expires_at: FUTURE, test_window_open: 1 };
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE radius SET status = 'active'/.test(sql)) {
      if (failRadiusEnable) throw new Error('simulated RADIUS write failure');
      radiusState = { ...radiusState, status: 'active' };
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE work_orders SET status = 'in_progress'/.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/SELECT test_window_expires_at FROM contracts/.test(sql)) {
      return [[{ test_window_expires_at: current.test_window_expires_at }]];
    }
    if (/SET test_window_cleanup_pending = 1/.test(sql)) {
      if (closeAffectedRows) {
        current = {
          ...current,
          test_window_cleanup_pending: 1,
          test_window_open: 0,
        };
      }
      return [{ affectedRows: closeAffectedRows }];
    }
    if (/AS session_bound_elapsed FROM contracts/.test(sql)) {
      return [[{
        session_bound_elapsed: current.test_window_expires_at
          && new Date(current.test_window_expires_at).getTime() <= Date.now() ? 1 : 0,
      }]];
    }
    if (/SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(sql)) {
      current = {
        ...current, test_window_cleanup_pending: 0, test_window_expires_at: null, test_window_open: 0,
      };
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE radius r JOIN contracts c/.test(sql)) {
      radiusState = { ...radiusState, status: 'inactive' };
      return [{ affectedRows: 1 }];
    }
    if (/^(DELETE FROM|INSERT INTO) rad(check|reply|usergroup)/.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });
  return mockTxConnection(db);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('test-window cancellation cleanup evidence', () => {
  it('recognizes the exact pristine inactive account shape', async () => {
    const runner = { query: jest.fn().mockResolvedValue([[{ external_cleanup_required: 0 }]]) };

    await expect(svc.requiresExternalCleanup(PENDING, [RADIUS], runner)).resolves.toBe(false);

    const [sql, params] = runner.query.mock.calls[0];
    expect(normalize(sql)).toMatch(/radcheck.*radreply.*radusergroup.*connection_logs/);
    expect(normalize(sql)).toMatch(/cl\.contract_id = \?/);
    expect(normalize(sql)).toMatch(/stopped\.contract_id = cl\.contract_id/);
    expect(normalize(sql)).toMatch(/cl\.session_id IS NULL OR NOT EXISTS/);
    expect(normalize(sql)).toMatch(/stopped\.event_at >= cl\.event_at/);
    expect(normalize(sql)).toMatch(/archived_account\.deleted_at IS NOT NULL/);
    expect(normalize(sql)).toMatch(/evidence_account\.deleted_at IS NULL/);
    expect(params).toEqual([33, 33, 33]);
  });

  it('keeps cleanup durable for materialized auth or an open session', async () => {
    const runner = { query: jest.fn().mockResolvedValue([[{ external_cleanup_required: 1 }]]) };

    await expect(svc.requiresExternalCleanup(PENDING, [RADIUS], runner)).resolves.toBe(true);
  });

  it.each([
    [{ ...PENDING, test_window_expires_at: FUTURE }, RADIUS],
    [{ ...PENDING, test_window_cleanup_pending: 1 }, RADIUS],
    [PENDING, { ...RADIUS, nas_id: 8 }],
    [PENDING, { ...RADIUS, status: 'active' }],
    [PENDING, { ...RADIUS, status: undefined }],
    [PENDING, { ...RADIUS, username: '' }],
  ])('fails closed for window, NAS, or ambiguous RADIUS state', async (contract, radius) => {
    const runner = { query: jest.fn() };

    await expect(svc.requiresExternalCleanup(contract, [radius], runner)).resolves.toBe(true);
    expect(runner.query).not.toHaveBeenCalled();
  });

  it('fails closed when the expected live PPPoE identity is missing', async () => {
    const runner = { query: jest.fn() };

    await expect(svc.requiresExternalCleanup(PENDING, [], runner)).resolves.toBe(true);
    expect(runner.query).not.toHaveBeenCalled();
  });

  it('fails closed when multiple live PPPoE identities make cleanup ambiguous', async () => {
    const runner = { query: jest.fn() };

    await expect(svc.requiresExternalCleanup(
      PENDING,
      [RADIUS, { ...RADIUS, id: 10, username: 'sub_y' }],
      runner,
    )).resolves.toBe(true);
    expect(runner.query).not.toHaveBeenCalled();
  });

  it('fails closed when supplied account history contains an archived identity', async () => {
    const runner = { query: jest.fn() };
    const deleted = {
      ...RADIUS, status: 'active', nas_id: 8, deleted_at: '2026-08-01T00:00:00.000Z',
    };

    await expect(svc.requiresExternalCleanup(PENDING, [RADIUS, deleted], runner)).resolves.toBe(true);
    expect(runner.query).not.toHaveBeenCalled();
  });

  it('fails closed when the database reveals archived history omitted by a live-only lock', async () => {
    const runner = { query: jest.fn().mockResolvedValue([[{ external_cleanup_required: 1 }]]) };

    await expect(svc.requiresExternalCleanup(PENDING, [RADIUS], runner)).resolves.toBe(true);

    expect(normalize(runner.query.mock.calls[0][0])).toMatch(
      /archived_account\.contract_id = \? AND archived_account\.deleted_at IS NOT NULL/,
    );
  });
});

describe('test-window archived cleanup safety', () => {
  it('never sends an archived identity to RouterOS and retains the marker for reconciliation', async () => {
    const archived = {
      ...RADIUS,
      nas_id: 5,
      deleted_at: '2026-08-01T00:00:00.000Z',
    };
    db.query.mockImplementation(async (rawSql) => {
      const sql = normalize(rawSql);
      if (/SET test_window_cleanup_pending = 1/.test(sql)) return [{ affectedRows: 1 }];
      if (/SET test_window_cleanup_pending = 0/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    const findNas = jest.spyOn(Nas, 'findByIdOrFail');
    const remove = jest.spyOn(routerosService, 'pppoeDelete');
    try {
      const result = await svc.finalizeMarkedCleanup(33, {
        orgId: 42,
        radius: [archived],
        reason: 'archived_retry',
      });

      expect(result.nas_disabled).toBe(false);
      expect(result.nas_disable_warning).toMatch(/manual reconciliation/i);
      expect(findNas).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(33);
      expect(db.query.mock.calls.some(([sql]) =>
        /SET test_window_cleanup_pending = 1/.test(normalize(sql)))).toBe(true);
      expect(db.query.mock.calls.some(([sql]) =>
        /SET test_window_cleanup_pending = 0/.test(normalize(sql)))).toBe(false);
    } finally {
      findNas.mockRestore();
      remove.mockRestore();
    }
  });

  it('retains cleanup when scoped storage reveals archive history absent from supplied live rows', async () => {
    db.query.mockImplementation(async (rawSql) => {
      const sql = normalize(rawSql);
      if (/AS archived_radius_history/.test(sql)) return [[{ archived_radius_history: 1 }]];
      if (/SET test_window_cleanup_pending = 1/.test(sql)) return [{ affectedRows: 1 }];
      if (/SET test_window_cleanup_pending = 0/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });

    const result = await svc.finalizeMarkedCleanup(33, {
      orgId: 42,
      radius: [RADIUS],
      reason: 'live_lock_with_archive_history',
    });

    expect(result).toMatchObject({
      nas_disabled: false,
      disconnect_confirmed: true,
    });
    expect(result.nas_disable_warning).toMatch(/marker release were blocked/i);
    const archiveLookup = db.query.mock.calls.find(([sql]) =>
      /AS archived_radius_history/.test(normalize(sql)));
    expect(normalize(archiveLookup[0])).toMatch(
      /c\.organization_id = \? OR c\.organization_id IS NULL/,
    );
    expect(archiveLookup[1]).toEqual([33, 42]);
    expect(db.query.mock.calls.some(([sql]) =>
      /SET test_window_cleanup_pending = 0/.test(normalize(sql)))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service — row locks, rollback, repeat safety, activation race
// ---------------------------------------------------------------------------
describe('testWindowService transactional line state', () => {
  it('opens a pending PPPoE line atomically with the configured bound', async () => {
    const conn = wireLine({ setting: '30' });

    const result = await svc.startWindow(33, { orgId: 42 });

    expect(result).toMatchObject({ minutes: 30, expires_at: FUTURE, already_open: false });
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /contracts[\s\S]*FOR UPDATE/.test(sql))).toBe(true);
    expect(conn.query.mock.calls.some(([sql]) => /radius[\s\S]*FOR UPDATE/.test(sql))).toBe(true);
    expect(conn.query).toHaveBeenCalledWith(
      'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
      ['sub_x', 'Cleartext-Password', ':=', 'pw'],
    );
  });

  it('rolls the bound back when enabling RADIUS fails', async () => {
    const conn = wireLine({ failRadiusEnable: true });

    await expect(svc.startWindow(33, { orgId: 42 })).rejects.toThrow('simulated RADIUS write failure');

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('atomically starts an assigned visit and rolls that transition back if opening fails', async () => {
    const conn = wireLine({
      failRadiusEnable: true,
      extra: async (sql) => {
        if (/FROM work_orders wo LEFT JOIN service_orders so/.test(sql) && /FOR UPDATE/.test(sql)) {
          return [[{ ...LOCKED_WO, work_order_status: 'assigned' }]];
        }
        return undefined;
      },
    });

    await expect(svc.startWindow(33, {
      orgId: 42, performedBy: 2, workOrderId: 13,
    })).rejects.toThrow('simulated RADIUS write failure');

    expect(conn.query.mock.calls.some(([sql]) =>
      /UPDATE work_orders SET status = 'in_progress'/.test(normalize(sql)))).toBe(true);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('does not rewrite an already in-progress visit when start is retried', async () => {
    const conn = wireLine({
      contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 },
      radius: { ...RADIUS, status: 'active' },
      extra: async (sql) => {
        if (/FROM work_orders wo LEFT JOIN service_orders so/.test(sql) && /FOR UPDATE/.test(sql)) {
          return [[{ ...LOCKED_WO, work_order_status: 'in_progress' }]];
        }
        return undefined;
      },
    });

    const result = await svc.startWindow(33, {
      orgId: 42, performedBy: 2, workOrderId: 13,
    });

    expect(result.already_open).toBe(true);
    expect(conn.query.mock.calls.some(([sql]) =>
      /UPDATE work_orders SET status = 'in_progress'/.test(normalize(sql)))).toBe(false);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('never exposes a window when a stale RouterOS secret cannot be removed', async () => {
    const conn = wireLine({ radius: { ...RADIUS, nas_id: 5 } });
    const findNas = jest.spyOn(Nas, 'findByIdOrFail').mockResolvedValue({ id: 5 });
    const toConn = jest.spyOn(routerProvisioningService, 'nasToConn')
      .mockReturnValue({ host: '192.0.2.5' });
    const remove = jest.spyOn(routerosService, 'pppoeDelete')
      .mockRejectedValue(new Error('connect ETIMEDOUT'));
    try {
      await expect(svc.startWindow(33, { orgId: 42 }))
        .rejects.toThrow(/Unable to guarantee a bounded test window/);

      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.query.mock.calls.some(([sql]) => /DATE_ADD/.test(sql))).toBe(false);
      expect(conn.query.mock.calls.some(([sql]) => /UPDATE radius SET status = 'active'/.test(sql))).toBe(false);
    } finally {
      findNas.mockRestore();
      toConn.mockRestore();
      remove.mockRestore();
    }
  });

  it('keeps an existing expiry but retries removal of any unbounded local secret', async () => {
    const conn = wireLine({
      contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 },
      radius: { ...RADIUS, status: 'active', nas_id: 5 },
    });
    const findNas = jest.spyOn(Nas, 'findByIdOrFail').mockResolvedValue({ id: 5 });
    const toConn = jest.spyOn(routerProvisioningService, 'nasToConn').mockReturnValue({ host: '192.0.2.5' });
    const remove = jest.spyOn(routerosService, 'pppoeDelete').mockResolvedValue({
      deleted: true, name: 'sub_x',
    });
    try {
      const result = await svc.startWindow(33, { orgId: 42 });

      expect(result).toMatchObject({
        expires_at: FUTURE, already_open: true, nas_pushed: false, nas_disabled: true,
      });
      expect(conn.query.mock.calls.some(([sql]) => /DATE_ADD/.test(sql))).toBe(false);
      expect(conn.query.mock.calls.some(([sql]) => /UPDATE radius SET status = 'active'/.test(sql))).toBe(false);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith({ host: '192.0.2.5' }, { name: 'sub_x' });
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
    } finally {
      findNas.mockRestore();
      toConn.mockRestore();
      remove.mockRestore();
    }
  });

  it('refuses a static contract even if a stray RADIUS row exists', async () => {
    const conn = wireLine({ contract: { ...PENDING, connection_type: 'static' } });
    await expect(svc.startWindow(33, { orgId: 42 })).rejects.toThrow(/requires a PPPoE contract/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it('fails closed when legacy data contains multiple live RADIUS accounts', async () => {
    const conn = wireLine({
      extra: async (sql) => {
        if (/FROM radius WHERE contract_id = \?/.test(sql) && /FOR UPDATE/.test(sql)) {
          return [[RADIUS, { ...RADIUS, id: 10, username: 'duplicate' }]];
        }
        return undefined;
      },
    });

    await expect(svc.startWindow(33, { orgId: 42 }))
      .rejects.toThrow(/multiple live RADIUS accounts/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /DATE_ADD/.test(sql))).toBe(false);
  });

  it('rejects start when legacy WO, service-order, contract, and client links disagree', async () => {
    const conn = wireLine({
      extra: async (sql) => {
        if (/FROM work_orders wo LEFT JOIN service_orders so/.test(sql) && /FOR UPDATE/.test(sql)) {
          return [[{ ...LOCKED_WO, service_order_contract_id: 999 }]];
        }
        return undefined;
      },
    });

    await expect(svc.startWindow(33, {
      orgId: 42, performedBy: 2, workOrderId: 13,
    })).rejects.toThrow(/links do not match/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /DATE_ADD/.test(sql))).toBe(false);
  });

  it('rejects start for an in-process service order that is not a new installation', async () => {
    const conn = wireLine({
      extra: async (sql) => {
        if (/FROM work_orders wo LEFT JOIN service_orders so/.test(sql) && /FOR UPDATE/.test(sql)) {
          return [[{ ...LOCKED_WO, service_order_type: 'upgrade' }]];
        }
        return undefined;
      },
    });

    await expect(svc.startWindow(33, {
      orgId: 42, performedBy: 2, workOrderId: 13,
    })).rejects.toThrow(/new-install service order/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /DATE_ADD/.test(sql))).toBe(false);
  });

  it('does not let an end command that loses to activation turn the active line off', async () => {
    const conn = wireLine({
      contract: { ...PENDING, status: 'active', test_window_expires_at: null, test_window_open: 0 },
      radius: { ...RADIUS, status: 'active' },
    });

    const result = await svc.endWindow(33, { orgId: 42 });

    expect(result).toEqual({ contract_id: 33, closed: false, active: true });
    expect(conn.query.mock.calls.some(([sql]) => /SET r\.status = 'inactive'/.test(sql))).toBe(false);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(suspensionService.sendRadiusDisconnect).not.toHaveBeenCalled();
  });

  it('closes a pending window and disconnects only after commit', async () => {
    const conn = wireLine({ contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 } });

    const result = await svc.endWindow(33, { orgId: 42, reason: 'manual' });

    expect(result).toEqual({
      contract_id: 33,
      closed: true,
      prepared: true,
      nas_disabled: null,
      nas_disable_warning: null,
      disconnect_confirmed: true,
      disconnect_outcome: 'ack',
      disconnect_warning: null,
    });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(33);
    expect(conn.query).toHaveBeenCalledWith('DELETE FROM radcheck WHERE username = ?', ['sub_x']);
    expect(conn.query).toHaveBeenCalledWith('DELETE FROM radreply WHERE username = ?', ['sub_x']);
    expect(conn.query).toHaveBeenCalledWith('DELETE FROM radusergroup WHERE username = ?', ['sub_x']);
  });

  it('removes a direct-API RouterOS secret after commit and reports NAS enforcement', async () => {
    const conn = wireLine({
      contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 },
      radius: { ...RADIUS, nas_id: 5 },
    });
    const findNas = jest.spyOn(Nas, 'findByIdOrFail').mockResolvedValue({ id: 5 });
    const toConn = jest.spyOn(routerProvisioningService, 'nasToConn').mockReturnValue({ host: '192.0.2.5' });
    const remove = jest.spyOn(routerosService, 'pppoeDelete').mockResolvedValue({ deleted: true, name: 'sub_x' });
    try {
      const result = await svc.endWindow(33, { orgId: 42 });

      expect(result).toMatchObject({ nas_disabled: true, nas_disable_warning: null });
      expect(findNas).toHaveBeenCalledWith(5, 42);
      expect(remove).toHaveBeenCalledWith({ host: '192.0.2.5' }, { name: 'sub_x' });
      expect(conn.commit.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    } finally {
      findNas.mockRestore();
      toConn.mockRestore();
      remove.mockRestore();
    }
  });

  it('shuts down a legacy pending PPPoE secret even without a window marker', async () => {
    const secondRadius = {
      ...RADIUS, id: 10, username: 'sub_y', status: 'active', nas_id: 6,
    };
    const conn = wireLine({
      contract: { ...PENDING, test_window_expires_at: null, test_window_cleanup_pending: 0 },
      radius: { ...RADIUS, status: 'active', nas_id: 5 },
      extra: async (sql) => {
        if (/SELECT \* FROM radius WHERE contract_id = \?/.test(sql)) {
          return [[{ ...RADIUS, status: 'active', nas_id: 5 }, secondRadius]];
        }
        return undefined;
      },
    });
    const findNas = jest.spyOn(Nas, 'findByIdOrFail')
      .mockImplementation(async id => ({ id }));
    const toConn = jest.spyOn(routerProvisioningService, 'nasToConn')
      .mockImplementation(nas => ({ host: `192.0.2.${nas.id}` }));
    const remove = jest.spyOn(routerosService, 'pppoeDelete').mockResolvedValue({ deleted: true });
    try {
      const result = await svc.cleanupMarkedWindow(33, {
        orgId: 42, reason: 'legacy_cancel', requireMarker: false,
      });

      expect(result).toMatchObject({ closed: true, nas_disabled: true, disconnect_confirmed: true });
      expect(remove).toHaveBeenCalledWith({ host: '192.0.2.5' }, { name: 'sub_x' });
      expect(remove).toHaveBeenCalledWith({ host: '192.0.2.6' }, { name: 'sub_y' });
      expect(remove).toHaveBeenCalledTimes(2);
      const prepared = conn.query.mock.calls.find(([sql]) =>
        /SET test_window_cleanup_pending = 1/.test(normalize(sql)));
      expect(normalize(prepared[0])).not.toMatch(/DATE_SUB|COALESCE/);
      expect(db.query.mock.calls.some(([sql]) =>
        /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(true);
    } finally {
      findNas.mockRestore();
      toConn.mockRestore();
      remove.mockRestore();
    }
  });

  it('durably retries a failed no-marker legacy secret shutdown without inventing a bound', async () => {
    const conn = wireLine({
      contract: { ...PENDING, test_window_expires_at: null, test_window_cleanup_pending: 0 },
      radius: { ...RADIUS, status: 'active', nas_id: 5 },
    });
    const findNas = jest.spyOn(Nas, 'findByIdOrFail').mockResolvedValue({ id: 5 });
    const toConn = jest.spyOn(routerProvisioningService, 'nasToConn').mockReturnValue({ host: '192.0.2.5' });
    const remove = jest.spyOn(routerosService, 'pppoeDelete')
      .mockRejectedValue(new Error('connect ETIMEDOUT'));
    try {
      const result = await svc.cleanupMarkedWindow(33, {
        orgId: 42, reason: 'legacy_cancel', requireMarker: false,
      });

      expect(result).toMatchObject({ closed: true, nas_disabled: false });
      expect(conn.commit).toHaveBeenCalledTimes(1);
      const markerWrites = db.query.mock.calls.filter(([sql]) =>
        /SET test_window_cleanup_pending = 1/.test(normalize(sql)));
      expect(markerWrites).toHaveLength(2);
      expect(markerWrites.every(([sql]) => !/DATE_SUB|COALESCE/.test(normalize(sql)))).toBe(true);
      expect(db.query.mock.calls.some(([sql]) =>
        /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(false);
    } finally {
      findNas.mockRestore();
      toConn.mockRestore();
      remove.mockRestore();
    }
  });

  it('does not treat an unbounded legacy no-target session as expired', async () => {
    wireLine({
      contract: { ...PENDING, test_window_expires_at: null, test_window_cleanup_pending: 0 },
      radius: { ...RADIUS, status: 'active', nas_id: null },
    });
    suspensionService.sendRadiusDisconnect.mockResolvedValueOnce({
      sent: false, response: 'No target NAS', outcome: 'no_target',
    });

    const result = await svc.cleanupMarkedWindow(33, {
      orgId: 42, reason: 'legacy_cancel', requireMarker: false,
    });

    expect(result).toMatchObject({ closed: true, disconnect_confirmed: false });
    expect(db.query.mock.calls.some(([sql]) =>
      /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(false);
    expect(db.query.mock.calls.filter(([sql]) =>
      /SET test_window_cleanup_pending = 1/.test(normalize(sql)))).toHaveLength(2);
  });

  it('clears a no-marker retry when there is definitively no RADIUS account or NAS secret', async () => {
    wireLine({
      contract: { ...PENDING, test_window_expires_at: null, test_window_cleanup_pending: 0 },
      radius: null,
    });
    suspensionService.sendRadiusDisconnect.mockResolvedValueOnce({
      sent: false, response: 'No RADIUS account found for contract', outcome: 'no_account',
    });

    const result = await svc.cleanupMarkedWindow(33, {
      orgId: 42, reason: 'legacy_cancel', requireMarker: false,
    });

    expect(result).toMatchObject({
      closed: true, nas_disabled: null, disconnect_confirmed: true, disconnect_outcome: 'no_account',
    });
    expect(db.query.mock.calls.some(([sql]) =>
      /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(true);
  });

  it('keeps the DB close successful but exposes a warning when NAS removal fails', async () => {
    const conn = wireLine({
      contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 },
      radius: { ...RADIUS, nas_id: 5 },
    });
    const findNas = jest.spyOn(Nas, 'findByIdOrFail').mockResolvedValue({ id: 5 });
    const toConn = jest.spyOn(routerProvisioningService, 'nasToConn').mockReturnValue({ host: '192.0.2.5' });
    const remove = jest.spyOn(routerosService, 'pppoeDelete').mockRejectedValue(new Error('connect ETIMEDOUT'));
    try {
      const result = await svc.endWindow(33, { orgId: 42 });

      expect(result.nas_disabled).toBe(false);
      expect(result.nas_disable_warning).toMatch(/automatic retry is scheduled/);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(33);
      const markerWrites = db.query.mock.calls.filter(([sql]) =>
        /SET test_window_cleanup_pending = 1/.test(normalize(sql)));
      // One transactional close marker plus a post-commit restore/retain after
      // RouterOS transport failure: both survive for the sweeper.
      expect(markerWrites).toHaveLength(2);
    } finally {
      findNas.mockRestore();
      toConn.mockRestore();
      remove.mockRestore();
    }
  });

  it('retains cleanup when RADIUS returns a structured timeout despite DB shutdown', async () => {
    const conn = wireLine({
      contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 },
    });
    suspensionService.sendRadiusDisconnect.mockResolvedValueOnce({
      sent: false, response: 'Timeout — no response from NAS', outcome: 'timeout',
    });

    const result = await svc.endWindow(33, { orgId: 42 });

    expect(result).toMatchObject({
      closed: true,
      disconnect_confirmed: false,
      disconnect_outcome: 'timeout',
    });
    expect(result.disconnect_warning).toMatch(/automatic retry/);
    const markerWrites = db.query.mock.calls.filter(([sql]) =>
      /SET test_window_cleanup_pending = 1/.test(normalize(sql)));
    expect(markerWrites).toHaveLength(2);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('treats an authoritative Disconnect-NAK as confirmed no-session cleanup', async () => {
    wireLine({ contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 } });
    suspensionService.sendRadiusDisconnect.mockResolvedValueOnce({
      sent: false, response: 'Disconnect-NAK', outcome: 'nak',
    });

    const result = await svc.endWindow(33, { orgId: 42 });

    expect(result).toMatchObject({
      disconnect_confirmed: true, disconnect_outcome: 'nak', disconnect_warning: null,
    });
    expect(db.query.mock.calls.some(([sql]) =>
      /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(true);
  });

  it('treats no RADIUS account as definitively safe cleanup', async () => {
    wireLine({ contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 } });
    suspensionService.sendRadiusDisconnect.mockResolvedValueOnce({
      sent: false, response: 'No RADIUS account found for contract', outcome: 'no_account',
    });

    const result = await svc.endWindow(33, { orgId: 42 });

    expect(result).toMatchObject({
      disconnect_confirmed: true, disconnect_outcome: 'no_account',
    });
    expect(db.query.mock.calls.some(([sql]) =>
      /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(true);
  });

  it('retains no-target cleanup until the original Session-Timeout bound elapses', async () => {
    wireLine({ contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 } });
    suspensionService.sendRadiusDisconnect.mockResolvedValueOnce({
      sent: false, response: 'No target NAS', outcome: 'no_target',
    });

    const result = await svc.endWindow(33, { orgId: 42 });

    expect(result).toMatchObject({
      closed: true, disconnect_confirmed: false, disconnect_outcome: 'no_target',
    });
    expect(db.query.mock.calls.some(([sql]) =>
      /AS session_bound_elapsed/.test(normalize(sql)))).toBe(true);
    expect(db.query.mock.calls.some(([sql]) =>
      /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(false);
  });

  it('releases no-target cleanup after the preserved device bound has elapsed', async () => {
    wireLine({
      contract: {
        ...PENDING,
        test_window_cleanup_pending: 1,
        test_window_expires_at: '2020-01-01T00:00:00.000Z',
        test_window_open: 0,
      },
    });
    suspensionService.sendRadiusDisconnect.mockResolvedValueOnce({
      sent: false, response: 'No target NAS', outcome: 'no_target',
    });

    const result = await svc.endWindow(33, { orgId: 42 });

    expect(result).toMatchObject({
      disconnect_confirmed: true, disconnect_outcome: 'bounded_expiry',
    });
    expect(db.query.mock.calls.some(([sql]) =>
      /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(true);
  });

  it('lets manual end retry cleanup after cancellation and a connection-type change', async () => {
    const conn = wireLine({
      contract: {
        ...PENDING,
        status: 'cancelled',
        connection_type: 'static',
        test_window_cleanup_pending: 1,
        test_window_expires_at: '2020-01-01T00:00:00.000Z',
      },
      radius: { ...RADIUS, status: 'inactive', nas_id: 5 },
    });
    const findNas = jest.spyOn(Nas, 'findByIdOrFail').mockResolvedValue({ id: 5 });
    const toConn = jest.spyOn(routerProvisioningService, 'nasToConn').mockReturnValue({ host: '192.0.2.5' });
    const remove = jest.spyOn(routerosService, 'pppoeDelete').mockResolvedValue({ deleted: true });
    try {
      const result = await svc.endWindow(33, { orgId: 42, reason: 'manual_retry' });

      expect(result).toMatchObject({ closed: true, nas_disabled: true });
      expect(remove).toHaveBeenCalledWith({ host: '192.0.2.5' }, { name: 'sub_x' });
      expect(conn.query).toHaveBeenCalledWith(
        expect.stringMatching(/SET test_window_cleanup_pending = 1/),
        [33],
      );
      expect(db.query.mock.calls.some(([sql]) =>
        /SET test_window_cleanup_pending = 0, test_window_expires_at = NULL/.test(normalize(sql)))).toBe(true);
    } finally {
      findNas.mockRestore();
      toConn.mockRestore();
      remove.mockRestore();
    }
  });

  it('sweeps an expired row through the same locked, pending-only close path', async () => {
    const conn = wireLine({
      contract: { ...PENDING, test_window_expires_at: '2020-01-01T00:00:00.000Z', test_window_open: 0 },
      extra: async (sql) => {
        if (/SELECT id, organization_id FROM contracts WHERE test_window_cleanup_pending/.test(sql)) {
          return [[{ id: 33, organization_id: 42 }]];
        }
        return undefined;
      },
    });

    const result = await svc.sweep();

    expect(result).toEqual({ examined: 1, closed: 1 });
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /SET r\.status = 'inactive'/.test(sql))).toBe(true);
  });

  it('counts no sweep close and never disables service when formal activation wins before the row lock', async () => {
    const conn = wireLine({
      contract: { ...PENDING, status: 'active' },
      radius: { ...RADIUS, status: 'active' },
      extra: async (sql) => {
        if (/SELECT id, organization_id FROM contracts WHERE test_window_cleanup_pending/.test(sql)) {
          return [[{ id: 33, organization_id: 42 }]];
        }
        return undefined;
      },
    });

    const result = await svc.sweep();

    expect(result).toEqual({ examined: 1, closed: 0 });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /SET r\.status = 'inactive'/.test(sql))).toBe(false);
  });

  it('rechecks expiry under lock and does not close a window reopened after stale sweep selection', async () => {
    const conn = wireLine({
      contract: {
        ...PENDING,
        test_window_expires_at: FUTURE,
        test_window_cleanup_pending: 0,
        test_window_open: 1,
      },
      extra: async (sql) => {
        if (/SELECT id, organization_id FROM contracts WHERE test_window_cleanup_pending/.test(sql)) {
          return [[{ id: 33, organization_id: 42 }]];
        }
        return undefined;
      },
    });

    const result = await svc.sweep();

    expect(result).toEqual({ examined: 1, closed: 0 });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /SET r\.status = 'inactive'/.test(sql))).toBe(false);
  });

  it('prioritizes never-attempted cleanup so a failing LIMIT batch cannot starve later work', async () => {
    wireLine({
      extra: async (sql) => {
        if (/SELECT id, organization_id FROM contracts WHERE test_window_cleanup_pending/.test(sql)) return [[]];
        return undefined;
      },
    });

    await svc.sweep();

    const selection = db.query.mock.calls.find(([sql]) =>
      /SELECT id, organization_id FROM contracts WHERE test_window_cleanup_pending/.test(normalize(sql)));
    expect(normalize(selection[0])).toMatch(
      /ORDER BY \(test_window_cleanup_attempted_at IS NULL\) DESC, test_window_cleanup_attempted_at ASC, test_window_expires_at ASC, id ASC LIMIT 200/,
    );
    expect(normalize(selection[0])).not.toMatch(/cleanup_pending DESC/);
  });
});

// ---------------------------------------------------------------------------
// Speed-test completion — ownership + measurement + automatic off
// ---------------------------------------------------------------------------
const LOCKED_WO = {
  work_order_id: 13,
  organization_id: 42,
  client_id: 77,
  contract_id: 33,
  service_order_id: 8,
  work_type: 'installation',
  work_order_status: 'in_progress',
  assigned_to: 2,
  linked_service_order_id: 8,
  service_order_status: 'in_process',
  service_order_type: 'new_install',
  service_order_contract_id: 33,
  service_order_client_id: 77,
  linked_contract_id: 33,
  linked_contract_client_id: 77,
  contract_status: 'pending',
  connection_type: 'pppoe',
  test_window_expires_at: FUTURE,
  test_window_cleanup_pending: 0,
  test_window_open: 1,
};
const MEASUREMENT = {
  download_mbps: 125.5,
  upload_mbps: 42.25,
  latency_ms: 8.1,
  jitter_ms: 1.2,
  packet_loss_pct: 0,
  server_location: 'Chihuahua',
  notes: 'Ethernet handoff',
};

function wireComplete({
  lockedWo = LOCKED_WO,
  contract = PENDING,
  closeAffectedRows = 1,
  failInsert = false,
} = {}) {
  const speedTest = {
    id: 55,
    organization_id: 42,
    client_id: 77,
    contract_id: 33,
    work_order_id: 13,
    test_source: 'technician',
    ...MEASUREMENT,
  };
  const conn = wireLine({
    contract,
    closeAffectedRows,
    extra: async (sql) => {
      if (/FROM work_orders wo LEFT JOIN service_orders so/.test(sql) && /FOR UPDATE/.test(sql)) {
        return [lockedWo ? [{ ...lockedWo }] : []];
      }
      if (/INSERT INTO speed_tests/.test(sql)) {
        if (failInsert) throw new Error('simulated speed-test insert failure');
        return [{ insertId: 55, affectedRows: 1 }];
      }
      if (/SELECT \* FROM speed_tests WHERE id = \?/.test(sql)) return [[speedTest]];
      return undefined;
    },
  });
  return { conn, speedTest };
}

describe('testWindowService.completeWindow', () => {
  it('forces work-order ownership, records the technician result, and shuts down atomically', async () => {
    const { conn, speedTest } = wireComplete();

    const result = await svc.completeWindow(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    });

    expect(result).toEqual({
      speed_test: speedTest,
      closed: true,
      nas_disabled: null,
      nas_disable_warning: null,
      disconnect_confirmed: true,
      disconnect_outcome: 'ack',
      disconnect_warning: null,
    });
    const insert = conn.query.mock.calls.find(([sql]) => /INSERT INTO speed_tests/.test(sql));
    expect(normalize(insert[0])).toContain("VALUES (?, ?, ?, ?, 'technician'");
    expect(insert[1]).toEqual([
      42, 77, 33, 13, 'Chihuahua', 125.5, 42.25, 8.1, 1.2, 0, 'Ethernet handoff',
    ]);
    expect(conn.query.mock.calls.some(([sql]) => /SET r\.status = 'inactive'/.test(sql))).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(33);
  });

  it('records static commissioning evidence against the exact WO without enabling a line', async () => {
    const lockedWo = {
      ...LOCKED_WO,
      work_order_status: 'assigned',
      connection_type: 'static',
      test_window_expires_at: null,
      test_window_open: 0,
    };
    const { conn, speedTest } = wireComplete({ lockedWo });

    const result = await svc.recordOfflineCommissioningTest(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    });

    expect(result).toEqual({ speed_test: speedTest, recorded: true, line_state: 'offline' });
    const insert = conn.query.mock.calls.find(([sql]) => /INSERT INTO speed_tests/.test(sql));
    expect(insert[1].slice(0, 4)).toEqual([42, 77, 33, 13]);
    const transitionIndex = conn.query.mock.calls.findIndex(([sql]) =>
      /UPDATE work_orders SET status = 'in_progress'/.test(normalize(sql)));
    const insertIndex = conn.query.mock.calls.findIndex(([sql]) => /INSERT INTO speed_tests/.test(sql));
    expect(transitionIndex).toBeGreaterThanOrEqual(0);
    expect(transitionIndex).toBeLessThan(insertIndex);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE radius/.test(sql))).toBe(false);
    expect(suspensionService.sendRadiusDisconnect).not.toHaveBeenCalled();
  });

  it('rolls an assigned static visit back when its commissioning result cannot persist', async () => {
    const lockedWo = {
      ...LOCKED_WO,
      work_order_status: 'assigned',
      connection_type: 'static',
      test_window_expires_at: null,
      test_window_open: 0,
    };
    const { conn } = wireComplete({ lockedWo, failInsert: true });

    await expect(svc.recordOfflineCommissioningTest(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    })).rejects.toThrow('simulated speed-test insert failure');

    expect(conn.query.mock.calls.some(([sql]) =>
      /UPDATE work_orders SET status = 'in_progress'/.test(normalize(sql)))).toBe(true);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it.each([
    ['complete', _lockedWo => svc.completeWindow(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    }), {}],
    ['offline', _lockedWo => svc.recordOfflineCommissioningTest(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    }), { connection_type: 'static', test_window_expires_at: null, test_window_open: 0 }],
  ])('rejects %s evidence when the authoritative client chain disagrees', async (_name, invoke, overrides) => {
    const { conn } = wireComplete({
      lockedWo: {
        ...LOCKED_WO,
        ...overrides,
        linked_contract_client_id: 999,
      },
    });

    await expect(invoke()).rejects.toThrow(/links do not match/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO speed_tests/.test(sql))).toBe(false);
  });

  it.each([
    ['complete', () => svc.completeWindow(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    }), {}],
    ['offline', () => svc.recordOfflineCommissioningTest(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    }), { connection_type: 'static', test_window_expires_at: null, test_window_open: 0 }],
  ])('rejects %s evidence for a non-new-install service order', async (_name, invoke, overrides) => {
    const { conn } = wireComplete({
      lockedWo: {
        ...LOCKED_WO,
        ...overrides,
        service_order_type: 'relocation',
      },
    });

    await expect(invoke()).rejects.toThrow(/new-install service order/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO speed_tests/.test(sql))).toBe(false);
  });

  it('rolls back the result and leaves shutdown uncommitted when persistence fails', async () => {
    const { conn } = wireComplete({ failInsert: true });

    await expect(svc.completeWindow(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    })).rejects.toThrow('simulated speed-test insert failure');

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /SET r\.status = 'inactive'/.test(sql))).toBe(false);
    expect(suspensionService.sendRadiusDisconnect).not.toHaveBeenCalled();
  });

  it('rolls back the inserted result if the pending/open close guard loses', async () => {
    const { conn } = wireComplete({ closeAffectedRows: 0 });

    await expect(svc.completeWindow(13, MEASUREMENT, {
      orgId: 42, performedBy: 2, isAdmin: false,
    })).rejects.toThrow(/contract changed/);

    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO speed_tests/.test(sql))).toBe(true);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /SET r\.status = 'inactive'/.test(sql))).toBe(false);
    expect(suspensionService.sendRadiusDisconnect).not.toHaveBeenCalled();
  });

  it('rejects an otherwise-permitted technician who is not the current assignee', async () => {
    const { conn } = wireComplete();

    await expect(svc.completeWindow(13, MEASUREMENT, {
      orgId: 42, performedBy: 3, isAdmin: false,
    })).rejects.toThrow(/Only the assigned technician/);

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO speed_tests/.test(sql))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Routes — workflow eligibility, assignee/admin authorization, legal gate
// ---------------------------------------------------------------------------
const ROUTE_WO = {
  id: 13,
  organization_id: 42,
  client_id: 77,
  contract_id: 33,
  service_order_id: 8,
  work_type: 'installation',
  status: 'assigned',
  assigned_to: 2,
  linked_service_order_id: 8,
  service_order_status: 'in_process',
  service_order_type: 'new_install',
  connection_type: 'pppoe',
};

function wireRoute({
  wo = ROUTE_WO,
  contract = PENDING,
  authorizationState = 'none',
  locale = 'MX',
} = {}) {
  const { conn } = wireComplete({
    contract,
    lockedWo: wo ? {
      ...LOCKED_WO,
      client_id: wo.client_id,
      contract_id: wo.contract_id,
      service_order_id: wo.service_order_id,
      work_type: wo.work_type,
      work_order_status: wo.status,
      assigned_to: wo.assigned_to,
      linked_service_order_id: wo.linked_service_order_id,
      service_order_status: wo.service_order_status,
      service_order_type: wo.service_order_type,
      linked_contract_id: wo.contract_id,
      connection_type: wo.connection_type ?? 'pppoe',
      test_window_expires_at: wo.connection_type === 'static' ? null : FUTURE,
      test_window_open: wo.connection_type === 'static' ? 0 : 1,
    } : null,
  });
  const baseImpl = db.query.getMockImplementation();
  db.query.mockImplementation(async (rawSql, params = []) => {
    const sql = normalize(rawSql);
    if (/SELECT wo\.\*, so\.id AS linked_service_order_id/.test(sql)) {
      return [wo ? [{ ...wo }] : []];
    }
    if (/SELECT so\.organization_id, so\.client_id, so\.contract_id/.test(sql)
        && /COALESCE\(o\.locale/.test(sql)) {
      return [[{
        organization_id: 42,
        client_id: wo?.client_id ?? 77,
        contract_id: wo?.contract_id ?? 33,
        locale,
      }]];
    }
    if (/FROM document_templates/.test(sql) && params[1] === 'installation_authorization') {
      return [authorizationState === 'none'
        ? []
        : [{ id: 91, name: 'Arrival authorization' }]];
    }
    if (/FROM signed_documents/.test(sql) && params[4] === 'installation_authorization') {
      if (authorizationState === 'none' || authorizationState === 'missing') return [[]];
      return [[{
        template_id: 91,
        title: 'Arrival authorization',
        status: authorizationState,
      }]];
    }
    return baseImpl(rawSql, params);
  });
  return conn;
}

describe('POST /work-orders/:id/test-window/*', () => {
  it('allows an administrator to supervise an eligible assigned visit', async () => {
    const conn = wireRoute();
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data.expires_at).toBeTruthy();
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('allows the current technician but rejects a different technician', async () => {
    wireRoute();
    const own = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${TECH_TOKEN}`);
    expect(own.status).toBe(200);

    jest.clearAllMocks();
    wireRoute();
    const other = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${OTHER_TECH_TOKEN}`);
    expect(other.status).toBe(403);
    expect(other.body.error.message).toMatch(/assigned technician/);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it.each([
    ['custom contract supervisor', CUSTOM_SUPERVISOR_TOKEN],
    ['effective super-admin', SUPER_ADMIN_TOKEN],
  ])('allows an %s to supervise another technician without the legacy admin role', async (_label, authToken) => {
    const conn = wireRoute();
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('uses effective contracts.update authority for supervised completion too', async () => {
    const conn = wireRoute();
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/complete')
      .set('Authorization', `Bearer ${CUSTOM_SUPERVISOR_TOKEN}`)
      .send(MEASUREMENT);

    expect(res.status).toBe(200);
    expect(res.body.data.closed).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('requires an assigned/in-progress installation and in-process service order', async () => {
    wireRoute({ wo: { ...ROUTE_WO, service_order_status: 'done' } });
    const wrongService = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(wrongService.status).toBe(422);
    expect(wrongService.body.error.message).toMatch(/in-process new-install service order/);

    jest.clearAllMocks();
    wireRoute({ wo: { ...ROUTE_WO, status: 'pending' } });
    const unassignedState = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(unassignedState.status).toBe(422);
    expect(unassignedState.body.error.message).toMatch(/assigned or in-progress/);
  });

  it.each([
    ['/api/v1/work-orders/13/test-window/start', 'pppoe'],
    ['/api/v1/work-orders/13/test-window/complete', 'pppoe'],
    ['/api/v1/work-orders/13/commissioning-test', 'static'],
  ])('rejects commissioning through a non-new-install order at %s', async (path, connectionType) => {
    const conn = wireRoute({
      wo: {
        ...ROUTE_WO,
        service_order_type: 'relocation',
        connection_type: connectionType,
      },
    });
    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(MEASUREMENT);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/new-install service order/);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO speed_tests/.test(normalize(sql)))).toBe(false);
    expect(conn.query.mock.calls.some(([sql]) => /DATE_ADD\(NOW\(\), INTERVAL/.test(normalize(sql)))).toBe(false);
  });

  it('keeps end available after dispatch completes and unassigns the visit', async () => {
    const conn = wireRoute({
      contract: { ...PENDING, test_window_expires_at: FUTURE, test_window_open: 1 },
      wo: {
        ...ROUTE_WO,
        status: 'completed',
        assigned_to: null,
        service_order_status: 'done',
      },
    });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/end')
      .set('Authorization', `Bearer ${OTHER_TECH_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data.closed).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(33);
  });

  it('blocks start while an installation authorization is pending', async () => {
    const conn = wireRoute({ authorizationState: 'pending' });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Arrival authorization/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /DATE_ADD\(NOW\(\), INTERVAL/.test(normalize(sql)))).toBe(false);
  });

  it('blocks start when an active arrival template has no document instance', async () => {
    const conn = wireRoute({ authorizationState: 'missing' });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Arrival authorization/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /DATE_ADD\(NOW\(\), INTERVAL/.test(normalize(sql)))).toBe(false);
  });

  it('blocks completion when the exact arrival authorization was cancelled', async () => {
    const conn = wireRoute({ authorizationState: 'cancelled' });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/complete')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(MEASUREMENT);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Arrival authorization/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO speed_tests/.test(normalize(sql)))).toBe(false);
  });

  it('does not retroactively apply a late arrival template after the visit is in progress', async () => {
    const conn = wireRoute({
      authorizationState: 'missing',
      wo: { ...ROUTE_WO, status: 'in_progress' },
    });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/complete')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(MEASUREMENT);

    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /FROM document_templates/.test(normalize(sql)))).toBe(false);
  });

  it('allows commissioning when every active arrival authorization is signed', async () => {
    const conn = wireRoute({
      authorizationState: 'signed',
      wo: { ...ROUTE_WO, connection_type: 'static' },
    });
    const res = await request(app)
      .post('/api/v1/work-orders/13/commissioning-test')
      .set('Authorization', `Bearer ${TECH_TOKEN}`)
      .send(MEASUREMENT);

    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('keeps global commissioning exempt from historical MX arrival documents', async () => {
    const conn = wireRoute({ authorizationState: 'cancelled', locale: 'global' });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /FROM document_templates/.test(normalize(sql)))).toBe(false);
  });

  it('validates positive speeds, persists completion, and returns the closed result', async () => {
    const invalid = wireRoute();
    const bad = await request(app)
      .post('/api/v1/work-orders/13/test-window/complete')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ download_mbps: 0, upload_mbps: 10 });
    expect(bad.status).toBe(422);
    expect(invalid.beginTransaction).not.toHaveBeenCalled();

    jest.clearAllMocks();
    const conn = wireRoute();
    const good = await request(app)
      .post('/api/v1/work-orders/13/test-window/complete')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ ...MEASUREMENT, client_id: 999, contract_id: 999, test_source: 'external' });

    expect(good.status).toBe(200);
    expect(good.body.data.closed).toBe(true);
    expect(good.body.data.speed_test).toMatchObject({
      organization_id: 42, client_id: 77, contract_id: 33, test_source: 'technician',
    });
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('records static commissioning through the dedicated assigned-tech endpoint while keeping the line offline', async () => {
    const conn = wireRoute({ wo: { ...ROUTE_WO, connection_type: 'static' } });
    const res = await request(app)
      .post('/api/v1/work-orders/13/commissioning-test')
      .set('Authorization', `Bearer ${TECH_TOKEN}`)
      .send(MEASUREMENT);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ recorded: true, line_state: 'offline' });
    expect(res.body.data.speed_test).toMatchObject({
      organization_id: 42,
      client_id: 77,
      contract_id: 33,
      work_order_id: 13,
      test_source: 'technician',
    });
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE radius/.test(sql))).toBe(false);
  });

  it.each([
    '/api/v1/work-orders/13/test-window/complete',
    '/api/v1/work-orders/13/commissioning-test',
  ])('requires speed_tests.create before %s may mint activation evidence', async (path) => {
    wireRoute();
    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${SUPPORT_TOKEN}`)
      .send({ download_mbps: 50, upload_mbps: 10 });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/speed_tests\.create/);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO speed_tests/.test(normalize(sql)))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Generic WO completion cannot bypass commissioning, but unrelated/manual
// installation visits keep their historical completion flow.
// ---------------------------------------------------------------------------
describe('installation work-order completion commissioning gate', () => {
  function signedGlobalAcknowledgment(serviceOrderId) {
    const renderedBody = 'Frozen global installation handoff';
    const document = {
      id: 91,
      organization_id: 42,
      client_id: 77,
      contract_id: 33,
      service_order_id: serviceOrderId,
      work_order_id: 13,
      template_id: null,
      template_type: 'service_acknowledgment',
      title: 'Service installation acknowledgment',
      rendered_body: renderedBody,
      content_sha256: crypto.createHash('sha256').update(renderedBody).digest('hex'),
      contract_template_mx_id: null,
      mx_registration_number: null,
      mx_registered_at: null,
      mx_template_version: null,
      mx_source_sha256: null,
      status: 'signed',
      signer_name: 'Test Customer',
      signature_image: 'data:image/png;base64,iVBORw0KGgo=',
      signed_at: '2026-08-11T08:00:00.000Z',
      signed_ip: '127.0.0.1',
      captured_by: 2,
      communication_choices: null,
      deleted_at: null,
    };
    document.evidence_sha256 = legalDocumentService.evidenceDigest(document);
    return document;
  }

  function wireCompletionGate({
    orderType = 'new_install',
    hasEvidence = 0,
    expiresAt = null,
    cleanupPending = 0,
    serviceOrderId = 8,
    workOrderStatus = 'in_progress',
  } = {}) {
    const conn = mockTxConnection(db);
    const before = {
      id: 13,
      organization_id: 42,
      client_id: 77,
      contract_id: 33,
      service_order_id: serviceOrderId,
      work_type: 'installation',
      status: workOrderStatus,
      acceptance_waived: 1,
      acceptance_notes: 'Existing documented acceptance waiver',
      assigned_to: 2,
    };
    db.query.mockImplementation(async (rawSql, params = []) => {
      const sql = normalize(rawSql);
      const auth = authAndPermissions(sql, params);
      if (auth) return auth;
      if (/SELECT \* FROM work_orders WHERE id = \? AND organization_id = \?/.test(sql)) {
        return [[before]];
      }
      if (/SELECT so\.organization_id, so\.client_id, so\.contract_id/.test(sql)
          && /COALESCE\(o\.locale/.test(sql)) {
        return [[{
          organization_id: 42,
          client_id: 77,
          contract_id: 33,
          locale: 'global',
        }]];
      }
      if (/FROM signed_documents/.test(sql) && /template_type = \?/.test(sql)) {
        return [[signedGlobalAcknowledgment(serviceOrderId)]];
      }
      if (/SELECT so\.id, so\.order_type, so\.status, so\.contract_id/.test(sql)) {
        return [[{
          id: 8,
          order_type: orderType,
          status: 'in_process',
          contract_id: 33,
          client_id: 77,
          linked_contract_id: 33,
          contract_client_id: 77,
        }]];
      }
      if (/SELECT so\.order_type, so\.contract_id AS order_contract_id/.test(sql)) {
        return [[{
          order_type: orderType,
          order_contract_id: 33,
          linked_contract_id: 33,
          test_window_expires_at: expiresAt,
          test_window_cleanup_pending: cleanupPending,
          has_commissioning_test: hasEvidence,
        }]];
      }
      if (/UPDATE work_orders SET/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM work_orders WHERE id = \?/.test(sql)) {
        return [[{ ...before, status: 'completed' }]];
      }
      return [[]];
    });
    return conn;
  }

  it('blocks a new-install WO until its exact commissioning test exists', async () => {
    wireCompletionGate({ hasEvidence: 0 });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/commissioning speed test/);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE work_orders SET/.test(sql))).toBe(false);
  });

  it('blocks completion while an open or failed-cleanup window remains', async () => {
    wireCompletionGate({ hasEvidence: 1, cleanupPending: 1 });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/wait for network cleanup/);
  });

  it('allows completion once exact evidence exists and temporary access is fully closed', async () => {
    wireCompletionGate({ hasEvidence: 1 });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
  });

  it('does not impose activation commissioning on a manually created installation WO', async () => {
    wireCompletionGate({ serviceOrderId: null });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(db.query.mock.calls.some(([sql]) => /has_commissioning_test/.test(sql))).toBe(false);
  });

  it('rejects acceptance and completion by a technician who is not the assignee', async () => {
    wireCompletionGate({ hasEvidence: 1 });
    const acceptance = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${OTHER_TECH_TOKEN}`)
      .send({ acceptance_link_mbps: 100 });
    expect(acceptance.status).toBe(403);
    expect(acceptance.body.error.message).toMatch(/assigned technician/);

    jest.clearAllMocks();
    wireCompletionGate({ hasEvidence: 1 });
    const completion = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${OTHER_TECH_TOKEN}`)
      .send({ status: 'completed' });
    expect(completion.status).toBe(403);
  });

  it('prevents an ordinary technician from self-assigning a prepared activation visit', async () => {
    wireCompletionGate({ hasEvidence: 1 });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${OTHER_TECH_TOKEN}`)
      .send({ assigned_to: 3 });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/contract administrator/);
  });

  it('requires nonblank notes when the assigned technician waives acceptance', async () => {
    wireCompletionGate({ hasEvidence: 1 });
    const missing = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TECH_TOKEN}`)
      .send({ acceptance_waived: true, acceptance_notes: '   ' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.message).toMatch(/waiver notes are required/);

    jest.clearAllMocks();
    wireCompletionGate({ hasEvidence: 1 });
    const documented = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${TECH_TOKEN}`)
      .send({ acceptance_waived: true, acceptance_notes: 'No optical meter available' });
    expect(documented.status).toBe(200);
  });

  it('keeps completed activation acceptance evidence immutable even for an administrator', async () => {
    wireCompletionGate({ hasEvidence: 1, workOrderStatus: 'completed' });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ acceptance_signal_dbm: -41 });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/acceptance evidence.*immutable/i);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE work_orders SET/.test(sql))).toBe(false);
  });

  it('also keeps completed activation acceptance immutable through full PUT replacement', async () => {
    wireCompletionGate({ hasEvidence: 1, workOrderStatus: 'completed' });
    const res = await request(app)
      .put('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({
        title: 'Completed activation visit',
        status: 'completed',
        priority: 'medium',
        client_id: 77,
        contract_id: 33,
        service_order_id: 8,
        work_type: 'installation',
        acceptance_notes: 'Rewritten after completion',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/acceptance evidence.*immutable/i);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE work_orders SET/.test(sql))).toBe(false);
  });

  it('does not allow reopening a completed activation visit to bypass immutability', async () => {
    wireCompletionGate({ hasEvidence: 1, workOrderStatus: 'completed' });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/cannot be reopened/i);
  });

  it('preserves historical acceptance editing for completed non-new-install visits', async () => {
    wireCompletionGate({ orderType: 'relocation', workOrderStatus: 'completed' });
    const res = await request(app)
      .patch('/api/v1/work-orders/13')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ acceptance_signal_dbm: -41 });

    expect(res.status).toBe(200);
  });
});

describe('activation work-order creation authority', () => {
  const activationOrder = {
    id: 8,
    order_type: 'new_install',
    status: 'in_process',
    contract_id: 33,
    client_id: 77,
    linked_contract_id: 33,
    contract_client_id: 77,
  };
  const body = {
    title: 'Install subscriber',
    client_id: 77,
    contract_id: 33,
    service_order_id: 8,
    work_type: 'installation',
  };

  function wireCreate({ order = activationOrder, duplicate = null } = {}) {
    db.query.mockImplementation(async (rawSql, params = []) => {
      const sql = normalize(rawSql);
      const auth = authAndPermissions(sql, params);
      if (auth) return auth;
      if (/SELECT so\.id, so\.order_type, so\.status, so\.contract_id/.test(sql)) {
        return [[order]];
      }
      if (/SELECT id FROM work_orders WHERE organization_id/.test(sql)) {
        return [duplicate ? [duplicate] : []];
      }
      return [[]];
    });
  }

  it('does not let a work-order creator manufacture an activation visit', async () => {
    wireCreate();
    const res = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${OTHER_TECH_TOKEN}`)
      .send(body);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/contract administrator/);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO work_orders/.test(sql))).toBe(false);
  });

  it('rejects a duplicate even for an administrator in favor of the canonical prepared visit', async () => {
    wireCreate({ duplicate: { id: 13 } });
    const res = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/canonical installation work order/);
  });

  it('rejects a new-install work order whose client does not match its contract', async () => {
    wireCreate({ order: { ...activationOrder, contract_client_id: 88 } });
    const res = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/service order, contract, and client/);
  });
});
