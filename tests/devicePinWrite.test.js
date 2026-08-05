'use strict';
// =============================================================================
// FireISP 5.0 — device map pins are writable (j68 option C, half A)
// =============================================================================
// devices.latitude/longitude were readable everywhere (topology map, lead
// feasibility's nearest-AP section) but writable NOWHERE: absent from the
// validation schemas and the model fillable, so any write was silently
// dropped. These tests pin the fix at the route level: the values pass
// validation, survive fillable filtering, and land in the UPDATE.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const TOKEN = jwt.sign(
  { sub: 1, email: 'a@b.c', role: 'admin', orgId: 42 },
  config.jwt.secret, { expiresIn: '1h' },
);
const isAuthLookup = (s) => typeof s === 'string' && /`users`/.test(s);
const ADMIN_ROW = [[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 42 }]];

const DEVICE = { id: 3, organization_id: 42, name: 'North AP', type: 'ptmp_ap', latitude: null, longitude: null };

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation(async (sql) => {
    if (isAuthLookup(sql)) return ADMIN_ROW;
    if (/SELECT \* FROM `?devices`?/i.test(sql)) return [[{ ...DEVICE }]];
    if (/UPDATE `?devices`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
});

const updateCall = () => db.query.mock.calls.find(([s]) => /UPDATE `?devices`?/i.test(s));

it('PATCH persists latitude/longitude — the topology pin finally has a write path', async () => {
  const res = await request(app)
    .patch('/api/v1/devices/3')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ latitude: 19.401, longitude: -99.171 });
  expect(res.status).toBe(200);
  const upd = updateCall();
  expect(upd).toBeDefined();
  expect(upd[0]).toMatch(/`latitude`\s*=|latitude\s*=/);
  expect(upd[1]).toEqual(expect.arrayContaining([19.401, -99.171]));
});

it('rejects an out-of-range latitude instead of writing garbage onto the map', async () => {
  const res = await request(app)
    .patch('/api/v1/devices/3')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ latitude: 123 });
  expect(res.status).toBe(422);
  expect(updateCall()).toBeUndefined();
});

it('explicit null clears the pin', async () => {
  db.query.mockImplementation(async (sql) => {
    if (isAuthLookup(sql)) return ADMIN_ROW;
    if (/SELECT \* FROM `?devices`?/i.test(sql)) return [[{ ...DEVICE, latitude: 19.4, longitude: -99.1 }]];
    if (/UPDATE `?devices`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  const res = await request(app)
    .patch('/api/v1/devices/3')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ latitude: null, longitude: null });
  expect(res.status).toBe(200);
  const upd = updateCall();
  expect(upd).toBeDefined();
});
