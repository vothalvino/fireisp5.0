# FireISP 5.0 — Database Test Suite

Comprehensive SQL-based tests for the FireISP 5.0 database schema, covering schema integrity, constraints, triggers, seed data, and referential integrity.

## Prerequisites

- **MySQL 8.0+** or **MariaDB 10.6+** running locally or remotely
- A **test database** created and schema applied:

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS fireisp_test;"
mysql -u root fireisp_test < database/schema.sql
```

## Running Tests

### Quick start

```bash
./tests/run_tests.sh -u root -d fireisp_test
```

### With environment variables

```bash
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=secret
export MYSQL_DATABASE=fireisp_test
./tests/run_tests.sh
```

### Run a single test file

```bash
mysql -u root fireisp_test < tests/test_triggers.sql
```

## Test Files

| File | Description | Test Count |
|------|-------------|------------|
| `test_helpers.sql` | Test framework: assertion procedures, result tracking, summary reporting | — |
| `test_schema_integrity.sql` | Verifies all tables, triggers, indexes, columns, and stored functions exist | ~120 |
| `test_seed_data.sql` | Validates seeded roles, permissions, settings, tax rates, scheduled tasks, and SAT catalogs | ~40 |
| `test_check_constraints.sql` | Exercises CHECK constraints (VLANs, network links, billing periods, promotions, files, etc.) | ~20 |
| `test_unique_constraints.sql` | Verifies UNIQUE constraints prevent duplicate entries across all key tables | ~15 |
| `test_referential_integrity.sql` | Tests FK ON DELETE RESTRICT/CASCADE/SET NULL behavior and orphan prevention | ~20 |
| `test_triggers.sql` | Exercises all 26 triggers with positive and negative cases | ~35 |

**Total: ~250 test assertions**

## Test Framework

The test framework (`test_helpers.sql`) provides these assertion procedures:

| Procedure | Description |
|-----------|-------------|
| `test_begin(suite_name)` | Start a named test suite |
| `assert_true(condition, description)` | Pass when condition is TRUE |
| `assert_equal(expected, actual, description)` | Pass when values match |
| `assert_row_count(table, where, expected, description)` | Pass when row count matches |
| `assert_table_exists(table_name, description)` | Pass when table exists |
| `assert_trigger_exists(trigger_name, description)` | Pass when trigger exists |
| `assert_column_exists(table, column, description)` | Pass when column exists |
| `assert_index_exists(table, index, description)` | Pass when index exists |
| `test_summary()` | Print pass/fail totals and list failures |

## Trigger Coverage

The trigger tests cover all database-enforced business rules:

- **MX Locale Enforcement** (16 triggers): Prevents creating MX-specific records for non-MX clients/organizations
- **Locale Downgrade Guards** (2 triggers): Prevents changing locale from 'MX' to 'global' when MX records exist
- **Factura Pública Stamping** (2 triggers): Prevents stamping a factura when linked invoices are unpaid
- **Facturar Guards** (2 triggers): Prevents `facturar=TRUE` for non-MX clients
- **Payment Allocation Guards** (4 triggers): Prevents over-allocating payments or invoices
- **Inventory Stock Guard** (1 trigger): Prevents negative stock quantity
- **RADIUS Consistency** (1 trigger): Requires RADIUS account for PPPoE contract activation

## Test Data Isolation

All tests use high-numbered IDs (6000–9999) to avoid conflicts with seeded data. Each test file cleans up its fixture data in the CLEANUP section. Tests can be run repeatedly without accumulating leftover data.

## CI Integration

Add to your CI pipeline:

```yaml
- name: Run database tests
  run: |
    mysql -u root -e "CREATE DATABASE IF NOT EXISTS fireisp_test;"
    mysql -u root fireisp_test < database/schema.sql
    ./tests/run_tests.sh -u root -d fireisp_test
```
