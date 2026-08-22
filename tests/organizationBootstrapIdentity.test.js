'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const db = require('../src/config/database');
const Organization = require('../src/models/Organization');

describe('organization bootstrap identity allocation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('allocates id=1 to the first real organization even after demo id=100 advanced AUTO_INCREMENT', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 1, name: 'First Real ISP' }]]);

    await expect(Organization.create({ name: 'First Real ISP' })).resolves.toMatchObject({ id: 1 });
    expect(db.query.mock.calls[1][0]).toMatch(/INSERT INTO organizations \(id,/);
    expect(db.query.mock.calls[1][0]).toMatch(/VALUES \(1,/);
  });

  test('uses ordinary AUTO_INCREMENT after id=1 has been allocated', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1 }]])
      .mockResolvedValueOnce([{ insertId: 101, affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 101, name: 'Second Real ISP' }]]);

    await expect(Organization.create({ name: 'Second Real ISP' })).resolves.toMatchObject({ id: 101 });
    expect(db.query.mock.calls[1][0]).not.toMatch(/\(id,/);
  });

  test('a concurrent id=1 creator falls back to ordinary AUTO_INCREMENT', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    db.query
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce([{ insertId: 101, affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 101, name: 'Concurrent ISP' }]]);

    await expect(Organization.create({ name: 'Concurrent ISP' })).resolves.toMatchObject({ id: 101 });
  });
});
