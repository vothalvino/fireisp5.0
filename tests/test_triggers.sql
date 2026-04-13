-- =============================================================================
-- FireISP 5.0 — Trigger Tests
-- =============================================================================
-- Exercises every database trigger with both positive (should succeed) and
-- negative (should raise SQLSTATE 45000) cases.
--
-- Prerequisites: schema applied, test_helpers.sql loaded.
-- Each test section creates minimal fixture data, runs the test, and cleans up.
-- =============================================================================

SOURCE tests/test_helpers.sql;

-- Disable FK checks during fixture setup only where needed
SET @OLD_FK_CHECKS = @@FOREIGN_KEY_CHECKS;

CALL test_begin('Trigger Tests');

-- =========================================================================
-- FIXTURE DATA — shared across multiple test sections
-- =========================================================================

-- Organization (global)
INSERT INTO organizations (id, name, locale, status) VALUES (9000, 'Test ISP Global', 'global', 'active');
-- Organization (MX)
INSERT INTO organizations (id, name, locale, status) VALUES (9001, 'Test ISP MX', 'MX', 'active');

-- Client (global)
INSERT INTO clients (id, organization_id, name, client_type, locale, status)
VALUES (9000, 9000, 'Global Client', 'personal', 'global', 'active');

-- Client (MX)
INSERT INTO clients (id, organization_id, name, client_type, locale, status)
VALUES (9001, 9001, 'MX Client', 'personal', 'MX', 'active');

-- Plan
INSERT INTO plans (id, organization_id, name, download_speed, upload_speed, price, status)
VALUES (9000, 9000, 'Test Plan 50M', 50, 10, 499.00, 'active');

-- Site
INSERT INTO sites (id, organization_id, name, site_type, status)
VALUES (9000, 9000, 'Test POP', 'pop', 'active');

-- =========================================================================
-- A. MX LOCALE ENFORCEMENT TRIGGERS (migration 087)
-- =========================================================================

-- A1. client_mx_profiles — INSERT for MX client should succeed
INSERT INTO client_mx_profiles (id, client_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal)
VALUES (9000, 9001, 'XAXX010101000', 'MX Client SA', '601', '06600');
CALL assert_true(ROW_COUNT() = 1, 'A1: client_mx_profiles INSERT succeeds for MX client');

-- A2. client_mx_profiles — INSERT for global client should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO client_mx_profiles (id, client_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal)
    VALUES (9001, 9000, 'TEST990101AAA', 'Global Client SA', '601', '06600');
END;
CALL assert_true(@trg_err = 1, 'A2: client_mx_profiles INSERT rejected for global client');

-- A3. organization_mx_profiles — INSERT for MX org should succeed
INSERT INTO organization_mx_profiles (id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
                                      cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago, cfdi_folio_next)
VALUES (9000, 9001, 'ORG990101AAA', 'MX ISP SA', '601', '06600', 'A', 'E', 'P', 1);
CALL assert_true(ROW_COUNT() = 1, 'A3: organization_mx_profiles INSERT succeeds for MX org');

-- A4. organization_mx_profiles — INSERT for global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO organization_mx_profiles (id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
                                          cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago, cfdi_folio_next)
    VALUES (9001, 9000, 'GLB990101AAA', 'Global ISP SA', '601', '06600', 'A', 'E', 'P', 1);
END;
CALL assert_true(@trg_err = 1, 'A4: organization_mx_profiles INSERT rejected for global org');

-- A5. cfdi_documents — INSERT for MX client should succeed
INSERT INTO cfdi_documents (id, organization_id, client_id, tipo_comprobante, uso_cfdi, exportacion,
                            subtotal, total_impuestos, total, sat_status, uuid, serie, folio)
VALUES (9000, 9001, 9001, 'I', 'G03', '01', 100.00, 16.00, 116.00, 'draft',
        'test-uuid-0001', 'TA', '1');
CALL assert_true(ROW_COUNT() = 1, 'A5: cfdi_documents INSERT succeeds for MX client');

