-- =============================================================================
-- Rollback 370 — restore the migration-126 over-allocation guards (no soft-delete
--                filter)
-- =============================================================================
-- Recreates the four payment_allocations guard triggers exactly as migration 126
-- defined them, i.e. summing ALL allocation rows (including soft-deleted ones).
-- Idempotent (DROP TRIGGER IF EXISTS before each CREATE).

DELIMITER $$

DROP TRIGGER IF EXISTS trg_payment_alloc_payment_bi$$
CREATE TRIGGER trg_payment_alloc_payment_bi
BEFORE INSERT ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_payment_total  DECIMAL(10, 2);
    DECLARE v_already_alloc  DECIMAL(10, 2);
    SELECT amount INTO v_payment_total FROM payments WHERE id = NEW.payment_id;
    SELECT COALESCE(SUM(amount), 0) INTO v_already_alloc
    FROM   payment_allocations WHERE payment_id = NEW.payment_id;
    IF v_already_alloc + NEW.amount > v_payment_total THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment allocation would exceed total payment amount';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_payment_alloc_payment_bu$$
CREATE TRIGGER trg_payment_alloc_payment_bu
BEFORE UPDATE ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_payment_total  DECIMAL(10, 2);
    DECLARE v_already_alloc  DECIMAL(10, 2);
    SELECT amount INTO v_payment_total FROM payments WHERE id = NEW.payment_id;
    SELECT COALESCE(SUM(amount), 0) INTO v_already_alloc
    FROM   payment_allocations WHERE payment_id = NEW.payment_id AND id != OLD.id;
    IF v_already_alloc + NEW.amount > v_payment_total THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment allocation would exceed total payment amount';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_payment_alloc_invoice_bi$$
CREATE TRIGGER trg_payment_alloc_invoice_bi
BEFORE INSERT ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total  DECIMAL(10, 2);
    DECLARE v_already_alloc  DECIMAL(10, 2);
    SELECT total INTO v_invoice_total FROM invoices WHERE id = NEW.invoice_id;
    SELECT COALESCE(SUM(amount), 0) INTO v_already_alloc
    FROM   payment_allocations WHERE invoice_id = NEW.invoice_id;
    IF v_already_alloc + NEW.amount > v_invoice_total THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment allocation would exceed invoice total';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_payment_alloc_invoice_bu$$
CREATE TRIGGER trg_payment_alloc_invoice_bu
BEFORE UPDATE ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total  DECIMAL(10, 2);
    DECLARE v_already_alloc  DECIMAL(10, 2);
    SELECT total INTO v_invoice_total FROM invoices WHERE id = NEW.invoice_id;
    SELECT COALESCE(SUM(amount), 0) INTO v_already_alloc
    FROM   payment_allocations WHERE invoice_id = NEW.invoice_id AND id != OLD.id;
    IF v_already_alloc + NEW.amount > v_invoice_total THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment allocation would exceed invoice total';
    END IF;
END$$

DELIMITER ;
