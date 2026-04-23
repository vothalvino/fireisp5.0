const { extractTableNames, extractSchemaColumns } = require('../src/scripts/migration-smoke-test');

describe('migration-smoke-test — extractTableNames', () => {
  it('extracts simple CREATE TABLE names', () => {
    const sql = `
      CREATE TABLE users ( id INT );
      CREATE TABLE clients ( id INT );
    `;
    const names = extractTableNames(sql);
    expect(names).toEqual(new Set(['users', 'clients']));
  });

  it('handles IF NOT EXISTS syntax', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS invoices ( id INT );';
    expect(extractTableNames(sql)).toEqual(new Set(['invoices']));
  });

  it('handles backtick-quoted names', () => {
    const sql = 'CREATE TABLE `payment_allocations` ( id INT );';
    expect(extractTableNames(sql)).toEqual(new Set(['payment_allocations']));
  });

  it('is case-insensitive', () => {
    const sql = `
      create table Foo ( id INT );
      CREATE TABLE BAR ( id INT );
    `;
    const names = extractTableNames(sql);
    expect(names).toEqual(new Set(['foo', 'bar']));
  });

  it('returns empty set for SQL without CREATE TABLE', () => {
    const sql = 'INSERT INTO users VALUES (1);';
    expect(extractTableNames(sql)).toEqual(new Set());
  });

  it('deduplicates repeated table names', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS users ( id INT );
      CREATE TABLE IF NOT EXISTS users ( id INT );
    `;
    expect(extractTableNames(sql)).toEqual(new Set(['users']));
  });
});

describe('migration-smoke-test — extractSchemaColumns', () => {
  it('extracts only true columns and skips key/index/constraint lines', () => {
    const sql = `
      CREATE TABLE test_table (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        location POLYGON NOT NULL /*!80003 SRID 4326 */,
        PRIMARY KEY (id),
        UNIQUE KEY uq_name (name),
        KEY idx_name (name),
        INDEX idx_location (location),
        SPATIAL KEY spx_location (location),
        CONSTRAINT fk_test_org FOREIGN KEY (id) REFERENCES organizations (id),
        FOREIGN KEY (name) REFERENCES names (value)
      ) ENGINE=InnoDB;
    `;

    const cols = extractSchemaColumns(sql);
    expect(cols.get('test_table')).toEqual(new Set(['id', 'name', 'location']));
  });
});
