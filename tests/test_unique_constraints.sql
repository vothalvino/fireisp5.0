-- =============================================================================
-- FireISP 5.0 — UNIQUE Constraint Tests
-- =============================================================================
-- Verifies that UNIQUE constraints prevent duplicate entries in key columns.
-- =============================================================================

SOURCE tests/test_helpers.sql;

SET @OLD_FK_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

CALL test_begin('UNIQUE Constraint Tests');

-- =========================================================================
-- Fixture data
-- =========================================================================
INSERT INTO organizations (id, name, locale, status) VALUES (7000, 'Unique Test Org', 'global', 'active');
INSERT INTO organizations (id, name, locale, status) VALUES (7001, 'Unique Test Org MX', 'MX', 'active');
INSERT INTO clients (id, organization_id, name, client_type, locale, status)
VALUES (7000, 7000, 'Unique Test Client', 'personal', 'global', 'active');
INSERT INTO sites (id, organization_id, name, site_type, status)
VALUES (7000, 7000, 'Unique Test POP', 'pop', 'active');
INSERT INTO plans (id, organization_id, name, download_speed, upload_speed, price, status)
VALUES (7000, 7000, 'Unique Test Plan', 50, 10, 299.00, 'active');

-- =========================================================================
-- A. users — uq_users_email
-- =========================================================================
INSERT INTO users (id, first_name, last_name, email, password_hash, role, status)
VALUES (7000, 'Test', 'User', 'unique-test@example.com', 'hash', 'admin', 'active');

CALL assert_sql_error(NULL, 'INSERT INTO users (id, first_name, last_name, email, password_hash, role, status) VALUES (7001, ''Dupe'', ''User'', ''unique-test@example.com'', ''hash'', ''admin'', ''active'')', 'A: Duplicate user email rejected');

-- =========================================================================
-- B. nas — uq_nas_ip_address
-- =========================================================================
INSERT INTO nas (id, name, ip_address, secret, type, status)
VALUES (7000, 'NAS-A', '172.16.0.1', 'secret1', 'other', 'active');

CALL assert_sql_error(NULL, 'INSERT INTO nas (id, name, ip_address, secret, type, status) VALUES (7001, ''NAS-B'', ''172.16.0.1'', ''secret2'', ''other'', ''active'')', 'B: Duplicate NAS IP address rejected');

-- =========================================================================
-- C. radius — uq_radius_username
-- =========================================================================
INSERT INTO radius (id, client_id, username, password_hash, status)
VALUES (7000, 7000, 'pppoe_unique_user', 'hash', 'active');

CALL assert_sql_error(NULL, 'INSERT INTO radius (id, client_id, username, password_hash, status) VALUES (7001, 7000, ''pppoe_unique_user'', ''hash2'', ''active'')', 'C: Duplicate RADIUS username rejected');

-- =========================================================================
-- D. devices — uq_devices_serial_number
-- =========================================================================
INSERT INTO devices (id, site_id, name, serial_number, category, type, status)
VALUES (7000, 7000, 'Router-A', 'SN-UNIQUE-001', 'pop', 'router', 'online');

CALL assert_sql_error(NULL, 'INSERT INTO devices (id, site_id, name, serial_number, category, type, status) VALUES (7001, 7000, ''Router-B'', ''SN-UNIQUE-001'', ''pop'', ''switch'', ''online'')', 'D: Duplicate device serial number rejected');

-- =========================================================================
-- E. invoices — uq_invoices_number
-- =========================================================================
INSERT INTO invoices (id, client_id, invoice_number, issue_date, due_date, total, status)
VALUES (7000, 7000, 'INV-UQ-001', '2024-01-01', '2024-01-31', 100.00, 'draft');

CALL assert_sql_error(NULL, 'INSERT INTO invoices (id, client_id, invoice_number, issue_date, due_date, total, status) VALUES (7001, 7000, ''INV-UQ-001'', ''2024-02-01'', ''2024-02-28'', 200.00, ''draft'')', 'E: Duplicate invoice number rejected');

-- =========================================================================
-- F. ip_assignments — uq_ip_assignments_ip
-- =========================================================================
INSERT INTO ip_pools (id, site_id, name, network, cidr, ip_version, total_addresses, status)
VALUES (7000, 7000, 'Pool-A', '10.0.0.0', 24, '4', 254, 'active');
INSERT INTO ip_assignments (id, pool_id, ip_address, client_id, type, status)
VALUES (7000, 7000, '10.0.0.1', 7000, 'static', 'active');

CALL assert_sql_error(NULL, 'INSERT INTO ip_assignments (id, pool_id, ip_address, client_id, type, status) VALUES (7001, 7000, ''10.0.0.1'', 7000, ''static'', ''active'')', 'F: Duplicate IP assignment rejected');

-- =========================================================================
-- G. vlans — uq_vlans_site_vlan (composite)
-- =========================================================================
INSERT INTO vlans (id, site_id, vlan_id, name, status) VALUES (7000, 7000, 100, 'VLAN-100', 'active');

CALL assert_sql_error(NULL, 'INSERT INTO vlans (id, site_id, vlan_id, name, status) VALUES (7001, 7000, 100, ''VLAN-100-dup'', ''active'')', 'G: Duplicate VLAN per site rejected');

