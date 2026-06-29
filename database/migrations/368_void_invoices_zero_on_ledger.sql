-- =============================================================================
-- Migration 368 — Voided invoices read as $0 on the balance ledger
-- =============================================================================
-- A voided invoice should not contribute to the client balance and should show
-- as $0 in the ledger. Previously voiding left the invoice's debit in place and
-- added an offsetting "Void invoice" credit (two lines); invoices voided before
-- that handler existed kept a live debit and so still inflated the balance.
--
-- Collapse both cases to a single $0 line: drop the void-reversal credits and
-- zero the debit entries of every voided invoice. The net balance is unchanged
-- where a reversal credit already existed, and corrected where it did not. Only
-- reference_type='invoice' rows of voided invoices are touched.

-- 1) Remove the "Void invoice …" reversal credits (the only credit rows that
--    carry reference_type='invoice').
DELETE cbl
FROM   client_balance_ledger cbl
JOIN   invoices i ON i.id = cbl.reference_id
WHERE  cbl.reference_type = 'invoice'
  AND  cbl.entry_type = 'credit'
  AND  i.status = 'void';

-- 2) Zero the remaining (debit) ledger entries of voided invoices.
UPDATE client_balance_ledger cbl
JOIN   invoices i ON i.id = cbl.reference_id
SET    cbl.amount = 0, cbl.debit = 0, cbl.credit = 0
WHERE  cbl.reference_type = 'invoice'
  AND  i.status = 'void';