-- A6. cfdi_documents — INSERT for global client should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO cfdi_documents (id, organization_id, client_id, tipo_comprobante, uso_cfdi, exportacion,
                                subtotal, total_impuestos, total, sat_status, uuid, serie, folio)
    VALUES (9001, 9000, 9000, 'I', 'G03', '01', 100.00, 16.00, 116.00, 'draft',
            'test-uuid-0002', 'TB', '1');
END;
CALL assert_true(@trg_err = 1, 'A6: cfdi_documents INSERT rejected for global client');

-- A7. concession_titles — INSERT for MX org should succeed
INSERT INTO concession_titles (id, organization_id, title_number, concession_type, services_authorized,
                               granted_date, regulatory_body, status)
VALUES (9000, 9001, 'CT-TEST-001', 'commercial', 'Internet', '2020-01-01', 'IFT', 'active');
CALL assert_true(ROW_COUNT() = 1, 'A7: concession_titles INSERT succeeds for MX org');

-- A8. concession_titles — INSERT for global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO concession_titles (id, organization_id, title_number, concession_type, services_authorized,
                                   granted_date, regulatory_body, status)
    VALUES (9001, 9000, 'CT-TEST-002', 'commercial', 'Internet', '2020-01-01', 'IFT', 'active');
END;
CALL assert_true(@trg_err = 1, 'A8: concession_titles INSERT rejected for global org');

-- A9. contract_templates_mx — INSERT for MX org should succeed
INSERT INTO contract_templates_mx (id, organization_id, template_name, body_text, status)
VALUES (9000, 9001, 'Test Template', 'Contract body text...', 'draft');
CALL assert_true(ROW_COUNT() = 1, 'A9: contract_templates_mx INSERT succeeds for MX org');

-- A10. contract_templates_mx — INSERT for global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO contract_templates_mx (id, organization_id, template_name, body_text, status)
    VALUES (9001, 9000, 'Test Template 2', 'Contract body text...', 'draft');
END;
CALL assert_true(@trg_err = 1, 'A10: contract_templates_mx INSERT rejected for global org');

-- A11. regulatory_filings — INSERT for MX org should succeed
INSERT INTO regulatory_filings (id, organization_id, filing_type, status)
VALUES (9000, 9001, 'annual_report', 'pending');
CALL assert_true(ROW_COUNT() = 1, 'A11: regulatory_filings INSERT succeeds for MX org');

-- A12. regulatory_filings — INSERT for global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO regulatory_filings (id, organization_id, filing_type, status)
    VALUES (9001, 9000, 'annual_report', 'pending');
END;
CALL assert_true(@trg_err = 1, 'A12: regulatory_filings INSERT rejected for global org');

-- A13. ift_statistical_reports — INSERT for MX org should succeed
INSERT INTO ift_statistical_reports (id, organization_id, report_period, period_start, period_end, status)
VALUES (9000, 9001, '2024-Q1', '2024-01-01', '2024-03-31', 'draft');
CALL assert_true(ROW_COUNT() = 1, 'A13: ift_statistical_reports INSERT succeeds for MX org');

-- A14. ift_statistical_reports — INSERT for global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO ift_statistical_reports (id, organization_id, report_period, period_start, period_end, status)
    VALUES (9001, 9000, '2024-Q2', '2024-04-01', '2024-06-30', 'draft');
END;
CALL assert_true(@trg_err = 1, 'A14: ift_statistical_reports INSERT rejected for global org');

-- A15. contracts with contract_template_mx_id — MX client should succeed
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, contract_template_mx_id, status)
VALUES (9000, 9001, 9000, '2024-01-01', 'static', 9000, 'pending');
CALL assert_true(ROW_COUNT() = 1, 'A15: contracts INSERT with MX template succeeds for MX client');

-- A16. contracts with contract_template_mx_id — global client should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, contract_template_mx_id, status)
    VALUES (9001, 9000, 9000, '2024-01-01', 'static', 9000, 'pending');
END;
CALL assert_true(@trg_err = 1, 'A16: contracts INSERT with MX template rejected for global client');

