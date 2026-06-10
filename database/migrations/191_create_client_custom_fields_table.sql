-- =============================================================================
-- Migration 191: client_custom_fields
-- =============================================================================
-- Implements isp-platform-features.md §1.1 "Custom fields (unlimited) for
-- technician notes, internal tags, etc." — an arbitrary key/value store scoped
-- to a client. One row per (client, key); values are free-form text.
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_custom_fields (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id   BIGINT UNSIGNED NOT NULL,
    field_key   VARCHAR(100)    NOT NULL COMMENT 'Custom field name / label',
    field_value TEXT            NULL     COMMENT 'Custom field value (free-form text)',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at  DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_client_custom_fields_client_key (client_id, field_key),
    KEY idx_client_custom_fields_client_id (client_id),
    KEY idx_client_custom_fields_deleted_at (deleted_at),
    CONSTRAINT fk_client_custom_fields_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
