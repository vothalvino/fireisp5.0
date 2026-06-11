-- =============================================================================
-- Migration 227: Walled garden org settings + suspension_rules walled_garden action
-- =============================================================================
-- Implements isp-platform-features.md §3.2 item 14:
--   • organization_walled_garden_settings table — per-org walled garden config
--   • suspension_rules.action ENUM extended with 'walled_garden'
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: organization_walled_garden_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_walled_garden_settings (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED NOT NULL,
    enabled               TINYINT(1)      NOT NULL DEFAULT 0
                              COMMENT 'When 1, walled garden is active for this org',
    redirect_url          VARCHAR(500)    NULL
                              COMMENT 'URL the NAS/captive portal redirects unpaid subscribers to',
    address_list_name     VARCHAR(100)    NOT NULL DEFAULT 'walled_garden'
                              COMMENT 'MikroTik address-list name (Mikrotik-Address-List AVP value)',
    allowed_destinations  TEXT            NULL
                              COMMENT 'Newline-separated hosts/CIDRs that walled users can reach (for NAS ACL config reference)',
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_walled_garden_org (organization_id),
    CONSTRAINT fk_walled_garden_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Extend suspension_rules.action ENUM to add 'walled_garden'
-- Guard: check if 'walled_garden' already present in COLUMN_TYPE.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_227_extend_suspension_action_walled_garden;
DELIMITER //
CREATE PROCEDURE migration_227_extend_suspension_action_walled_garden()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME  = 'suspension_rules'
      AND COLUMN_NAME = 'action'
      AND COLUMN_TYPE LIKE '%walled_garden%'
  ) THEN
    ALTER TABLE suspension_rules
      MODIFY COLUMN action
        ENUM('auto_suspend','notify_only','auto_disconnect','soft_suspend','walled_garden')
        NOT NULL COMMENT 'Action to perform when rule fires';
  END IF;
END //
DELIMITER ;
CALL migration_227_extend_suspension_action_walled_garden();
DROP PROCEDURE IF EXISTS migration_227_extend_suspension_action_walled_garden;
