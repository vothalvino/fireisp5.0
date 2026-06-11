-- Migration: 091_add_factura_publica_stamping_safeguards
-- Description: Adds database-level safeguards for factura pública stamping:
--
--              1. FUNCTION fn_predominant_forma_pago(p_factura_publica_invoice_id)
--                 Calculates the predominant SAT FormaPago code for a factura
--                 pública by summing payment amounts grouped by sat_forma_pago
--                 across all linked invoices.  Returns the code with the highest
--                 total.  Defaults to '99' (Por definir) when:
--                   - No payments are recorded for the linked invoices, or
--                   - Two or more codes tie for the highest total.
--                 Call this function at stamp time to obtain the value to write
--                 into cfdi_documents.forma_pago.
--
--                 Business rule (SAT Anexo 20 CFDI 4.0):
--                   "En caso de que el pago se realice utilizando más de una
--                    forma de pago, se debe indicar la que represente el monto
--                    mayor."
--
--              2. TRIGGER trg_factura_publica_invoices_bu  (BEFORE UPDATE)
--                 Prevents factura_publica_invoices.status from being set to
--                 'stamped' when any linked invoice in
--                 factura_publica_invoice_items does not have status = 'paid'.
--                 Raises SQLSTATE '45000'.
--
--                 Business rule: Only paid invoices may be included in a
--                 stamped factura pública.  Including unpaid invoices forces
--                 the ISP to pay taxes on revenue it has not yet collected --
--                 if the client later cancels or never pays, the ISP cannot
--                 recover those taxes.
--
--              3. TRIGGER trg_factura_publica_invoice_items_bi  (BEFORE INSERT)
--                 Prevents inserting a row into factura_publica_invoice_items
--                 when the referenced invoice does not have status = 'paid'.
--                 Raises SQLSTATE '45000'.
--
--                 Business rule: Same as above — guard at insert time so the
--                 constraint is enforced incrementally, not only at stamp time.
--
-- Depends on:
--   migration 089 — factura_publica_invoices
--   migration 090 — factura_publica_invoice_items
--   invoices, payments tables

DELIMITER $$

-- =========================================================================
-- 1. fn_predominant_forma_pago
--    Returns the SAT FormaPago code that accounts for the largest share of
--    payments linked to the given factura pública.  Tie or no-data → '99'.
-- =========================================================================
DROP FUNCTION IF EXISTS fn_predominant_forma_pago$$
CREATE FUNCTION fn_predominant_forma_pago(
    p_factura_publica_invoice_id BIGINT UNSIGNED
)
RETURNS VARCHAR(2)
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_forma_pago VARCHAR(2) DEFAULT '99';
    DECLARE v_max_total  DECIMAL(14, 2);
    DECLARE v_tie_count  INT DEFAULT 0;

    -- Step 1: Find the highest payment total across all FormaPago codes.
    --         If no payments exist, MAX() returns NULL.
    SELECT MAX(group_total)
    INTO   v_max_total
    FROM (
        SELECT SUM(p.amount) AS group_total
        FROM   factura_publica_invoice_items fpi
        JOIN   payments p ON p.invoice_id = fpi.invoice_id
        WHERE  fpi.factura_publica_invoice_id = p_factura_publica_invoice_id
          AND  p.sat_forma_pago IS NOT NULL
        GROUP  BY p.sat_forma_pago
    ) grouped;

    -- No payments found — return the default '99'.
    IF v_max_total IS NULL THEN
        RETURN '99';
    END IF;

    -- Step 2: Count how many codes share the maximum total (tie detection).
    SELECT COUNT(*) INTO v_tie_count
    FROM (
        SELECT   p.sat_forma_pago
        FROM     factura_publica_invoice_items fpi
        JOIN     payments p ON p.invoice_id = fpi.invoice_id
        WHERE    fpi.factura_publica_invoice_id = p_factura_publica_invoice_id
          AND    p.sat_forma_pago IS NOT NULL
        GROUP BY p.sat_forma_pago
        HAVING   SUM(p.amount) = v_max_total
    ) tied;

    -- Tie (or unexpected zero) — return the default '99'.
    IF v_tie_count != 1 THEN
        RETURN '99';
    END IF;

    -- Step 3: Retrieve the unique winning code.
    SELECT   p.sat_forma_pago
    INTO     v_forma_pago
    FROM     factura_publica_invoice_items fpi
    JOIN     payments p ON p.invoice_id = fpi.invoice_id
    WHERE    fpi.factura_publica_invoice_id = p_factura_publica_invoice_id
      AND    p.sat_forma_pago IS NOT NULL
    GROUP BY p.sat_forma_pago
    HAVING   SUM(p.amount) = v_max_total
    LIMIT 1;

    RETURN v_forma_pago;
END$$

-- =========================================================================
-- 2. trg_factura_publica_invoices_bu
--    Block status → 'stamped' when any linked invoice is not 'paid'.
-- =========================================================================
DROP TRIGGER IF EXISTS trg_factura_publica_invoices_bu$$
CREATE TRIGGER trg_factura_publica_invoices_bu
BEFORE UPDATE ON factura_publica_invoices
FOR EACH ROW
BEGIN
    DECLARE v_unpaid_count INT DEFAULT 0;

    IF NEW.status = 'stamped' AND OLD.status != 'stamped' THEN
        SELECT COUNT(*) INTO v_unpaid_count
        FROM   factura_publica_invoice_items fpi
        JOIN   invoices i ON i.id = fpi.invoice_id
        WHERE  fpi.factura_publica_invoice_id = NEW.id
          AND  i.status != 'paid';

        IF v_unpaid_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot stamp factura pública: all linked invoices must have status = ''paid''. Remove or pay unpaid invoices before stamping.';
        END IF;
    END IF;
END$$

-- =========================================================================
-- 3. trg_factura_publica_invoice_items_bi
--    Reject inserting a row when the referenced invoice is not 'paid'.
-- =========================================================================
DROP TRIGGER IF EXISTS trg_factura_publica_invoice_items_bi$$
CREATE TRIGGER trg_factura_publica_invoice_items_bi
BEFORE INSERT ON factura_publica_invoice_items
FOR EACH ROW
BEGIN
    DECLARE v_invoice_status VARCHAR(20);

    SELECT status INTO v_invoice_status
    FROM   invoices
    WHERE  id = NEW.invoice_id;

    IF v_invoice_status IS NULL OR v_invoice_status != 'paid' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot add invoice to factura pública: invoice must have status = ''paid''.';
    END IF;
END$$

DELIMITER ;
