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

ALTER TABLE payments
    ADD COLUMN sat_forma_pago VARCHAR(2) NULL
        COMMENT 'SAT c_FormaPago code used to stamp on CFDI pago complement (e.g. 01=cash, 03=SPEI, 06=CoDi)'
        AFTER payment_method;

ALTER TABLE payments
    ADD COLUMN clabe VARCHAR(18) NULL
        COMMENT '18-digit CLABE interbank key — required for SPEI and CoDi transactions'
        AFTER reference_number;

ALTER TABLE payments
    ADD COLUMN bank_name VARCHAR(100) NULL
        COMMENT 'Bank name for SPEI / CoDi transactions'
        AFTER clabe;
