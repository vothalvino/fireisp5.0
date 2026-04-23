-- =============================================================================
-- FireISP 5.0 — CHECK Constraint Tests
-- =============================================================================
-- Exercises every CHECK constraint with both valid and invalid values.
-- =============================================================================

SOURCE tests/test_helpers.sql;

SET @OLD_FK_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

CALL test_begin('CHECK Constraint Tests');

-- =========================================================================
-- Fixture data
-- =========================================================================
INSERT INTO organizations (id, name, locale, status) VALUES (8000, 'Check Test Org', 'global', 'active');
INSERT INTO clients (id, organization_id, name, client_type, locale, status)
VALUES (8000, 8000, 'Check Test Client', 'personal', 'MX', 'active');
INSERT INTO sites (id, organization_id, name, site_type, status)
VALUES (8000, 8000, 'Check Test POP', 'pop', 'active');
INSERT INTO plans (id, organization_id, name, download_speed, upload_speed, price, status)
VALUES (8000, 8000, 'Check Test Plan', 50, 10, 299.00, 'active');

-- =========================================================================
-- A. vlans — chk_vlans_vlan_id: BETWEEN 1 AND 4094
-- =========================================================================
-- A1. Valid VLAN ID (1)
INSERT INTO vlans (id, site_id, vlan_id, name, status) VALUES (8000, 8000, 1, 'VLAN-1', 'active');
CALL assert_true(ROW_COUNT() = 1, 'A1: VLAN ID 1 accepted (min valid)');

-- A2. Valid VLAN ID (4094)
INSERT INTO vlans (id, site_id, vlan_id, name, status) VALUES (8001, 8000, 4094, 'VLAN-4094', 'active');
CALL assert_true(ROW_COUNT() = 1, 'A2: VLAN ID 4094 accepted (max valid)');

-- A3. Invalid VLAN ID (0)
CALL assert_sql_error(NULL, 'INSERT INTO vlans (id, site_id, vlan_id, name, status) VALUES (8002, 8000, 0, ''VLAN-0'', ''active'')', 'A3: VLAN ID 0 rejected (below min)');

-- A4. Invalid VLAN ID (4095)
CALL assert_sql_error(NULL, 'INSERT INTO vlans (id, site_id, vlan_id, name, status) VALUES (8003, 8000, 4095, ''VLAN-4095'', ''active'')', 'A4: VLAN ID 4095 rejected (above max)');

-- =========================================================================
-- B. network_links — chk_network_links_different_devices
-- =========================================================================
INSERT INTO devices (id, site_id, name, serial_number, category, type, status)
VALUES (8000, 8000, 'Device A', 'SN-CHK-A', 'pop', 'router', 'online');
INSERT INTO devices (id, site_id, name, serial_number, category, type, status)
VALUES (8001, 8000, 'Device B', 'SN-CHK-B', 'pop', 'switch', 'online');

-- B1. Different devices — should succeed
INSERT INTO network_links (id, device_a_id, device_b_id, link_type, status)
VALUES (8000, 8000, 8001, 'fiber', 'active');
CALL assert_true(ROW_COUNT() = 1, 'B1: Network link between different devices accepted');

-- B2. Same device — should fail
CALL assert_sql_error(NULL, 'INSERT INTO network_links (id, device_a_id, device_b_id, link_type, status) VALUES (8001, 8000, 8000, ''fiber'', ''active'')', 'B2: Network link self-loop rejected');

-- =========================================================================
-- C. billing_periods — chk_billing_periods_invoiced
-- =========================================================================
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, status)
VALUES (8000, 8000, 8000, '2024-01-01', 'static', 'pending');

-- C1. Status 'pending', no invoice_id — should succeed
INSERT INTO billing_periods (id, contract_id, period_start, period_end, scheduled_at, status)
VALUES (8000, 8000, '2024-01-01', '2024-01-31', '2024-01-01 00:00:00', 'pending');
CALL assert_true(ROW_COUNT() = 1, 'C1: Billing period pending without invoice_id accepted');

