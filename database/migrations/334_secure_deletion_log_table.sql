-- Migration 334 — secure_deletion_log table
-- Purpose: Audit log of secure deletion operations (GDPR/LFPDPPP right-to-erasure compliance).
-- Tables: secure_deletion_log

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS secure_deletion_log (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    table_name          VARCHAR(100)    NOT NULL COMMENT 'Table from which records were deleted',
    record_count        INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT 'Number of rows deleted in this operation',
    deletion_method     ENUM('soft_delete','hard_delete','overwrite','anonymize') NOT NULL DEFAULT 'hard_delete',
    reason              VARCHAR(500)    NOT NULL COMMENT 'Reason for deletion (e.g. DSAR erasure, retention_policy, manual)',
    requestor_type      ENUM('user','system','dsar','retention_policy','legal') NOT NULL DEFAULT 'user',
    requestor_id        BIGINT UNSIGNED NULL COMMENT 'User who requested deletion; NULL = system/automated',
    dsar_request_id     BIGINT UNSIGNED NULL COMMENT 'FK to dsar_requests.id if triggered by a DSAR',
    criteria            JSON            NULL COMMENT 'Filter criteria used to identify deleted records',
    checksum            VARCHAR(64)     NULL COMMENT 'SHA-256 of deleted record IDs list for audit trail',
    deleted_at          DATETIME        NOT NULL COMMENT 'Timestamp of deletion operation',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_secure_deletion_log_org (organization_id),
    KEY idx_secure_deletion_log_table (table_name),
    KEY idx_secure_deletion_log_deleted_at (deleted_at),
    KEY idx_secure_deletion_log_requestor (requestor_id),
    CONSTRAINT fk_secure_deletion_log_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_secure_deletion_log_requestor FOREIGN KEY (requestor_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log of secure deletion operations for compliance (§17)';
