'use strict';

const mockExecute = jest.fn();
const mockRelease = jest.fn();
const mockEnd = jest.fn();

jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(() => ({
    getConnection: jest.fn(async () => ({ execute: mockExecute, release: mockRelease })),
    end: mockEnd,
  })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'bcrypt-hash') }));
jest.mock('../src/config/database', () => ({
  baseConnectionConfig: {},
  close: jest.fn(),
}));
jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { seed, DEMO_ORGANIZATION_ID } = require('../src/scripts/seed');

function tenantInsertCalls() {
  return mockExecute.mock.calls.filter(([sql]) =>
    /INSERT IGNORE INTO (organizations|users|organization_users|sites|plans|clients|contracts|devices|nas|tickets)/.test(sql));
}

describe('Demo ISP seed organization identity', () => {
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_PASSWORD = 'Test-Admin-Password-123!';
  });

  afterAll(() => {
    if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  test('a fresh database seeds the complete demo tenant under id=100', async () => {
    mockExecute.mockImplementation(async (sql) => (
      /SELECT id FROM organizations/.test(sql) ? [[]] : [{ affectedRows: 1 }]
    ));

    await seed();

    expect(DEMO_ORGANIZATION_ID).toBe(100);
    const inserts = tenantInsertCalls();
    expect(inserts).toHaveLength(10);
    for (const [, params = []] of inserts) {
      expect(params.filter(value => Number(value) === 100).length).toBeGreaterThan(0);
      expect(params).not.toContain(1);
    }
  });

  test('rerunning against a legacy id=1 Demo ISP does not create a duplicate id=100 tenant', async () => {
    mockExecute.mockImplementation(async (sql) => (
      /SELECT id FROM organizations/.test(sql) ? [[{ id: 1 }]] : [{ affectedRows: 1 }]
    ));

    await seed();

    const organizationInsert = tenantInsertCalls()[0];
    expect(organizationInsert[1]).toEqual([1]);
    expect(tenantInsertCalls().some(([, params = []]) => params.includes(100))).toBe(false);
  });
});
