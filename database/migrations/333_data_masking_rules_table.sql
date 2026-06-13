-- Migration 333 — data_masking_rules table
-- Purpose: Data masking configuration specifying which columns are masked and by which roles.
-- Tables: data_masking_rules

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS data_masking_rules (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NULL,
    table_name              VARCHAR(100)    NOT NULL COMMENT 'Database table containing sensitive column',
    column_name             VARCHAR(100)    NOT NULL COMMENT 'Column to mask',
    mask_type               ENUM('full','partial','hash','tokenize','redact') NOT NULL DEFAULT 'partial'
                                COMMENT 'full=*****, partial=show first/last chars, hash=SHA256, tokenize=reversible token, redact=remove from output',
    mask_pattern            VARCHAR(100)    NULL COMMENT 'Custom masking pattern, e.g. XXXX-XXXX-XXXX-{last4}',
    min_role_to_view_plain  VARCHAR(50)     NOT NULL DEFAULT 'admin' COMMENT 'Minimum role name allowed to see unmasked value',
    is_active               TINYINT(1)      NOT NULL DEFAULT 1,
    notes                   VARCHAR(500)    NULL,
    created_by              BIGINT UNSIGNED NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_data_masking_rules_table_col (organization_id, table_name, column_name),
    KEY idx_data_masking_rules_org (organization_id),
    KEY idx_data_masking_rules_table (table_name),
    KEY idx_data_masking_rules_active (is_active),
    CONSTRAINT fk_data_masking_rules_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_data_masking_rules_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Data masking configuration per table column (§17)';
