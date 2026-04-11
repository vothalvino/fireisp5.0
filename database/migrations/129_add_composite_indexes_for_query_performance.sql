-- Migration: 129_add_composite_indexes_for_query_performance
-- Description: Adds composite indexes for the most common multi-column query
--              patterns identified during performance profiling of the billing,
--              network, and reporting subsystems.
--
--              Indexes added:
--                idx_invoices_currency_status           invoices(currency, status)
--                idx_payment_transactions_gateway_status payment_transactions(payment_gateway_id, gateway_status)
--                idx_expenses_currency                  expenses(currency)
--                idx_contracts_client_facturar          contracts(client_id, facturar)
--                idx_suspension_logs_contract           suspension_logs(contract_id, created_at)
--
--              NOTE: webhook_deliveries already carries idx_webhook_deliveries_next_retry_at
--              from its CREATE TABLE migration (109), so that index is not
--              duplicated here.
--
--              Each index is wrapped in a stored procedure that checks
--              INFORMATION_SCHEMA.STATISTICS before issuing the CREATE INDEX
--              statement, making this migration safe to re-run on installations
--              where the indexes may already exist.

DROP PROCEDURE IF EXISTS _migration_129_add_indexes;

DELIMITER $$

CREATE PROCEDURE _migration_129_add_indexes()
BEGIN
    -- 1. invoices(currency, status)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'invoices'
          AND  INDEX_NAME   = 'idx_invoices_currency_status'
    ) THEN
        CREATE INDEX idx_invoices_currency_status
            ON invoices (currency, status);
    END IF;

    -- 2. payment_transactions(payment_gateway_id, gateway_status)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'payment_transactions'
          AND  INDEX_NAME   = 'idx_payment_transactions_gateway_id_status'
    ) THEN
        CREATE INDEX idx_payment_transactions_gateway_id_status
            ON payment_transactions (payment_gateway_id, gateway_status);
    END IF;

    -- 3. expenses(currency)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'expenses'
          AND  INDEX_NAME   = 'idx_expenses_currency'
    ) THEN
        CREATE INDEX idx_expenses_currency
            ON expenses (currency);
    END IF;

    -- 4. contracts(client_id, facturar)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'contracts'
          AND  INDEX_NAME   = 'idx_contracts_client_facturar'
    ) THEN
        CREATE INDEX idx_contracts_client_facturar
            ON contracts (client_id, facturar);
    END IF;

    -- 5. suspension_logs(contract_id, created_at)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'suspension_logs'
          AND  INDEX_NAME   = 'idx_suspension_logs_contract_created'
    ) THEN
        CREATE INDEX idx_suspension_logs_contract_created
            ON suspension_logs (contract_id, created_at);
    END IF;
END$$

DELIMITER ;

CALL _migration_129_add_indexes();

DROP PROCEDURE IF EXISTS _migration_129_add_indexes;
