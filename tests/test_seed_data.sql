-- =============================================================================
-- FireISP 5.0 — Seed Data Verification Tests
-- =============================================================================
-- Verifies that all seeded data (roles, permissions, settings, tax rates,
-- scheduled tasks, SAT catalogs, SNMP profiles) is present and correct.
-- =============================================================================

SOURCE tests/test_helpers.sql;

CALL test_begin('Seed Data Tests');

-- =========================================================================
-- A. ROLES (migration 119)
-- =========================================================================
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM roles;
CALL assert_true(@cnt >= 5, 'A1: At least 5 default roles seeded');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM roles WHERE name = 'admin';
CALL assert_true(@cnt = 1, 'A2: Role "admin" exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM roles WHERE name = 'billing';
CALL assert_true(@cnt = 1, 'A3: Role "billing" exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM roles WHERE name = 'support';
CALL assert_true(@cnt = 1, 'A4: Role "support" exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM roles WHERE name = 'technician';
CALL assert_true(@cnt = 1, 'A5: Role "technician" exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM roles WHERE name = 'readonly';
CALL assert_true(@cnt = 1, 'A6: Role "readonly" exists');

-- =========================================================================
-- B. PERMISSIONS (migration 119)
-- =========================================================================
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM permissions;
CALL assert_true(@cnt >= 45, 'B1: At least 45 default permissions seeded');

-- Spot-check key permissions
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM permissions WHERE name = 'clients.create';
CALL assert_true(@cnt = 1, 'B2: Permission "clients.create" exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM permissions WHERE name = 'invoices.view';
CALL assert_true(@cnt = 1, 'B3: Permission "invoices.view" exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM permissions WHERE name = 'devices.delete';
CALL assert_true(@cnt = 1, 'B4: Permission "devices.delete" exists');

-- =========================================================================
-- C. ROLE_PERMISSIONS (migration 119)
-- =========================================================================
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM role_permissions;
CALL assert_true(@cnt > 0, 'C1: Role-permission mappings seeded');

-- Admin should have all permissions
SET @admin_perms = 0;
SET @total_perms = 0;
SELECT COUNT(*) INTO @total_perms FROM permissions;
SELECT COUNT(*) INTO @admin_perms FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
WHERE r.name = 'admin';
CALL assert_true(@admin_perms = @total_perms, 'C2: Admin role has all permissions');

-- Readonly should have fewer permissions than admin
SET @ro_perms = 0;
SELECT COUNT(*) INTO @ro_perms FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
WHERE r.name = 'readonly';
CALL assert_true(@ro_perms < @admin_perms, 'C3: Readonly role has fewer permissions than admin');

-- =========================================================================
-- D. SETTINGS (migration 120)
-- =========================================================================
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM settings;
CALL assert_true(@cnt >= 25, 'D1: At least 25 default settings seeded');

-- Spot-check key settings
SET @val = NULL;
SELECT setting_value INTO @val FROM settings WHERE setting_key = 'default_currency';
CALL assert_true(@val IS NOT NULL, 'D2: Setting "default_currency" exists');

SET @val = NULL;
SELECT setting_value INTO @val FROM settings WHERE setting_key = 'default_tax_rate';
CALL assert_true(@val IS NOT NULL, 'D3: Setting "default_tax_rate" exists');

SET @val = NULL;
SELECT setting_value INTO @val FROM settings WHERE setting_key = 'invoice_prefix';
CALL assert_true(@val IS NOT NULL, 'D4: Setting "invoice_prefix" exists');

SET @val = NULL;
SELECT setting_value INTO @val FROM settings WHERE setting_key = 'auto_suspend_enabled';
CALL assert_true(@val IS NOT NULL, 'D5: Setting "auto_suspend_enabled" exists');

-- =========================================================================
-- E. TAX RATES (migration 121)
-- =========================================================================
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM tax_rates;
CALL assert_true(@cnt >= 4, 'E1: At least 4 default tax rates seeded');

-- Spot-check specific tax rates
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM tax_rates WHERE name = 'Tax Exempt' AND rate = 0.0000;
CALL assert_true(@cnt = 1, 'E2: Tax Exempt (0%) rate exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM tax_rates WHERE name LIKE '%IVA%' AND rate = 0.1600;
CALL assert_true(@cnt = 1, 'E3: IVA 16% MX rate exists');

-- =========================================================================
-- F. SCHEDULED TASKS (migrations 100, 123)
-- =========================================================================
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM scheduled_tasks;
CALL assert_true(@cnt >= 5, 'F1: At least 5 scheduled tasks seeded');

-- Core automation tasks
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM scheduled_tasks WHERE task_name = 'auto_generate_invoices';
CALL assert_true(@cnt = 1, 'F2: auto_generate_invoices task exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM scheduled_tasks WHERE task_name = 'auto_suspend_overdue';
CALL assert_true(@cnt = 1, 'F3: auto_suspend_overdue task exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM scheduled_tasks WHERE task_name = 'radius_sync';
CALL assert_true(@cnt = 1, 'F4: radius_sync task exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM scheduled_tasks WHERE task_name = 'populate_revenue_summary';
CALL assert_true(@cnt = 1, 'F5: populate_revenue_summary task exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM scheduled_tasks WHERE task_name = 'populate_network_health_snapshots';
CALL assert_true(@cnt = 1, 'F6: populate_network_health_snapshots task exists');

-- CSD expiry monitor (migration 100)
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM scheduled_tasks WHERE task_name = 'csd_expiry_monitor';
CALL assert_true(@cnt = 1, 'F7: csd_expiry_monitor task exists');

-- =========================================================================
-- G. SUSPENSION RULES (migration 122)
-- =========================================================================
SET @has_org1 = 0;
SELECT COUNT(*) INTO @has_org1 FROM organizations WHERE id = 1;
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM suspension_rules;
CALL assert_true((@has_org1 = 1 AND @cnt >= 1) OR (@has_org1 = 0 AND @cnt = 0),
                 'G1: Default suspension rule seeded only when organization id=1 exists');

-- =========================================================================
-- H. SAT CATALOGS (migration 069)
-- =========================================================================
-- H1. sat_regimen_fiscal
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_regimen_fiscal;
CALL assert_true(@cnt >= 17, 'H1: At least 17 SAT régimen fiscal entries seeded');

-- H2. sat_uso_cfdi
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_uso_cfdi;
CALL assert_true(@cnt >= 18, 'H2: At least 18 SAT uso CFDI entries seeded');

-- H3. sat_forma_pago
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_forma_pago;
CALL assert_true(@cnt >= 22, 'H3: At least 22 SAT forma pago entries seeded');

-- H4. sat_metodo_pago
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_metodo_pago;
CALL assert_true(@cnt >= 2, 'H4: At least 2 SAT método pago entries seeded');

-- Spot-check: PUE and PPD
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_metodo_pago WHERE code = 'PUE';
CALL assert_true(@cnt = 1, 'H5: SAT método pago PUE exists');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_metodo_pago WHERE code = 'PPD';
CALL assert_true(@cnt = 1, 'H6: SAT método pago PPD exists');

-- H7. sat_tipo_comprobante
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_tipo_comprobante;
CALL assert_true(@cnt >= 5, 'H7: At least 5 SAT tipo comprobante entries seeded');

-- H8. sat_moneda
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_moneda;
CALL assert_true(@cnt >= 4, 'H8: At least 4 SAT moneda entries seeded');

-- Spot-check MXN
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_moneda WHERE code = 'MXN';
CALL assert_true(@cnt = 1, 'H9: SAT moneda MXN exists');

-- =========================================================================
-- I. SAT CLAVE PROD SERV & CLAVE UNIDAD (migration 082)
-- =========================================================================
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_clave_prod_serv;
CALL assert_true(@cnt >= 7, 'I1: At least 7 SAT clave prod serv entries seeded');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_clave_unidad;
CALL assert_true(@cnt >= 6, 'I2: At least 6 SAT clave unidad entries seeded');

-- Spot-check common ISP service code
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_clave_prod_serv WHERE code = '81161700';
CALL assert_true(@cnt = 1, 'I3: SAT clave prod serv 81161700 (telecom services) exists');

-- Spot-check E48 (unit of service)
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM sat_clave_unidad WHERE code = 'E48';
CALL assert_true(@cnt = 1, 'I4: SAT clave unidad E48 (Unidad de Servicio) exists');

-- =========================================================================
-- J. SNMP PROFILES (schema.sql embedded seeds)
-- =========================================================================
SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM snmp_profiles;
CALL assert_true(@cnt >= 1, 'J1: At least 1 SNMP profile seeded');

SET @cnt = 0;
SELECT COUNT(*) INTO @cnt FROM snmp_profile_oids;
CALL assert_true(@cnt >= 1, 'J2: At least 1 SNMP profile OID seeded');

CALL test_summary();