-- A17. contracts without MX template for global client should succeed
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, status)
VALUES (9002, 9000, 9000, '2024-01-01', 'pppoe', 'pending');
CALL assert_true(ROW_COUNT() = 1, 'A17: contracts INSERT without MX template succeeds for global client');

-- A18. client_mx_profiles — UPDATE client_id to global client should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE client_mx_profiles SET client_id = 9000 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'A18: client_mx_profiles UPDATE to global client rejected');

-- A19. organization_mx_profiles — UPDATE organization_id to global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE organization_mx_profiles SET organization_id = 9000 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'A19: organization_mx_profiles UPDATE to global org rejected');

-- A20. cfdi_documents — UPDATE client_id to global client should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE cfdi_documents SET client_id = 9000 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'A20: cfdi_documents UPDATE to global client rejected');

-- A21. concession_titles — UPDATE organization_id to global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE concession_titles SET organization_id = 9000 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'A21: concession_titles UPDATE to global org rejected');

-- A22. contract_templates_mx — UPDATE organization_id to global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE contract_templates_mx SET organization_id = 9000 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'A22: contract_templates_mx UPDATE to global org rejected');

-- A23. regulatory_filings — UPDATE organization_id to global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE regulatory_filings SET organization_id = 9000 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'A23: regulatory_filings UPDATE to global org rejected');

-- A24. ift_statistical_reports — UPDATE organization_id to global org should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE ift_statistical_reports SET organization_id = 9000 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'A24: ift_statistical_reports UPDATE to global org rejected');

-- A25. contracts — UPDATE to set MX template on global client contract should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE contracts SET contract_template_mx_id = 9000 WHERE id = 9002;
END;
CALL assert_true(@trg_err = 1, 'A25: contracts UPDATE with MX template rejected for global client');

-- =========================================================================
-- B. LOCALE DOWNGRADE GUARD TRIGGERS (migration 088)
-- =========================================================================

-- B1. Client with MX profile — locale downgrade should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE clients SET locale = 'global' WHERE id = 9001;
END;
CALL assert_true(@trg_err = 1, 'B1: Client locale downgrade blocked when client_mx_profiles exists');

-- B2. Organization with MX profile — locale downgrade should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE organizations SET locale = 'global' WHERE id = 9001;
END;
CALL assert_true(@trg_err = 1, 'B2: Org locale downgrade blocked when organization_mx_profiles exists');

-- B3. Client without MX data — locale change should work (after cleanup)
INSERT INTO clients (id, organization_id, name, client_type, locale, status)
VALUES (9002, 9000, 'MX Client 2', 'personal', 'MX', 'active');
UPDATE clients SET locale = 'global' WHERE id = 9002;
CALL assert_true(ROW_COUNT() = 1, 'B3: Client locale downgrade allowed when no MX records');
DELETE FROM clients WHERE id = 9002;

-- =========================================================================
-- C. FACTURAR GUARD TRIGGERS (migration 097)
-- =========================================================================

-- C1. Contract facturar=TRUE for MX client should succeed
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, facturar, status)
VALUES (9003, 9001, 9000, '2024-01-01', 'static', TRUE, 'pending');
CALL assert_true(ROW_COUNT() = 1, 'C1: Contract facturar=TRUE allowed for MX client');

-- C2. Contract facturar=TRUE for global client should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, facturar, status)
    VALUES (9004, 9000, 9000, '2024-01-01', 'static', TRUE, 'pending');
END;
CALL assert_true(@trg_err = 1, 'C2: Contract facturar=TRUE rejected for global client');

-- C3. UPDATE facturar from FALSE to TRUE on global client should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE contracts SET facturar = TRUE WHERE id = 9002;
END;
CALL assert_true(@trg_err = 1, 'C3: UPDATE facturar=TRUE rejected for global client contract');

-- C4. Contract facturar=FALSE for global client should succeed
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, facturar, status)
VALUES (9004, 9000, 9000, '2024-02-01', 'static', FALSE, 'pending');
CALL assert_true(ROW_COUNT() = 1, 'C4: Contract facturar=FALSE allowed for global client');

