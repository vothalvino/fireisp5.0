-- ---------------------------------------------------------------------------
-- Migration 020: Create audit_logs table
-- Purpose: System-wide audit trail for tracking who changed what and when
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NULL     COMMENT 'User who performed the action; NULL for system actions',
    action      ENUM('create', 'update', 'delete', 'login', 'logout', 'export', 'other') NOT NULL,
    entity_type VARCHAR(50)     NOT NULL COMMENT 'Table or resource name e.g. clients, invoices',
    entity_id   BIGINT UNSIGNED NULL     COMMENT 'ID of the affected record',
    summary     VARCHAR(500)    NULL     COMMENT 'Human-readable description of the change',
    old_values  JSON            NULL     COMMENT 'Previous field values (JSON)',
    new_values  JSON            NULL     COMMENT 'Updated field values (JSON)',
    ip_address  VARCHAR(45)     NULL     COMMENT 'IP address of the request origin',
    user_agent  VARCHAR(500)    NULL     COMMENT 'Browser / API client identifier',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_audit_logs_user_id (user_id),
    KEY idx_audit_logs_entity (entity_type, entity_id),
    KEY idx_audit_logs_action (action),
    KEY idx_audit_logs_created_at (created_at),
    CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
