// =============================================================================
// FireISP 5.0 — ClientGroup model: addMembers / removeMember
// =============================================================================
jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const db = require('../src/config/database');
const ClientGroup = require('../src/models/ClientGroup');

beforeEach(() => jest.clearAllMocks());

describe('ClientGroup.addMembers', () => {
  it('assigns clients org-scoped and EXCLUDES clients already in this group (no double-add)', async () => {
    db.query.mockResolvedValue([{ affectedRows: 2 }]);
    const added = await ClientGroup.addMembers(5, [7, 8, 7], 1); // 7 duplicated in input
    expect(added).toBe(2);
    const [sql, params] = db.query.mock.calls[0];
    // Dedup guard: only move rows not already in this group.
    expect(sql).toMatch(/client_group_id IS NULL OR client_group_id <> \?/);
    expect(sql).toMatch(/organization_id = \?/);
    // De-duplicated ids (7,8), org, and groupId appears as target AND in the guard.
    expect(params[0]).toBe(5);            // SET client_group_id = groupId
    expect(params).toContain(1);          // org
    expect(params[params.length - 1]).toBe(5); // guard groupId
    expect(params.filter((p) => p === 7)).toHaveLength(1); // input dedup
  });

  it('clears the moved clients as primary of any OTHER group (no orphaned primary)', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    await ClientGroup.addMembers(5, [7, 8], 1);
    // Second query nulls primary_client_id on other groups pointing at moved ids.
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE client_groups SET primary_client_id = NULL/);
    expect(sql).toMatch(/id <> \?/);
    expect(sql).toMatch(/primary_client_id IN/);
    expect(params).toEqual([1, 5, 7, 8]); // org, thisGroup, ...movedIds
  });

  it('is a no-op for an empty id list', async () => {
    const added = await ClientGroup.addMembers(5, [], 1);
    expect(added).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('ClientGroup.removeMember', () => {
  it('clears the client group link and clears primary when it was the primary', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE clients
      .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE client_groups primary
    const removed = await ClientGroup.removeMember(5, 7, 1);
    expect(removed).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE client_groups SET primary_client_id = NULL/);
    expect(db.query.mock.calls[1][0]).toMatch(/primary_client_id = \?/);
  });

  it('returns false and does not touch the group when the client is not a member', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const removed = await ClientGroup.removeMember(5, 999, 1);
    expect(removed).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1); // no primary-clear query
  });
});