-- =========================================================================
-- H. payment_allocations — uq_payment_allocations_payment_invoice
-- =========================================================================
INSERT INTO payments (id, client_id, amount, payment_date, payment_method)
VALUES (7000, 7000, 100.00, '2024-01-15', 'cash');
INSERT INTO payment_allocations (id, payment_id, invoice_id, amount) VALUES (7000, 7000, 7000, 50.00);

CALL assert_sql_error(NULL, 'INSERT INTO payment_allocations (id, payment_id, invoice_id, amount) VALUES (7001, 7000, 7000, 25.00)', 'H: Duplicate payment+invoice allocation rejected');

-- =========================================================================
-- I. settings — uq_settings_key
-- =========================================================================
INSERT INTO settings (id, setting_key, setting_value, description)
VALUES (7000, 'test_unique_key', 'value1', 'Test');

CALL assert_sql_error(NULL, 'INSERT INTO settings (id, setting_key, setting_value, description) VALUES (7001, ''test_unique_key'', ''value2'', ''Test'')', 'I: Duplicate settings key rejected');

-- =========================================================================
-- J. quotes — uq_quotes_number
-- =========================================================================
INSERT INTO quotes (id, client_id, quote_number, issue_date, total, status)
VALUES (7000, 7000, 'QT-UQ-001', '2024-01-01', 100.00, 'draft');

CALL assert_sql_error(NULL, 'INSERT INTO quotes (id, client_id, quote_number, issue_date, total, status) VALUES (7001, 7000, ''QT-UQ-001'', ''2024-02-01'', 200.00, ''draft'')', 'J: Duplicate quote number rejected');

-- =========================================================================
-- K. credit_notes — uq_credit_notes_number
-- =========================================================================
INSERT INTO credit_notes (id, client_id, credit_note_number, issue_date, subtotal, tax_amount, total, reason, status)
VALUES (7000, 7000, 'CN-UQ-001', '2024-01-01', 100.00, 0.00, 100.00, 'courtesy', 'draft');

CALL assert_sql_error(NULL, 'INSERT INTO credit_notes (id, client_id, credit_note_number, issue_date, subtotal, tax_amount, total, reason, status) VALUES (7001, 7000, ''CN-UQ-001'', ''2024-02-01'', 50.00, 0.00, 50.00, ''courtesy'', ''draft'')', 'K: Duplicate credit note number rejected');

-- =========================================================================
-- L. roles — uq_roles_name
-- =========================================================================
INSERT INTO roles (id, name, description) VALUES (7000, 'test_unique_role', 'Test');

CALL assert_sql_error(NULL, 'INSERT INTO roles (id, name, description) VALUES (7001, ''test_unique_role'', ''Dupe'')', 'L: Duplicate role name rejected');

-- =========================================================================
-- M. inventory_items — uq_inventory_items_sku
-- =========================================================================
INSERT INTO inventory_items (id, organization_id, name, sku, category, unit, status)
VALUES (7000, 7000, 'Item-A', 'SKU-UQ-001', 'router', 'unit', 'active');

CALL assert_sql_error(NULL, 'INSERT INTO inventory_items (id, organization_id, name, sku, category, unit, status) VALUES (7001, 7000, ''Item-B'', ''SKU-UQ-001'', ''switch'', ''unit'', ''active'')', 'M: Duplicate inventory item SKU rejected');

-- =========================================================================
-- N. api_tokens — uq_api_tokens_hash
-- =========================================================================
INSERT INTO api_tokens (id, user_id, name, token_hash, expires_at)
VALUES (7000, 7000, 'Token A', 'hash_unique_test_001', '2025-12-31 00:00:00');

CALL assert_sql_error(NULL, 'INSERT INTO api_tokens (id, user_id, name, token_hash, expires_at) VALUES (7001, 7000, ''Token B'', ''hash_unique_test_001'', ''2025-12-31 00:00:00'')', 'N: Duplicate API token hash rejected');

-- =========================================================================
-- CLEANUP
-- =========================================================================
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM api_tokens WHERE id IN (7000, 7001);
DELETE FROM inventory_items WHERE id IN (7000, 7001);
DELETE FROM roles WHERE id IN (7000, 7001);
DELETE FROM credit_notes WHERE id IN (7000, 7001);
DELETE FROM quotes WHERE id IN (7000, 7001);
DELETE FROM settings WHERE id IN (7000, 7001);
DELETE FROM payment_allocations WHERE id IN (7000, 7001);
DELETE FROM payments WHERE id = 7000;
DELETE FROM vlans WHERE id IN (7000, 7001);
DELETE FROM ip_assignments WHERE id IN (7000, 7001);
DELETE FROM ip_pools WHERE id = 7000;
DELETE FROM invoices WHERE id IN (7000, 7001);
DELETE FROM devices WHERE id IN (7000, 7001);
DELETE FROM radius WHERE id IN (7000, 7001);
DELETE FROM nas WHERE id IN (7000, 7001);
DELETE FROM users WHERE id IN (7000, 7001);
DELETE FROM clients WHERE id = 7000;
DELETE FROM sites WHERE id = 7000;
DELETE FROM plans WHERE id = 7000;
DELETE FROM organizations WHERE id IN (7000, 7001);

SET FOREIGN_KEY_CHECKS = @OLD_FK_CHECKS;

CALL test_summary();
