-- Migration: 074_add_mexico_payment_methods
-- Description: Extends the payments table with Mexico-specific payment methods
--              and banking fields.
--
--              New payment_method values added:
--                oxxo_pay         — Cash payment at OXXO convenience stores (MercadoPago / Conekta)
--                spei             — SPEI interbank electronic transfer (Banco de México)
--                codi             — CoDi mobile payment (Banco de México QR / NFC)
--                convenience_store — Other convenience store cash payments (7-Eleven, etc.)
--                digital_wallet   — Digital wallets (Mercado Pago, PayPal, etc.)
--
--              New columns added:
--                sat_forma_pago  — SAT c_FormaPago code to stamp on the CFDI pago complement
--                clabe           — 18-digit CLABE interbank key (for SPEI and CoDi)
--                bank_name       — Name of the bank for SPEI / CoDi transactions
--
--              Column additions use stored-procedure IF NOT EXISTS guards so
--              the file is safe to re-run after a mid-file failure.  The
--              MODIFY COLUMN below is naturally re-runnable and stays bare.

ALTER TABLE payments
    MODIFY COLUMN payment_method
        ENUM(
            'cash',
            'check',
            'credit_card',
            'debit_card',
            'bank_transfer',
            'oxxo_pay',
            'spei',
            'codi',
            'convenience_store',
            'digital_wallet',
            'other'
        ) NOT NULL DEFAULT 'cash'
        COMMENT 'Payment instrument; MX methods: oxxo_pay, spei, codi, convenience_store, digital_wallet';

-- ---------------------------------------------------------------------------
-- payments: sat_forma_pago, clabe, bank_name columns
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_074_add_payments_mx_columns;
DELIMITER //
CREATE PROCEDURE migration_074_add_payments_mx_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payments'
      AND COLUMN_NAME  = 'sat_forma_pago'
  ) THEN
    ALTER TABLE payments
        ADD COLUMN sat_forma_pago VARCHAR(2) NULL
            COMMENT 'SAT c_FormaPago code used to stamp on CFDI pago complement (e.g. 01=cash, 03=SPEI, 06=CoDi)'
            AFTER payment_method;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payments'
      AND COLUMN_NAME  = 'clabe'
  ) THEN
    ALTER TABLE payments
        ADD COLUMN clabe VARCHAR(18) NULL
            COMMENT '18-digit CLABE interbank key — required for SPEI and CoDi transactions'
            AFTER reference_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payments'
      AND COLUMN_NAME  = 'bank_name'
  ) THEN
    ALTER TABLE payments
        ADD COLUMN bank_name VARCHAR(100) NULL
            COMMENT 'Bank name for SPEI / CoDi transactions'
            AFTER clabe;
  END IF;
END //
DELIMITER ;
CALL migration_074_add_payments_mx_columns();
DROP PROCEDURE IF EXISTS migration_074_add_payments_mx_columns;
