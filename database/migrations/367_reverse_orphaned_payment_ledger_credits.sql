-- =============================================================================
-- Migration 367 — Remove orphaned 'payment' credits from the balance ledger
-- =============================================================================
-- Deleting a payment historically did NOT reverse the client_balance_ledger
-- credit that recordPaymentCredit() created on payment creation. As a result a
-- soft-deleted payment disappeared from the Payments tab but its credit lingered
-- in the ledger and kept inflating the computed account balance (e.g. client 14's
-- deleted payments 7 & 8 showed in the ledger but not in Payments).
--
-- This deletes every 'payment' ledger credit whose payment no longer exists as a
-- live (non-deleted) row — i.e. the payment was soft-deleted or is gone. Other
-- reference types (invoice, credit_note, adjustment, payment_transaction, …) are
-- untouched. Going forward the payments afterDelete/afterRestore hooks keep the
-- ledger and the payments table in sync, so this is a one-time backfill.
DELETE cbl
FROM   client_balance_ledger cbl
LEFT JOIN payments p
       ON p.id = cbl.reference_id
      AND p.deleted_at IS NULL
WHERE  cbl.reference_type = 'payment'
  AND  p.id IS NULL;
