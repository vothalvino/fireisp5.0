// =============================================================================
// FireISP 5.0 — Client Model Tests: duplicates, custom fields, merge (§1.1)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const Client = require('../src/models/Client');

beforeEach(() => jest.clearAllMocks());

describe('Client.findDuplicates', () => {
  test('returns [] and runs no query when no criteria provided', async () => {
    const result = await Client.findDuplicates({ orgId: 42 });
    expect(result).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('matches by email/phone/tax_id and scopes by org + excludeId', async () => {
    db.query.mockResolvedValue([[{ id: 2, name: 'Dup' }]]);
    const result = await Client.findDuplicates({
      email: 'a@b.com', phone: '555', tax_id: 'XAXX', excludeId: 5, orgId: 42,
    });
    expect(result).toEqual([{ id: 2, name: 'Dup' }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/email = \?/);
    expect(sql).toMatch(/phone = \?/);
    expect(sql).toMatch(/tax_id = \?/);
    expect(sql).toMatch(/organization_id = \?/);
    expect(sql).toMatch(/id <> \?/);
    expect(params).toEqual(['a@b.com', '555', 'XAXX', 42, 5]);
  });
});

describe('Client.setCustomField / deleteCustomField', () => {
  test('upserts a custom field and returns the stored row', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }]) // INSERT ... ON DUPLICATE KEY UPDATE
      .mockResolvedValueOnce([[{ id: 1, field_key: 'gate_code', field_value: '1234' }]]); // SELECT
    const row = await Client.setCustomField(7, 'gate_code', '1234');
    expect(row).toEqual({ id: 1, field_key: 'gate_code', field_value: '1234' });
    expect(db.query.mock.calls[0][0]).toMatch(/INSERT INTO client_custom_fields/);
  });

  test('deleteCustomField returns true when a row is removed', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    await expect(Client.deleteCustomField(7, 'gate_code')).resolves.toBe(true);
  });

  test('deleteCustomField returns false when nothing matched', async () => {
    db.query.mockResolvedValue([{ affectedRows: 0 }]);
    await expect(Client.deleteCustomField(7, 'missing')).resolves.toBe(false);
  });
});

describe('Client.merge', () => {
  test('rejects merging a client into itself', async () => {
    await expect(Client.merge(5, 5, 42)).rejects.toThrow(/itself/i);
  });

  test('reassigns records and commits in a transaction', async () => {
    // findById(source) then findById(target)
    db.query
      .mockResolvedValueOnce([[{ id: 10, name: 'Source' }]])
      .mockResolvedValueOnce([[{ id: 20, name: 'Target' }]]);

    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);

    const result = await Client.merge(10, 20, 42);

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(result.moved).toBeDefined();
    // The final statement soft-deletes the source client.
    const lastSql = conn.query.mock.calls.at(-1)[0];
    expect(lastSql).toMatch(/UPDATE clients SET deleted_at/);
  });

  test('rolls back and rethrows when a reassignment fails', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 10 }]])
      .mockResolvedValueOnce([[{ id: 20 }]]);
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockRejectedValue(new Error('boom')),
      commit: jest.fn(),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);

    await expect(Client.merge(10, 20, 42)).rejects.toThrow('boom');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  test('throws NotFoundError when the source client does not exist', async () => {
    db.query.mockResolvedValueOnce([[]]); // findById(source) -> none
    await expect(Client.merge(10, 20, 42)).rejects.toMatchObject({ statusCode: 404 });
  });
});
