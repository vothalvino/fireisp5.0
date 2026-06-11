-- =============================================================================
-- Migration 231: Create mac_move_events table (RADIUS Phase C)
-- =============================================================================
-- Implements isp-platform-features.md §3.3 "RADIUS Accounting Phase C":
--   Records MAC-move events detected during RADIUS accounting ingest —
--   i.e. when the same RADIUS username is seen authenticating from a different
--   MAC address (Calling-Station-Id) than its previous session, or from a
--   different NAS.
--
-- Design notes:
--   • organization_id and old_nas_id / new_nas_id are intentionally kept as
--     loose BIGINT UNSIGNED (no FK constraints) for cross-tenant compliance
--     logging and resilience against NAS/org deletion.
--   • detected_at defaults to CURRENT_TIMESTAMP so inserts from the accounting
--     ingest path do not need to supply a timestamp.
--   • old_mac / new_mac store the raw Calling-Station-Id strings (17-char
--     colon-separated MAC), not normalized values, to preserve audit fidelity.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mac_move_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL
                    COMMENT 'Tenant organization; NULL = single-tenant deployment (no FK — loose reference)',
  username        VARCHAR(64)     NOT NULL
                    COMMENT 'RADIUS username (matches radcheck.username)',
  old_mac         VARCHAR(17)     NULL
                    COMMENT 'Previous Calling-Station-Id MAC address',
  new_mac         VARCHAR(17)     NULL
                    COMMENT 'New Calling-Station-Id MAC address detected in this event',
  old_nas_id      BIGINT UNSIGNED NULL
                    COMMENT 'NAS from which the previous session originated (loose ref to nas.id)',
  new_nas_id      BIGINT UNSIGNED NULL
                    COMMENT 'NAS from which the new session originated (loose ref to nas.id)',
  detected_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                    COMMENT 'Timestamp when the MAC move was detected during accounting ingest',

  PRIMARY KEY (id),
  KEY idx_mac_move_org          (organization_id),
  KEY idx_mac_move_username     (username),
  KEY idx_mac_move_detected_at  (detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
