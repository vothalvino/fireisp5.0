-- =============================================================================
-- Migration 310: Custom reports table — §15.5 custom report builder
-- =============================================================================

CREATE TABLE IF NOT EXISTS custom_reports (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,
    name            VARCHAR(100)    NOT NULL,
    description     TEXT            NULL,
    query_type      ENUM('sql','visual') NOT NULL DEFAULT 'sql',
    sql_query       TEXT            NULL  COMMENT 'User-supplied SELECT query (validated as read-only)',
    visual_config   JSON            NULL  COMMENT 'Visual report builder configuration',
    is_public       TINYINT(1)      NOT NULL DEFAULT 0  COMMENT '1 = visible to all org members',
    last_run_at     DATETIME        NULL,
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_custom_reports_org (organization_id),
    KEY idx_custom_reports_created_by (created_by),
    KEY idx_custom_reports_public (is_public),
    KEY idx_custom_reports_deleted_at (deleted_at),
    CONSTRAINT fk_custom_reports_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_custom_reports_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='User-defined custom report definitions (§15.5)';