-- =========================================================================
-- D. FACTURA PÚBLICA STAMPING SAFEGUARDS (migration 091)
-- =========================================================================

-- D1. Create paid invoice, add to factura publica → should succeed
INSERT INTO invoices (id, client_id, invoice_number, issue_date, due_date, subtotal, tax_amount, total, status, paid_at)
VALUES (9000, 9001, 'INV-T9000', '2024-01-01', '2024-01-31', 100.00, 16.00, 116.00, 'paid', NOW());

INSERT INTO factura_publica_invoices (id, organization_id, periodicidad, meses, anio, subtotal, total_impuestos, total, status)
VALUES (9000, 9001, '01', '01', 2024, 100.00, 16.00, 116.00, 'draft');

INSERT INTO factura_publica_invoice_items (id, factura_publica_invoice_id, invoice_id)
VALUES (9000, 9000, 9000);
CALL assert_true(ROW_COUNT() = 1, 'D1: factura_publica_invoice_items INSERT succeeds for paid invoice');

-- D2. Try adding unpaid invoice to factura publica → should fail
INSERT INTO invoices (id, client_id, invoice_number, issue_date, due_date, subtotal, tax_amount, total, status)
VALUES (9001, 9001, 'INV-T9001', '2024-01-01', '2024-01-31', 200.00, 32.00, 232.00, 'draft');

SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO factura_publica_invoice_items (id, factura_publica_invoice_id, invoice_id)
    VALUES (9001, 9000, 9001);
END;
CALL assert_true(@trg_err = 1, 'D2: factura_publica_invoice_items INSERT rejected for unpaid invoice');

-- D3. Stamp factura publica with all paid → should succeed
UPDATE factura_publica_invoices SET status = 'stamped' WHERE id = 9000;
CALL assert_true(ROW_COUNT() = 1, 'D3: factura_publica_invoices stamp succeeds when all invoices paid');

-- D4. Stamp factura publica with unpaid invoice — set up separate factura
INSERT INTO factura_publica_invoices (id, organization_id, periodicidad, meses, anio, subtotal, total_impuestos, total, status)
VALUES (9001, 9001, '01', '02', 2024, 200.00, 32.00, 232.00, 'draft');

-- Pay invoice 9001 to insert it, then unpay it to test stamp guard
UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = 9001;
INSERT INTO factura_publica_invoice_items (id, factura_publica_invoice_id, invoice_id)
VALUES (9001, 9001, 9001);
-- Revert invoice to draft
UPDATE invoices SET status = 'draft', paid_at = NULL WHERE id = 9001;

SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE factura_publica_invoices SET status = 'stamped' WHERE id = 9001;
END;
CALL assert_true(@trg_err = 1, 'D4: factura_publica_invoices stamp rejected when linked invoice is unpaid');

-- =========================================================================
-- E. PAYMENT ALLOCATION BALANCE GUARDS (migration 126)
-- =========================================================================

-- Fixture: payment of $500, two invoices of $300 each
INSERT INTO invoices (id, client_id, invoice_number, issue_date, due_date, subtotal, tax_amount, total, status)
VALUES (9002, 9001, 'INV-T9002', '2024-02-01', '2024-02-28', 300.00, 0.00, 300.00, 'sent');
INSERT INTO invoices (id, client_id, invoice_number, issue_date, due_date, subtotal, tax_amount, total, status)
VALUES (9003, 9001, 'INV-T9003', '2024-03-01', '2024-03-31', 300.00, 0.00, 300.00, 'sent');

INSERT INTO payments (id, client_id, amount, payment_date, payment_method)
VALUES (9000, 9001, 500.00, '2024-02-15', 'cash');

-- E1. Allocate $300 to invoice 9002 — should succeed (300 <= 500)
INSERT INTO payment_allocations (id, payment_id, invoice_id, amount)
VALUES (9000, 9000, 9002, 300.00);
CALL assert_true(ROW_COUNT() = 1, 'E1: Payment allocation $300 of $500 succeeds');

