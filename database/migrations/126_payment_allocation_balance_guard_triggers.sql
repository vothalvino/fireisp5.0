-- Migration: 126_payment_allocation_balance_guard_triggers
-- Description: Adds database-level guards that prevent payment_allocations
--              rows from over-allocating a payment or over-applying amounts
--              to an invoice.
--
--              Four triggers are created:
--
--                trg_payment_alloc_payment_bi  — BEFORE INSERT: sum of existing
--                  allocations + NEW.amount must not exceed payments.amount
--
--                trg_payment_alloc_payment_bu  — BEFORE UPDATE: same check,
--                  excluding the current row from the running sum
--
--                trg_payment_alloc_invoice_bi  — BEFORE INSERT: sum of existing
--                  allocations on the same invoice + NEW.amount must not exceed
--                  invoices.total
--
--                trg_payment_alloc_invoice_bu  — BEFORE UPDATE: same check,
--                  excluding the current row
--
--              All triggers raise SQLSTATE '45000' with a descriptive message
--              when the guard condition is violated, causing the calling
--              transaction to roll back.
--
--              Uses DROP TRIGGER IF EXISTS before each CREATE TRIGGER so the
--              migration is safe to re-run.

DELIMITER $$

-- -------------------------------------------------------------------------
-- 1. BEFORE INSERT — payment cap
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_payment_alloc_payment_bi$$

CREATE TRIGGER trg_payment_alloc_payment_bi
BEFORE INSERT ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_payment_total  DECIMAL(10, 2);
    DECLARE v_already_alloc  DECIMAL(10, 2);

    SELECT amount INTO v_payment_total
    FROM   payments
    WHERE  id = NEW.payment_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_already_alloc
    FROM   payment_allocations
    WHERE  payment_id = NEW.payment_id;

    IF v_already_alloc + NEW.amount > v_payment_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed total payment amount';
    END IF;
END$$

-- -------------------------------------------------------------------------
-- 2. BEFORE UPDATE — payment cap (exclude current row from sum)
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_payment_alloc_payment_bu$$

CREATE TRIGGER trg_payment_alloc_payment_bu
BEFORE UPDATE ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_payment_total  DECIMAL(10, 2);
    DECLARE v_already_alloc  DECIMAL(10, 2);

    SELECT amount INTO v_payment_total
    FROM   payments
    WHERE  id = NEW.payment_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_already_alloc
    FROM   payment_allocations
    WHERE  payment_id = NEW.payment_id
      AND  id        != OLD.id;

    IF v_already_alloc + NEW.amount > v_payment_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed total payment amount';
    END IF;
END$$

-- -------------------------------------------------------------------------
-- 3. BEFORE INSERT — invoice cap
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_payment_alloc_invoice_bi$$

CREATE TRIGGER trg_payment_alloc_invoice_bi
BEFORE INSERT ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total  DECIMAL(10, 2);
    DECLARE v_already_alloc  DECIMAL(10, 2);

    SELECT total INTO v_invoice_total
    FROM   invoices
    WHERE  id = NEW.invoice_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_already_alloc
    FROM   payment_allocations
    WHERE  invoice_id = NEW.invoice_id;

    IF v_already_alloc + NEW.amount > v_invoice_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed invoice total';
    END IF;
END$$

-- -------------------------------------------------------------------------
-- 4. BEFORE UPDATE — invoice cap (exclude current row from sum)
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_payment_alloc_invoice_bu$$

CREATE TRIGGER trg_payment_alloc_invoice_bu
BEFORE UPDATE ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total  DECIMAL(10, 2);
    DECLARE v_already_alloc  DECIMAL(10, 2);

    SELECT total INTO v_invoice_total
    FROM   invoices
    WHERE  id = NEW.invoice_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_already_alloc
    FROM   payment_allocations
    WHERE  invoice_id = NEW.invoice_id
      AND  id        != OLD.id;

    IF v_already_alloc + NEW.amount > v_invoice_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed invoice total';
    END IF;
END$$

DELIMITER ;
