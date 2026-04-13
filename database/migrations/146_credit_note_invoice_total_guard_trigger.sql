-- Migration: 146_credit_note_invoice_total_guard_trigger
-- Description: Adds BEFORE INSERT and BEFORE UPDATE triggers on credit_notes
--              that prevent the credit note total from exceeding the linked
--              invoice total.
--
--              Business rule: when a credit note references an invoice via
--              invoice_id, the sum of all credit note totals on that invoice
--              (excluding cancelled ones) must not exceed the invoice total.
--              Over-crediting would cause revenue loss and accounting errors.
--
--              Credit notes without an invoice_id (e.g. courtesy credits) are
--              not subject to this check.
--
--              The triggers raise SQLSTATE '45000' with a descriptive message
--              so the application layer can surface a user-friendly error.
--
--              Uses DROP TRIGGER IF EXISTS before CREATE TRIGGER so the
--              migration is safe to re-run.

DELIMITER $$

-- -------------------------------------------------------------------------
-- 1. BEFORE INSERT — credit note total must not over-credit the invoice
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_credit_note_invoice_cap_bi$$

CREATE TRIGGER trg_credit_note_invoice_cap_bi
BEFORE INSERT ON credit_notes
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total   DECIMAL(10, 2);
    DECLARE v_already_credited DECIMAL(10, 2);

    IF NEW.invoice_id IS NOT NULL AND NEW.status != 'cancelled' THEN
        SELECT total INTO v_invoice_total
        FROM   invoices
        WHERE  id = NEW.invoice_id;

        SELECT COALESCE(SUM(total), 0) INTO v_already_credited
        FROM   credit_notes
        WHERE  invoice_id = NEW.invoice_id
          AND  status     != 'cancelled';

        IF v_already_credited + NEW.total > v_invoice_total THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Credit note total would exceed the linked invoice total';
        END IF;
    END IF;
END$$

-- -------------------------------------------------------------------------
-- 2. BEFORE UPDATE — same check, excluding current row from sum
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_credit_note_invoice_cap_bu$$

CREATE TRIGGER trg_credit_note_invoice_cap_bu
BEFORE UPDATE ON credit_notes
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total   DECIMAL(10, 2);
    DECLARE v_already_credited DECIMAL(10, 2);

    IF NEW.invoice_id IS NOT NULL AND NEW.status != 'cancelled' THEN
        SELECT total INTO v_invoice_total
        FROM   invoices
        WHERE  id = NEW.invoice_id;

        SELECT COALESCE(SUM(total), 0) INTO v_already_credited
        FROM   credit_notes
        WHERE  invoice_id = NEW.invoice_id
          AND  status     != 'cancelled'
          AND  id         != OLD.id;

        IF v_already_credited + NEW.total > v_invoice_total THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Credit note total would exceed the linked invoice total';
        END IF;
    END IF;
END$$

DELIMITER ;
