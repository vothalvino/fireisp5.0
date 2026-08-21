// =============================================================================
// FireISP 5.0 — Client Model Tests: duplicates, custom fields, merge (§1.1)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const Client = require('../src/models/Client');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.getConnection.mockReset();
});

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

describe('client id is permanently reserved (never reusable by another client)', () => {
  // The id is blocked to its client forever: soft-delete keeps the deleted row
  // (and its id), MySQL auto-increment never re-hands an id, and `id` is not
  // fillable so it cannot be claimed on create/import.
  test('clients are soft-deleted, so a deleted client keeps its id', () => {
    expect(Client.softDelete).toBe(true);
  });

  test('id is not mass-assignable (cannot be set/reused on create or import)', () => {
    expect(Client.fillable).not.toContain('id');
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
  function mergeConnection({ locked = [{ id: 10 }, { id: 20 }], failOn = null } = {}) {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(async (sql) => {
        if (failOn && failOn.test(sql)) throw new Error('boom');
        if (/SELECT id FROM clients/.test(sql)) return [locked];
        return [{ affectedRows: 1 }];
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);
    return conn;
  }

  test('rejects merging a client into itself', async () => {
    await expect(Client.merge(5, 5, 42)).rejects.toThrow(/itself/i);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('locks tenant-owned clients, unions source DND, withdraws unsafe consent, and commits', async () => {
    const conn = mergeConnection();

    const result = await Client.merge(10, 20, 42);

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(result.moved).toBeDefined();

    const [lockSql, lockParams] = conn.query.mock.calls[0];
    expect(lockSql).toMatch(/id IN \(\?, \?\)/);
    expect(lockSql).toMatch(/organization_id <=> \?/);
    expect(lockSql).toMatch(/deleted_at IS NULL[\s\S]*ORDER BY id FOR UPDATE/);
    expect(lockParams).toEqual([10, 20, 42]);

    const [dndSql, dndParams] = conn.query.mock.calls.find(([sql]) => (
      /INSERT INTO client_dnd_preferences/.test(sql)
    ));
    expect(dndSql).toMatch(/SELECT \?, \?, channel, 1/);
    expect(dndSql).toMatch(/client_id = \? AND organization_id <=> \? AND opt_out = 1/);
    expect(dndSql).toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*opt_out = 1/);
    expect(dndParams).toEqual([42, 20, 10, 42]);

    const [consentSql, consentParams] = conn.query.mock.calls.find(([sql]) => (
      /UPDATE subscriber_consents consent/.test(sql)
    ));
    expect(consentSql).toMatch(/purpose = 'marketing'/);
    expect(consentSql).toMatch(/consent\.client_id = \?/);
    expect(consentSql).toMatch(/dnd\.channel IN \('all', consent\.communication_channel\)/);
    expect(consentParams).toEqual([42, 10, 20, 20, 42]);

    const [deleteSql, deleteParams] = conn.query.mock.calls.at(-1);
    expect(deleteSql).toMatch(/UPDATE clients SET deleted_at = NOW\(\)/);
    expect(deleteSql).toMatch(/organization_id <=> \? AND deleted_at IS NULL/);
    expect(deleteParams).toEqual([10, 42]);
  });

  test('rolls back DND reconciliation atomically and never deletes source when it fails', async () => {
    const conn = mergeConnection({ failOn: /INSERT INTO client_dnd_preferences/ });

    await expect(Client.merge(10, 20, 42)).rejects.toThrow('boom');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE clients SET deleted_at/.test(sql))).toBe(false);
  });

  test('throws NotFoundError and rolls back when the source is not tenant-owned', async () => {
    const conn = mergeConnection({ locked: [{ id: 20 }] });

    await expect(Client.merge(10, 20, 42)).rejects.toMatchObject({ statusCode: 404 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
});