-- E2. Allocate $200 to invoice 9003 — should succeed (300+200 = 500 <= 500)
INSERT INTO payment_allocations (id, payment_id, invoice_id, amount)
VALUES (9001, 9000, 9003, 200.00);
CALL assert_true(ROW_COUNT() = 1, 'E2: Payment allocation $200 more succeeds (total $500)');

-- E3. Allocate $1 more — exceeds payment total, should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    -- Need another invoice for the unique constraint
    INSERT INTO invoices (id, client_id, invoice_number, issue_date, due_date, subtotal, tax_amount, total, status)
    VALUES (9004, 9001, 'INV-T9004', '2024-04-01', '2024-04-30', 100.00, 0.00, 100.00, 'sent');
    INSERT INTO payment_allocations (id, payment_id, invoice_id, amount)
    VALUES (9002, 9000, 9004, 1.00);
END;
CALL assert_true(@trg_err = 1, 'E3: Payment over-allocation rejected (500+1 > 500)');

-- E4. Allocate more than invoice total — should fail (invoice 9003 total is 300, already has 200)
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    -- Create a second payment to test the invoice-side guard
    INSERT INTO payments (id, client_id, amount, payment_date, payment_method)
    VALUES (9001, 9001, 500.00, '2024-02-16', 'cash');
    INSERT INTO payment_allocations (id, payment_id, invoice_id, amount)
    VALUES (9003, 9001, 9003, 101.00);
END;
CALL assert_true(@trg_err = 1, 'E4: Invoice over-allocation rejected (200+101 > 300)');

-- E5. Update allocation to exceed payment — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE payment_allocations SET amount = 400.00 WHERE id = 9001;
END;
CALL assert_true(@trg_err = 1, 'E5: UPDATE allocation exceeding payment total rejected');

-- E6. UPDATE allocation to exceed invoice total specifically (payment cap OK)
INSERT INTO payment_allocations (id, payment_id, invoice_id, amount)
VALUES (9003, 9001, 9003, 100.00);
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE payment_allocations SET amount = 101.00 WHERE id = 9003;
END;
CALL assert_true(@trg_err = 1, 'E6: UPDATE allocation exceeding invoice total rejected');

-- =========================================================================
-- F. INVENTORY STOCK NEGATIVE GUARD (migration 127)
-- =========================================================================

-- Fixture
INSERT INTO warehouses (id, organization_id, name, status) VALUES (9000, 9000, 'Test Warehouse', 'active');
INSERT INTO inventory_items (id, organization_id, name, sku, category, unit, status)
VALUES (9000, 9000, 'Test Router', 'RTR-TEST-001', 'router', 'unit', 'active');
INSERT INTO inventory_stock (id, item_id, warehouse_id, quantity, aisle, col, shelf)
VALUES (9000, 9000, 9000, 10, 'A', '1', '1');

-- F1. Set quantity to 0 — should succeed
UPDATE inventory_stock SET quantity = 0 WHERE id = 9000;
CALL assert_true(ROW_COUNT() = 1, 'F1: Inventory stock quantity=0 allowed');

-- F2. Set quantity to -1 — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE inventory_stock SET quantity = -1 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'F2: Inventory stock negative quantity rejected');

-- F3. Set quantity back to positive — should succeed
UPDATE inventory_stock SET quantity = 5 WHERE id = 9000;
CALL assert_true(ROW_COUNT() = 1, 'F3: Inventory stock positive quantity allowed');

-- =========================================================================
-- G. RADIUS CONSISTENCY TRIGGER (migration 128)
-- =========================================================================

-- G1. Activate PPPoE contract without RADIUS — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE contracts SET status = 'active' WHERE id = 9002;
END;
CALL assert_true(@trg_err = 1, 'G1: PPPoE contract activation rejected without RADIUS account');

