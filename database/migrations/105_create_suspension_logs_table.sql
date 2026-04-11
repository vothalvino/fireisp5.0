-- Migration: 105_create_suspension_logs_table
-- Description: History of suspend / unsuspend / disconnect / reconnect events
--              per contract. Captures the triggering rule, who or what performed
--              the action, RADIUS CoA outcome, and linked invoice.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS suspension_logs (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    contract_id          BIGINT UNSIGNED  NOT NULL                   COMMENT 'Contract affected by this suspension event',
    client_id            BIGINT UNSIGNED  NOT NULL                   COMMENT 'Client that owns the contract',
    suspension_rule_id   BIGINT UNSIGNED  NULL                       COMMENT 'Rule that triggered the action; NULL = manual action',
    action               ENUM('suspended','unsuspended','disconnected','reconnected')
                                          NOT NULL                   COMMENT 'Lifecycle action performed',
    reason               TEXT             NULL                       COMMENT 'Free-text explanation of why the action was taken',
    triggered_by         ENUM('system','manual')
                                          NOT NULL                   COMMENT 'Whether the action was triggered automatically or by a user',
    performed_by_user_id BIGINT UNSIGNED  NULL                       COMMENT 'User who performed the action; NULL = system-triggered',
    radius_coa_sent      TINYINT(1)       NOT NULL DEFAULT 0         COMMENT 'TRUE if a RADIUS Change-of-Authorization packet was dispatched',
    radius_coa_response  TEXT             NULL                       COMMENT 'Raw RADIUS CoA response or error message',
    related_invoice_id   BIGINT UNSIGNED  NULL                       COMMENT 'Invoice that caused the suspension (most overdue invoice)',
    suspended_at         TIMESTAMP        NOT NULL                   COMMENT 'Timestamp when the suspend/disconnect action was applied',
    restored_at          TIMESTAMP        NULL                       COMMENT 'Timestamp when service was restored; NULL if still suspended',
    created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_suspension_logs_contract_id (contract_id),
    KEY idx_suspension_logs_client_id (client_id),
    KEY idx_suspension_logs_rule_id (suspension_rule_id),
    KEY idx_suspension_logs_performed_by (performed_by_user_id),
    KEY idx_suspension_logs_related_invoice (related_invoice_id),
    KEY idx_suspension_logs_action (action),
    CONSTRAINT fk_suspension_logs_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_suspension_logs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_suspension_logs_rule FOREIGN KEY (suspension_rule_id)
        REFERENCES suspension_rules (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_suspension_logs_user FOREIGN KEY (performed_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_suspension_logs_invoice FOREIGN KEY (related_invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