-- C2. Status 'invoiced' without invoice_id — should fail
CALL assert_sql_error(NULL, 'INSERT INTO billing_periods (id, contract_id, period_start, period_end, scheduled_at, status, invoice_id) VALUES (8001, 8000, ''2024-02-01'', ''2024-02-29'', ''2024-02-01 00:00:00'', ''invoiced'', NULL)', 'C2: Billing period invoiced without invoice_id rejected');

-- C3. Status 'invoiced' with invoice_id — should succeed
INSERT INTO invoices (id, client_id, invoice_number, issue_date, due_date, total, status)
VALUES (8000, 8000, 'INV-CHK-001', '2024-02-01', '2024-02-28', 100.00, 'sent');
INSERT INTO billing_periods (id, contract_id, period_start, period_end, scheduled_at, status, invoice_id)
VALUES (8001, 8000, '2024-02-01', '2024-02-29', '2024-02-01 00:00:00', 'invoiced', 8000);
CALL assert_true(ROW_COUNT() = 1, 'C3: Billing period invoiced with invoice_id accepted');

-- =========================================================================
-- D. promotions — chk_promotions_discount_value > 0
-- =========================================================================
-- D1. Positive discount — should succeed
INSERT INTO promotions (id, organization_id, name, code, discount_type, discount_value, status)
VALUES (8000, 8000, 'Test Promo', 'TESTPROMO', 'percentage', 10.00, 'active');
CALL assert_true(ROW_COUNT() = 1, 'D1: Promotion with positive discount accepted');

-- D2. Zero discount — should fail
CALL assert_sql_error(NULL, 'INSERT INTO promotions (id, organization_id, name, code, discount_type, discount_value, status) VALUES (8001, 8000, ''Bad Promo'', ''BADPROMO'', ''percentage'', 0, ''active'')', 'D2: Promotion with zero discount rejected');

-- D3. Negative discount — should fail
CALL assert_sql_error(NULL, 'INSERT INTO promotions (id, organization_id, name, code, discount_type, discount_value, status) VALUES (8002, 8000, ''Neg Promo'', ''NEGPROMO'', ''percentage'', -5.00, ''active'')', 'D3: Promotion with negative discount rejected');

-- =========================================================================
-- E. promotions — chk_promotions_ends_after_starts
-- =========================================================================
-- E1. ends_at > starts_at — should succeed
INSERT INTO promotions (id, organization_id, name, code, discount_type, discount_value, starts_at, ends_at, status)
VALUES (8003, 8000, 'Dated Promo', 'DATEDPROMO', 'fixed_amount', 50.00, '2024-01-01', '2024-12-31', 'active');
CALL assert_true(ROW_COUNT() = 1, 'E1: Promotion ends_at > starts_at accepted');

-- E2. ends_at < starts_at — should fail
CALL assert_sql_error(NULL, 'INSERT INTO promotions (id, organization_id, name, code, discount_type, discount_value, starts_at, ends_at, status) VALUES (8004, 8000, ''Bad Dates'', ''BADDATES'', ''fixed_amount'', 50.00, ''2024-12-31'', ''2024-01-01'', ''active'')', 'E2: Promotion ends_at < starts_at rejected');

-- =========================================================================
-- F. files — chk_files_entity_id and chk_files_category_match
-- =========================================================================
INSERT INTO users (id, first_name, last_name, email, password_hash, role, status)
VALUES (8000, 'Test', 'User', 'checktest@test.com', 'hash', 'admin', 'active');

-- F1. Valid device file — should succeed
INSERT INTO files (id, entity_type, entity_id, category, file_name, file_path, file_size, mime_type, uploaded_by)
VALUES (8000, 'device', 8000, 'device_history', 'test.log', '/devices/test.log', 1024, 'text/plain', 8000);
CALL assert_true(ROW_COUNT() = 1, 'F1: Device file with device_history category accepted');

-- F2. Invalid category for entity_type — device with client_file should fail
CALL assert_sql_error(NULL, 'INSERT INTO files (id, entity_type, entity_id, category, file_name, file_path, file_size, mime_type, uploaded_by) VALUES (8001, ''device'', 8000, ''client_file'', ''bad.log'', ''/devices/bad.log'', 1024, ''text/plain'', 8000)', 'F2: Device with client_file category rejected');