-- G2. Create RADIUS account, then activate — should succeed
INSERT INTO nas (id, name, ip_address, secret, type, status) VALUES (9000, 'Test NAS', '10.0.0.1', 'secret123', 'other', 'active');
INSERT INTO radius (id, client_id, contract_id, nas_id, username, password_hash, status)
VALUES (9000, 9000, 9002, 9000, 'test_user_pppoe', 'hash123', 'active');
UPDATE contracts SET status = 'active' WHERE id = 9002;
CALL assert_true(ROW_COUNT() = 1, 'G2: PPPoE contract activation succeeds with RADIUS account');

-- G3. Activate static contract without RADIUS — should succeed (no RADIUS needed)
UPDATE contracts SET status = 'active' WHERE id = 9004;
CALL assert_true(ROW_COUNT() = 1, 'G3: Static contract activation succeeds without RADIUS');

-- G4. Activate PPPoE dual-stack contract without RADIUS — should fail
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, status)
VALUES (9005, 9000, 9000, '2024-03-01', 'pppoe_dual', 'pending');
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE contracts SET status = 'active' WHERE id = 9005;
END;
CALL assert_true(@trg_err = 1, 'G4: PPPoE dual-stack activation rejected without RADIUS');

-- G5. Contract already active, change another field — should not trigger check
UPDATE contracts SET notes = 'Updated notes' WHERE id = 9002;
CALL assert_true(ROW_COUNT() = 1, 'G5: Update non-status field on active PPPoE contract succeeds');

-- =========================================================================
-- H. CREDIT NOTE INVOICE TOTAL GUARD (migration 146)
-- =========================================================================

-- H1. Credit note within invoice total — should succeed (invoice 9002 total = $300)
INSERT INTO credit_notes (id, client_id, invoice_id, credit_note_number, issue_date, reason, subtotal, total, status)
VALUES (9000, 9001, 9002, 'CN-T9000', '2024-03-01', 'billing_error', 200.00, 200.00, 'draft');
CALL assert_true(ROW_COUNT() = 1, 'H1: Credit note $200 on $300 invoice succeeds');

-- H2. Second credit note that would exceed total — should fail ($200 + $101 > $300)
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO credit_notes (id, client_id, invoice_id, credit_note_number, issue_date, reason, subtotal, total, status)
    VALUES (9001, 9001, 9002, 'CN-T9001', '2024-03-01', 'billing_error', 101.00, 101.00, 'draft');
END;
CALL assert_true(@trg_err = 1, 'H2: Credit note exceeding invoice total rejected ($200+$101 > $300)');

-- H3. Credit note exactly at boundary — should succeed ($200 + $100 = $300)
INSERT INTO credit_notes (id, client_id, invoice_id, credit_note_number, issue_date, reason, subtotal, total, status)
VALUES (9001, 9001, 9002, 'CN-T9001', '2024-03-01', 'billing_error', 100.00, 100.00, 'draft');
CALL assert_true(ROW_COUNT() = 1, 'H3: Credit note at exact boundary succeeds ($200+$100 = $300)');

-- H4. UPDATE credit note total to exceed — should fail ($100 other + $201 > $300)
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE credit_notes SET total = 201.00 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'H4: UPDATE credit note total exceeding invoice total rejected');

-- H5. Credit note without invoice_id — no cap enforced
INSERT INTO credit_notes (id, client_id, credit_note_number, issue_date, reason, subtotal, total, status)
VALUES (9002, 9001, 'CN-T9002', '2024-03-01', 'courtesy', 9999.00, 9999.00, 'draft');
CALL assert_true(ROW_COUNT() = 1, 'H5: Credit note without invoice_id succeeds regardless of amount');

-- =========================================================================
-- I. AUDIT LOG IMMUTABILITY (migration 147)
-- =========================================================================

-- I1. INSERT audit log — should succeed
INSERT INTO audit_logs (id, action, entity_type, entity_id, summary)
VALUES (9000, 'create', 'test', 9000, 'Test audit entry');
CALL assert_true(ROW_COUNT() = 1, 'I1: Audit log INSERT succeeds');

-- I2. UPDATE audit log — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE audit_logs SET summary = 'Tampered' WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'I2: Audit log UPDATE rejected (immutable)');

