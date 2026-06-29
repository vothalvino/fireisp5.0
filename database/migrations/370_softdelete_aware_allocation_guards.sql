-- =============================================================================
-- Migration 370 — make the payment_allocations over-allocation guards
--                 soft-delete-aware
-- =============================================================================
-- The migration-126 guard triggers sum payment_allocations WITHOUT a deleted_at
-- filter, so a soft-deleted (released / reallocated) allocation row still counted
-- toward the payment's and the invoice's allocated totals. Since payment release
-- (void of a paid invoice) and reallocation soft-delete the old row then INSERT a
-- new one in the same transaction, the BEFORE INSERT guard double-counted the
-- soft-deleted row and raised a false "would exceed" SQLSTATE 45000 — breaking
-- reallocation and the re-application of a void-freed credit for any fully
-- allocated payment.
--
-- Recreate all four guards with `AND deleted_at IS NULL` so only LIVE allocations
-- count, consistent with migration 361's soft-delete-aware UNIQUE key. Idempotent
-- (DROP TRIGGER IF EXISTS before each CREATE).

DELIMITER $$

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
    WHERE  payment_id = NEW.payment_id
      AND  deleted_at IS NULL;

    IF v_already_alloc + NEW.amount > v_payment_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed total payment amount';
    END IF;
END$$

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
      AND  id        != OLD.id
      AND  deleted_at IS NULL;

    IF v_already_alloc + NEW.amount > v_payment_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed total payment amount';
    END IF;
END$$

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
    WHERE  invoice_id = NEW.invoice_id
      AND  deleted_at IS NULL;

    IF v_already_alloc + NEW.amount > v_invoice_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed invoice total';
    END IF;
END$$

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
      AND  id        != OLD.id
      AND  deleted_at IS NULL;

    IF v_already_alloc + NEW.amount > v_invoice_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed invoice total';
    END IF;
END$$

DELIMITER ;