-- F3. Non-backup entity_type with NULL entity_id — should fail
CALL assert_sql_error(NULL, 'INSERT INTO files (id, entity_type, entity_id, category, file_name, file_path, file_size, mime_type, uploaded_by) VALUES (8002, ''client'', NULL, ''client_file'', ''null.log'', ''/clients/null.log'', 1024, ''text/plain'', 8000)', 'F3: Non-backup entity_type with NULL entity_id rejected');

-- F4. Backup entity with NULL entity_id — should succeed
INSERT INTO files (id, entity_type, entity_id, category, file_name, file_path, file_size, mime_type, uploaded_by)
VALUES (8003, 'backup', NULL, 'backup', 'backup.tar.gz', '/backups/backup.tar.gz', 1048576, 'application/gzip', 8000);
CALL assert_true(ROW_COUNT() = 1, 'F4: Backup entity with NULL entity_id accepted');

-- =========================================================================
-- G. scheduled_tasks — chk_scheduled_tasks_retry: retry_count <= max_retries
-- =========================================================================
-- G1. retry_count = max_retries — should succeed
INSERT INTO scheduled_tasks (id, task_name, task_type, cron_expression, priority, retry_count, max_retries, is_enabled)
VALUES (8000, 'chk_test_task', 'cleanup', '0 0 * * *', 'normal', 3, 3, TRUE);
CALL assert_true(ROW_COUNT() = 1, 'G1: Scheduled task retry_count = max_retries accepted');

-- G2. retry_count > max_retries — should fail
CALL assert_sql_error(NULL, 'INSERT INTO scheduled_tasks (id, task_name, task_type, cron_expression, priority, retry_count, max_retries, is_enabled) VALUES (8001, ''chk_bad_task'', ''cleanup'', ''0 0 * * *'', ''normal'', 5, 3, TRUE)', 'G2: Scheduled task retry_count > max_retries rejected');

-- =========================================================================
-- H. ift_statistical_reports — chk_ift_statistical_reports_period
-- =========================================================================
INSERT INTO organizations (id, name, locale, status) VALUES (8001, 'MX Check Org', 'MX', 'active');

-- H1. Valid period (end >= start) — should succeed
INSERT INTO ift_statistical_reports (id, organization_id, report_period, period_start, period_end, status)
VALUES (8000, 8001, 'CHK-2024-Q1', '2024-01-01', '2024-03-31', 'draft');
CALL assert_true(ROW_COUNT() = 1, 'H1: IFT report period_end >= period_start accepted');

-- H2. Invalid period (end < start) — should fail
CALL assert_sql_error(NULL, 'INSERT INTO ift_statistical_reports (id, organization_id, report_period, period_start, period_end, status) VALUES (8001, 8001, ''CHK-2024-Q2'', ''2024-06-30'', ''2024-04-01'', ''draft'')', 'H2: IFT report period_end < period_start rejected');

-- =========================================================================
-- CLEANUP
-- =========================================================================
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM files WHERE id IN (8000, 8001, 8002, 8003);
DELETE FROM users WHERE id = 8000;
DELETE FROM network_links WHERE id IN (8000, 8001);
DELETE FROM devices WHERE id IN (8000, 8001);
DELETE FROM billing_periods WHERE id IN (8000, 8001);
DELETE FROM invoices WHERE id = 8000;
DELETE FROM contracts WHERE id = 8000;
DELETE FROM vlans WHERE id IN (8000, 8001, 8002, 8003);
DELETE FROM promotions WHERE id IN (8000, 8001, 8002, 8003, 8004);
DELETE FROM scheduled_tasks WHERE id IN (8000, 8001);
DELETE FROM ift_statistical_reports WHERE id IN (8000, 8001);
DELETE FROM clients WHERE id = 8000;
DELETE FROM sites WHERE id = 8000;
DELETE FROM plans WHERE id = 8000;
DELETE FROM organizations WHERE id IN (8000, 8001);

SET FOREIGN_KEY_CHECKS = @OLD_FK_CHECKS;

CALL test_summary();