-- I3. DELETE audit log — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    DELETE FROM audit_logs WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'I3: Audit log DELETE rejected (immutable)');

-- =========================================================================
-- J. CFDI DOCUMENT IMMUTABILITY (migration 148)
-- =========================================================================

-- J1. Stamp CFDI (set sat_status to vigente) — should succeed (draft → vigente)
UPDATE cfdi_documents SET sat_status = 'vigente' WHERE id = 9000;
CALL assert_true(ROW_COUNT() = 1, 'J1: CFDI status update to vigente succeeds');

-- J2. Modify subtotal on vigente CFDI — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE cfdi_documents SET subtotal = 999.00 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'J2: Vigente CFDI subtotal modification rejected');

-- J3. Modify total on vigente CFDI — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE cfdi_documents SET total = 999.00 WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'J3: Vigente CFDI total modification rejected');

-- J4. Change sat_status to cancel_pending (cancellation flow) — should succeed
UPDATE cfdi_documents SET sat_status = 'cancel_pending', cancellation_reason = '02' WHERE id = 9000;
CALL assert_true(ROW_COUNT() = 1, 'J4: Vigente CFDI cancellation flow status change succeeds');

-- =========================================================================
-- K. CONTRACT STATUS FSM (migration 149)
-- =========================================================================

-- K1. pending → active (valid) — should succeed
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, status)
VALUES (9006, 9000, 9000, '2024-04-01', 'static', 'pending');
UPDATE contracts SET status = 'active' WHERE id = 9006;
CALL assert_true(ROW_COUNT() = 1, 'K1: Contract pending -> active succeeds');

-- K2. pending → cancelled (valid) — should succeed
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, status)
VALUES (9007, 9000, 9000, '2024-04-01', 'static', 'pending');
UPDATE contracts SET status = 'cancelled' WHERE id = 9007;
CALL assert_true(ROW_COUNT() = 1, 'K2: Contract pending -> cancelled succeeds');

-- K3. active → expired (valid) — should succeed
UPDATE contracts SET status = 'expired' WHERE id = 9006;
CALL assert_true(ROW_COUNT() = 1, 'K3: Contract active -> expired succeeds');

-- K4. active → cancelled (valid) — should succeed
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, status)
VALUES (9008, 9000, 9000, '2024-04-01', 'static', 'pending');
UPDATE contracts SET status = 'active' WHERE id = 9008;
UPDATE contracts SET status = 'cancelled' WHERE id = 9008;
CALL assert_true(ROW_COUNT() = 1, 'K4: Contract active -> cancelled succeeds');

-- K5. cancelled → active (invalid) — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE contracts SET status = 'active' WHERE id = 9007;
END;
CALL assert_true(@trg_err = 1, 'K5: Contract cancelled -> active rejected');

-- K6. expired → pending (invalid) — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE contracts SET status = 'pending' WHERE id = 9006;
END;
CALL assert_true(@trg_err = 1, 'K6: Contract expired -> pending rejected');

-- K7. pending → expired (invalid) — should fail
INSERT INTO contracts (id, client_id, plan_id, start_date, connection_type, status)
VALUES (9009, 9000, 9000, '2024-04-01', 'static', 'pending');
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE contracts SET status = 'expired' WHERE id = 9009;
END;
CALL assert_true(@trg_err = 1, 'K7: Contract pending -> expired rejected');

-- =========================================================================
-- L. OUTAGE TEMPORAL LOGIC (migration 150)
-- =========================================================================

-- L1. INSERT outage with resolved_at after started_at — should succeed
INSERT INTO outages (id, site_id, title, started_at, resolved_at, status)
VALUES (9000, 9000, 'Test Outage Resolved', '2024-01-01 00:00:00', '2024-01-01 01:00:00', 'resolved');
CALL assert_true(ROW_COUNT() = 1, 'L1: Outage with resolved_at after started_at succeeds');

-- L2. INSERT outage with resolved_at before started_at — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO outages (id, site_id, title, started_at, resolved_at, status)
    VALUES (9001, 9000, 'Bad Outage', '2024-01-01 12:00:00', '2024-01-01 11:00:00', 'resolved');
