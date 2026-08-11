// =============================================================================
// FireISP 5.0 — Work-order assignee authorization tests
// Covers:
//   A. Only users authorized to work with work orders (work_orders.update) may
//      be set as an assignee — enforced on POST, PUT and PATCH.
//   B. Unassigning / status-only patches skip the authorization check.
//   C. GET /work-orders/assignable-users lists only authorized users.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}
const TOKEN = adminToken();
const customToken = (permissionsRole = 'support') => jwt.sign(
  { sub: 2, email: 'custom@example.com', role: permissionsRole, orgId: 42 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

// ---------------------------------------------------------------------------
// SQL matchers — the routes issue several queries per request; matching by
// shape (rather than call order) keeps these tests robust to incidental extra
// queries.
// ---------------------------------------------------------------------------
const isAuthLookup      = (s) => typeof s === 'string' && /WHERE id = \?/.test(s) && !/work_orders/.test(s) && !/organization_users/.test(s);
const isAssigneeCheck   = (s) => typeof s === 'string' && /FROM users u\s+LEFT JOIN organization_users/.test(s) && /LIMIT 1/.test(s);
const isAssignableList  = (s) => typeof s === 'string' && /SELECT DISTINCT u\.id/.test(s) && /FROM users u/.test(s);
const isWoInsert        = (s) => typeof s === 'string' && /INSERT INTO work_orders/.test(s);
const isWoUpdate        = (s) => typeof s === 'string' && /UPDATE work_orders SET/.test(s);
const isWoSelect        = (s) => typeof s === 'string' && /SELECT \* FROM work_orders WHERE id = \?/.test(s);

const ADMIN_ROW = [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];
const called = (matcher) => db.query.mock.calls.some((c) => matcher(c[0]));

beforeEach(() => { jest.clearAllMocks(); });

// ---------------------------------------------------------------------------
// A. POST — assignee authorization
// ---------------------------------------------------------------------------
describe('POST /work-orders — assignee authorization', () => {
  test('rejects an assignee who is not authorized to work with work orders', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isAssigneeCheck(sql)) return Promise.resolve([[]]);       // not authorized
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ title: 'Splice fiber', client_id: 3, assigned_to: 8 });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not authorized/i);
    // The record must NOT have been written.
    expect(called(isWoInsert)).toBe(false);
    // Bind contract (see User.hasEffectivePermission):
    // [orgId (ou join), userId, orgId (connected), slug, orgId, slug]
    const checkCall = db.query.mock.calls.find((c) => isAssigneeCheck(c[0]));
    expect(checkCall[1]).toEqual([42, 8, 42, 'work_orders.update', 'work_orders.update', 42, 'work_orders.update']);
  });

  test('accepts an authorized assignee and creates the work order', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isAssigneeCheck(sql)) return Promise.resolve([[{ '1': 1 }]]); // authorized
      if (isWoInsert(sql)) return Promise.resolve([{ insertId: 10 }]);
      if (isWoSelect(sql)) return Promise.resolve([[{ id: 10, title: 'Splice fiber', assigned_to: 7 }]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ title: 'Splice fiber', client_id: 3, assigned_to: 7 });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(10);
    expect(called(isWoInsert)).toBe(true);
    const checkCall = db.query.mock.calls.find((c) => isAssigneeCheck(c[0]));
    expect(checkCall[1]).toEqual([42, 7, 42, 'work_orders.update', 'work_orders.update', 42, 'work_orders.update']);
  });

  test('skips the authorization check when no assignee is provided', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isWoInsert(sql)) return Promise.resolve([{ insertId: 11 }]);
      if (isWoSelect(sql)) return Promise.resolve([[{ id: 11, title: 'Unassigned job' }]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ title: 'Unassigned job', client_id: 3 });

    expect(res.status).toBe(201);
    expect(called(isAssigneeCheck)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. PATCH — assignee authorization is scoped to the assigned_to field
// ---------------------------------------------------------------------------
describe('PATCH /work-orders/:id — assignee authorization', () => {
  test('rejects reassigning to an unauthorized user without updating the row', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isAssigneeCheck(sql)) return Promise.resolve([[]]);       // not authorized
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .patch('/api/v1/work-orders/10')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ assigned_to: 8 });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not authorized/i);
    expect(called(isWoUpdate)).toBe(false);
  });

  test('a status-only transition does not trigger the assignee check', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isWoUpdate(sql)) return Promise.resolve([{ affectedRows: 1 }]);
      if (isWoSelect(sql)) return Promise.resolve([[{ id: 10, status: 'assigned' }]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .patch('/api/v1/work-orders/10')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'assigned' });

    expect(res.status).toBe(200);
    expect(called(isAssigneeCheck)).toBe(false);
    expect(called(isWoUpdate)).toBe(true);
  });

  test('clearing the assignee (assigned_to: null) is allowed', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isWoUpdate(sql)) return Promise.resolve([{ affectedRows: 1 }]);
      if (isWoSelect(sql)) return Promise.resolve([[{ id: 10, assigned_to: null }]]);
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .patch('/api/v1/work-orders/10')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ assigned_to: null });

    expect(res.status).toBe(200);
    expect(called(isAssigneeCheck)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. Assignable-users listing
// ---------------------------------------------------------------------------
describe('GET /work-orders/assignable-users', () => {
  test('returns the users authorized to work with work orders', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isAssignableList(sql)) {
        return Promise.resolve([[{ id: 7, first_name: 'Tina', last_name: 'Tech', email: 't@example.com' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/work-orders/assignable-users')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].first_name).toBe('Tina');

    // Bind contract (see User.getUsersWithPermission):
    // [orgId (ou join), orgId (connected), slug, orgId, slug]
    const listCall = db.query.mock.calls.find((c) => isAssignableList(c[0]));
    expect(listCall).toBeTruthy();
    expect(listCall[1]).toEqual([42, 42, 'work_orders.update', 'work_orders.update', 42, 'work_orders.update']);
  });

  test('commissioning mode includes a default technician with all three permissions and excludes a custom assignee without view', async () => {
    db.query.mockImplementation((sql, params = []) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isAssignableList(sql)) {
        return Promise.resolve([[
          { id: 7, first_name: 'Tina', last_name: 'Tech' },
          { id: 8, first_name: 'Casey', last_name: 'Custom' },
        ]]);
      }
      if (isAssigneeCheck(sql)) {
        const userId = Number(params[1]);
        const permission = params[3];
        const allowed = userId === 7
          || (userId === 8 && permission === 'speed_tests.create');
        return Promise.resolve([allowed ? [{ '1': 1 }] : []]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/work-orders/assignable-users?commissioning=true')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map(user => user.id)).toEqual([7]);
    const permissionChecks = db.query.mock.calls.filter((call) => isAssigneeCheck(call[0]));
    expect(permissionChecks).toHaveLength(4);
    for (const userId of [7, 8]) {
      expect(permissionChecks.some(([, params]) => (
        Number(params[1]) === userId && params.includes('work_orders.view')
      ))).toBe(true);
      expect(permissionChecks.some(([, params]) => (
        Number(params[1]) === userId && params.includes('speed_tests.create')
      ))).toBe(true);
    }
  });

  test('commissioning mode allows a custom role with contracts.update but no work_orders.view', async () => {
    const permissionSpy = jest.spyOn(User, 'getPermissions')
      .mockResolvedValue(['contracts.update']);
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) {
        return Promise.resolve([[
          { id: 2, email: 'custom@example.com', role: 'support', status: 'active', organization_id: 42 },
        ]]);
      }
      if (isAssignableList(sql)) return Promise.resolve([[]]);
      return Promise.resolve([[]]);
    });

    try {
      const res = await request(app)
        .get('/api/v1/work-orders/assignable-users?commissioning=true')
        .set('Authorization', `Bearer ${customToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(permissionSpy).toHaveBeenCalledWith(2, 42);
    } finally {
      permissionSpy.mockRestore();
    }
  });

  test('commissioning mode denies a custom role with neither accepted permission', async () => {
    const permissionSpy = jest.spyOn(User, 'getPermissions')
      .mockResolvedValue(['contracts.view']);
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) {
        return Promise.resolve([[
          { id: 2, email: 'custom@example.com', role: 'support', status: 'active', organization_id: 42 },
        ]]);
      }
      return Promise.resolve([[]]);
    });

    try {
      const res = await request(app)
        .get('/api/v1/work-orders/assignable-users?commissioning=true')
        .set('Authorization', `Bearer ${customToken()}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/work_orders\.view or contracts\.update/);
      expect(called(isAssignableList)).toBe(false);
    } finally {
      permissionSpy.mockRestore();
    }
  });

  test('ordinary picker still denies contracts.update without work_orders.view', async () => {
    const permissionSpy = jest.spyOn(User, 'getPermissions')
      .mockResolvedValue(['contracts.update']);
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) {
        return Promise.resolve([[
          { id: 2, email: 'custom@example.com', role: 'support', status: 'active', organization_id: 42 },
        ]]);
      }
      return Promise.resolve([[]]);
    });

    try {
      const res = await request(app)
        .get('/api/v1/work-orders/assignable-users')
        .set('Authorization', `Bearer ${customToken()}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/work_orders\.view/);
      expect(called(isAssignableList)).toBe(false);
    } finally {
      permissionSpy.mockRestore();
    }
  });
});
