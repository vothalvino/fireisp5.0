-- =============================================================================
-- Migration 320: §16.9 Audit Log Extensions — report_access_logs table
-- =============================================================================
-- New tables:
--   report_access_logs — who downloaded subscriber data (extends §16.9 audit trail)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: report_access_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_access_logs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    user_id         BIGINT UNSIGNED NULL,
    report_type     VARCHAR(100)    NOT NULL COMMENT 'Type of report accessed (e.g. dsar_export, ip_assignment_log, regulatory_export)',
    entity_type     VARCHAR(50)     NULL COMMENT 'Related entity (e.g. clients, ip_assignments)',
    entity_id       BIGINT UNSIGNED NULL,
    parameters      JSON            NULL COMMENT 'Query parameters used',
    ip_address      VARCHAR(45)     NULL,
    user_agent      VARCHAR(500)    NULL,
    accessed_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_report_access_logs_org         (organization_id),
    KEY idx_report_access_logs_user        (user_id),
    KEY idx_report_access_logs_type        (report_type),
    KEY idx_report_access_logs_accessed_at (accessed_at),
    CONSTRAINT fk_report_access_logs_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_report_access_logs_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log of who accessed/downloaded subscriber data reports (§16.9)';
