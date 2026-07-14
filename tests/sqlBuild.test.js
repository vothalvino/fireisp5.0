// =============================================================================
// FireISP 5.0 — sqlBuild helper tests
// =============================================================================

const { buildInsert, buildUpdate, buildBulkValues, quoteIdent } = require('../src/utils/sqlBuild');

describe('sqlBuild.buildInsert', () => {
  test('produces quoted columns, matching placeholders, ordered values', () => {
    const { columns, placeholders, values } = buildInsert({ organization_id: 1, name: 'r1', vlan: 10 });
    expect(columns).toBe('`organization_id`, `name`, `vlan`');
    expect(placeholders).toBe('?, ?, ?');
    expect(values).toEqual([1, 'r1', 10]);
  });

  test('JSON-stringifies object/array values (JSON columns)', () => {
    const { values } = buildInsert({ name: 'x', options: { a: 1 }, tags: ['t'] });
    expect(values).toEqual(['x', JSON.stringify({ a: 1 }), JSON.stringify(['t'])]);
  });

  test('passes Date instances through as-is (mysql2 execute() binds Date natively; must not JSON.stringify it)', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const { values } = buildInsert({ created_at: when });
    expect(values).toEqual([when]);
  });

  test('throws on empty object and on unsafe identifiers (SQLi guard)', () => {
    expect(() => buildInsert({})).toThrow(/no columns/);
    expect(() => buildInsert({ 'x`=1;--': 1 })).toThrow(/Unsafe SQL identifier/);
    expect(() => buildInsert({ 'a b': 1 })).toThrow(/Unsafe SQL identifier/);
  });
});

describe('sqlBuild.buildUpdate', () => {
  test('produces a parameterised assignment clause', () => {
    const { assignments, values } = buildUpdate({ name: 'new', vlan: 20 });
    expect(assignments).toBe('`name` = ?, `vlan` = ?');
    expect(values).toEqual(['new', 20]);
  });

  test('empty object yields empty assignments so callers can fall back', () => {
    const { assignments, values } = buildUpdate({});
    expect(assignments).toBe('');
    expect(values).toEqual([]);
  });

  test('coerces undefined to null and rejects unsafe identifiers', () => {
    expect(buildUpdate({ a: undefined }).values).toEqual([null]);
    expect(() => buildUpdate({ '`drop`': 1 })).toThrow(/Unsafe SQL identifier/);
  });
});

describe('sqlBuild.buildBulkValues', () => {
  test('expands N rows x M cols into per-row placeholder groups and a flat param array', () => {
    const rows = [
      [1, 'a', 10],
      [2, 'b', 20],
      [3, 'c', 30],
    ];
    const { placeholders, values } = buildBulkValues(rows);
    expect(placeholders).toBe('(?, ?, ?), (?, ?, ?), (?, ?, ?)');
    expect(values).toEqual([1, 'a', 10, 2, 'b', 20, 3, 'c', 30]);
  });

  test('single row produces one placeholder group with no trailing comma', () => {
    const { placeholders, values } = buildBulkValues([[1, 'solo']]);
    expect(placeholders).toBe('(?, ?)');
    expect(values).toEqual([1, 'solo']);
  });

  test('empty/absent rows is a no-op — no SQL, no params', () => {
    expect(buildBulkValues([])).toEqual({ placeholders: '', values: [] });
    expect(buildBulkValues(null)).toEqual({ placeholders: '', values: [] });
    expect(buildBulkValues(undefined)).toEqual({ placeholders: '', values: [] });
  });

  test('JSON-stringifies object/array values per row (JSON columns), mirroring buildInsert', () => {
    const { values } = buildBulkValues([[1, { a: 1 }], [2, ['t']]]);
    expect(values).toEqual([1, JSON.stringify({ a: 1 }), 2, JSON.stringify(['t'])]);
  });

  test('coerces undefined values to null within a row', () => {
    const { values } = buildBulkValues([[1, undefined, 3]]);
    expect(values).toEqual([1, null, 3]);
  });

  test('passes Date instances through as-is within a row (mysql2 execute() binds Date natively)', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const { values } = buildBulkValues([[1, when]]);
    expect(values).toEqual([1, when]);
  });

  test('throws when a row length does not match the first row (dynamic/misshapen rows)', () => {
    expect(() => buildBulkValues([[1, 2], [1, 2, 3]])).toThrow(/row length/);
    expect(() => buildBulkValues([[1, 2], 'not-an-array'])).toThrow(/row length/);
  });
});

describe('sqlBuild.quoteIdent', () => {
  test('quotes valid identifiers and rejects the rest', () => {
    expect(quoteIdent('col_1')).toBe('`col_1`');
    expect(() => quoteIdent('1col')).toThrow();
    expect(() => quoteIdent('')).toThrow();
    expect(() => quoteIdent(null)).toThrow();
  });
});
