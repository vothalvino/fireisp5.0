'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
  userHasPermission: async () => true,
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const token = jwt.sign(
  { sub: 1, email: 'admin@example.test', role: 'manager', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

function wire({ locale = 'global', blockers = {} } = {}) {
  const state = { id: 1, name: 'Example ISP', locale, status: 'active' };
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(async (sql, params = []) => {
      if (/SELECT \* FROM `organizations`/.test(sql)) return [[{ ...state }]];
      if (/EXISTS \([\s\S]*FROM contracts/.test(sql)) {
        return [[{
          has_nonterminal_contract: blockers.contract ? 1 : 0,
          has_open_new_install: blockers.install ? 1 : 0,
          has_pending_signed_document: blockers.document ? 1 : 0,
        }]];
      }
      if (/^UPDATE `organizations`/.test(sql)) {
        state.locale = params[0];
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }),
  };
  db.getConnection.mockResolvedValue(conn);
  db.query.mockImplementation(async (sql, params = []) => {
    if (String(sql).includes('`users`')) {
      return [[{ id: 1, email: 'admin@example.test', role: 'manager', status: 'active', organization_id: 1 }]];
    }
    if (/SELECT \* FROM `organizations`/.test(sql)) return [[{ ...state }]];
    if (/^UPDATE `organizations`/.test(sql)) {
      if (/`locale` = \?/.test(sql)) state.locale = params[0];
      if (/`name` = \?/.test(sql)) state.name = params[0];
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
  return { conn, state };
}

beforeEach(() => jest.clearAllMocks());

describe('organization locale change guard', () => {
  it.each([
    ['nonterminal contract', { contract: true }, 'nonterminal_contract'],
    ['open new installation', { install: true }, 'open_new_install'],
    ['pending signing document', { document: true }, 'pending_signed_document'],
  ])('blocks a locale change with a %s', async (_label, blockers, expectedBlocker) => {
    const { conn } = wire({ blockers });

    const res = await request(app)
      .patch('/api/v1/organizations/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'MX' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'ORG_LOCALE_CHANGE_BLOCKED',
      details: {
        current_locale: 'global',
        requested_locale: 'MX',
        blockers: [expectedBlocker],
      },
    });
    expect(conn.execute.mock.calls.some(([sql]) => /^UPDATE `organizations`/.test(sql))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('locks the organization first, then allows a change after every flow is closed', async () => {
    const { conn } = wire({ locale: 'MX' });

    const res = await request(app)
      .put('/api/v1/organizations/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'global' });

    expect(res.status).toBe(200);
    expect(res.body.data.locale).toBe('global');
    expect(conn.execute.mock.calls[0][0]).toMatch(/FROM `organizations`[\s\S]*FOR UPDATE/);
    expect(conn.execute.mock.calls[1][0]).toMatch(/FROM contracts/);
    expect(conn.execute.mock.calls[1][0]).toMatch(/status IN \('pending','active','suspended'\)/);
    expect(conn.execute.mock.calls[1][0]).toMatch(/order_type = 'new_install'/);
    expect(conn.execute.mock.calls[1][0]).toMatch(/status = 'pending'/);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it('does not probe workflow history when the requested locale is unchanged', async () => {
    const { conn } = wire({ locale: 'MX', blockers: { contract: true } });

    const res = await request(app)
      .patch('/api/v1/organizations/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'MX', name: 'Renamed ISP' });

    expect(res.status).toBe(200);
    expect(conn.execute.mock.calls.some(([sql]) => /FROM contracts/.test(sql))).toBe(false);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary updates on the existing non-transactional path when locale is omitted', async () => {
    wire({ blockers: { contract: true, install: true, document: true } });

    const res = await request(app)
      .put('/api/v1/organizations/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed ISP' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed ISP');
    expect(db.getConnection).not.toHaveBeenCalled();
  });
});