END;
CALL assert_true(@trg_err = 1, 'L2: Outage with resolved_at before started_at rejected');

-- L3. INSERT outage with resolved_at equal to started_at — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    INSERT INTO outages (id, site_id, title, started_at, resolved_at, status)
    VALUES (9001, 9000, 'Equal Times', '2024-01-01 12:00:00', '2024-01-01 12:00:00', 'resolved');
END;
CALL assert_true(@trg_err = 1, 'L3: Outage with resolved_at equal to started_at rejected');

-- L4. INSERT outage without resolved_at — should succeed
INSERT INTO outages (id, site_id, title, started_at, status)
VALUES (9001, 9000, 'Ongoing Outage', '2024-01-01 00:00:00', 'ongoing');
CALL assert_true(ROW_COUNT() = 1, 'L4: Outage without resolved_at succeeds');

-- L5. UPDATE outage to set resolved_at before started_at — should fail
SET @trg_err = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET @trg_err = 1;
    UPDATE outages SET resolved_at = '2023-12-31 23:00:00' WHERE id = 9000;
END;
CALL assert_true(@trg_err = 1, 'L5: UPDATE outage resolved_at before started_at rejected');

-- L6. UPDATE outage to set valid resolved_at — should succeed
UPDATE outages SET resolved_at = '2024-01-02 00:00:00', status = 'resolved' WHERE id = 9001;
CALL assert_true(ROW_COUNT() = 1, 'L6: UPDATE outage with valid resolved_at succeeds');

-- =========================================================================
-- CLEANUP — remove all test data in reverse dependency order
-- =========================================================================

-- Temporarily drop audit log immutability triggers for test cleanup
DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bu;
DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bd;

SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM outages WHERE id IN (9000, 9001);
DELETE FROM audit_logs WHERE id = 9000;
DELETE FROM credit_notes WHERE id IN (9000, 9001, 9002);
DELETE FROM radius WHERE id = 9000;
DELETE FROM nas WHERE id = 9000;
DELETE FROM factura_publica_invoice_items WHERE id IN (9000, 9001);
DELETE FROM factura_publica_invoices WHERE id IN (9000, 9001);
DELETE FROM payment_allocations WHERE id IN (9000, 9001, 9002, 9003);
DELETE FROM payments WHERE id IN (9000, 9001);
DELETE FROM invoices WHERE id IN (9000, 9001, 9002, 9003, 9004);
DELETE FROM contracts WHERE id IN (9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009);
DELETE FROM inventory_stock WHERE id = 9000;
DELETE FROM inventory_items WHERE id = 9000;
DELETE FROM inventory_transactions WHERE stock_id = 9000;
DELETE FROM warehouses WHERE id = 9000;
DELETE FROM ift_statistical_reports WHERE id IN (9000, 9001);
DELETE FROM regulatory_filings WHERE id IN (9000, 9001);
DELETE FROM concession_titles WHERE id IN (9000, 9001);
DELETE FROM contract_templates_mx WHERE id IN (9000, 9001);
DELETE FROM cfdi_documents WHERE id IN (9000, 9001);
DELETE FROM organization_mx_profiles WHERE id IN (9000, 9001);
DELETE FROM client_mx_profiles WHERE id IN (9000, 9001);
DELETE FROM clients WHERE id IN (9000, 9001, 9002);
DELETE FROM organizations WHERE id IN (9000, 9001);
DELETE FROM sites WHERE id = 9000;
DELETE FROM plans WHERE id = 9000;

SET FOREIGN_KEY_CHECKS = @OLD_FK_CHECKS;

-- Recreate audit log immutability triggers after cleanup
DELIMITER $$

CREATE TRIGGER trg_audit_logs_immutable_bu
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Audit logs are immutable and cannot be updated';
END$$

CREATE TRIGGER trg_audit_logs_immutable_bd
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Audit logs are immutable and cannot be deleted';
END$$

DELIMITER ;

CALL test_summary();
