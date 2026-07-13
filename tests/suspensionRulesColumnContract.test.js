// =============================================================================
// FireISP 5.0 — suspension_rules create/update column contract
// =============================================================================
// SuspensionRule.fillable and the create/update validation schemas both used
// wrong column names — `is_enabled` (real: `is_active`), `notify_days_before`
// (real: `notify_before_days`), `plan_ids` (real: `apply_to_plan_ids`) — and
// `fillable` was entirely MISSING `name`, a NOT NULL column with no default.
// BaseModel.create()/update() build `INSERT/UPDATE ... (\`col\`)` directly from
// `fillable`, so this was a straight 500 on every suspension-rule create/update
// via the API: creating or editing a dunning rule has never worked. Because
// that SQL is assembled dynamically from `this.fillable` at runtime, it is
// invisible to `node src/scripts/sql-column-check.js` (correctly reported as
// "skipped — dynamic column list"), so this needed a dedicated test.
// =============================================================================

const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');
const SuspensionRule = require('../src/models/SuspensionRule');
const { parseSchema } = require('../src/scripts/sql-column-check');

const SCHEMA = parseSchema(
  fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'),
).get('suspension_rules');

const AUTH = 'Bearer ' + jwt.sign(
  { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

describe('SuspensionRule.fillable matches database/schema.sql', () => {
  test('every fillable field is a real column, and NOT NULL name is present', () => {
    for (const col of SuspensionRule.fillable) {
      expect(SCHEMA.columns.has(col)).toBe(true);
    }
    expect(SuspensionRule.fillable).toContain('name');
    // The wrong names must never come back.
    for (const bogus of ['is_enabled', 'notify_days_before', 'plan_ids']) {
      expect(SuspensionRule.fillable).not.toContain(bogus);
    }
  });
});

describe('POST /api/v1/suspension-rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue({
      id: 1, email: 'admin@test.com', status: 'active', role: 'admin', organization_id: 1,
    });
  });

  test('creates a rule using only real columns, including the NOT NULL name', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 42 }])
      .mockResolvedValueOnce([[{ id: 42, name: '30-day suspend', is_active: 1 }]]);

    const res = await request(app)
      .post('/api/v1/suspension-rules')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({
        name: '30-day suspend',
        days_past_due: 30,
        action: 'auto_suspend',
        notify_before_days: 5,
        is_active: false,
      });

    expect(res.status).toBe(201);

    const [insertSql, insertParams] = db.query.mock.calls[0];
    expect(insertSql).toMatch(/INSERT INTO `suspension_rules`/);
    for (const col of ['name', 'days_past_due', 'action', 'notify_before_days', 'is_active', 'organization_id']) {
      expect(insertSql).toContain(`\`${col}\``);
    }
    expect(insertSql).not.toMatch(/`is_enabled`/);
    expect(insertSql).not.toMatch(/`notify_days_before`/);
    expect(insertParams).toContain('30-day suspend');
    expect(insertParams).toContain(false);
  });
});

describe('PUT /api/v1/suspension-rules/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue({
      id: 1, email: 'admin@test.com', status: 'active', role: 'admin', organization_id: 1,
    });
  });

  test('toggling is_active actually reaches the database', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5, name: 'Existing rule', is_active: 1 }]])  // findByIdOrFail (pre-update fetch)
      .mockResolvedValueOnce([{ affectedRows: 1 }])                               // the UPDATE itself
      .mockResolvedValueOnce([[{ id: 5, is_active: 0 }]]);                        // Model.update's post-update SELECT

    const res = await request(app)
      .put('/api/v1/suspension-rules/5')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ is_active: false });

    expect(res.status).toBe(200);

    const [updateSql, updateParams] = db.query.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE `suspension_rules` SET/);
    expect(updateSql).toContain('`is_active`');
    expect(updateSql).not.toContain('`is_enabled`');
    expect(updateParams).toContain(false);
  });
});
