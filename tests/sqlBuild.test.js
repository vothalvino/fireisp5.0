// =============================================================================
// FireISP 5.0 — sqlBuild helper tests
// =============================================================================

const { buildInsert, buildUpdate, quoteIdent } = require('../src/utils/sqlBuild');

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

describe('sqlBuild.quoteIdent', () => {
  test('quotes valid identifiers and rejects the rest', () => {
    expect(quoteIdent('col_1')).toBe('`col_1`');
    expect(() => quoteIdent('1col')).toThrow();
    expect(() => quoteIdent('')).toThrow();
    expect(() => quoteIdent(null)).toThrow();
  });
});
