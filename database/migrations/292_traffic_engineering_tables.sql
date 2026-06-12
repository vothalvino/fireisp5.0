-- =============================================================================
-- Migration 292: Traffic Engineering tables — §10.4
-- =============================================================================
-- Changes:
--   queue_tree_nodes.queue_type extended with cbq/hfsc/pcq values
--   queue_tree_nodes.vendor_platform column added
-- Tables created:
--   interface_qos_policies          — per-interface QoS policy bindings
--   mpls_vlan_prioritization_rules  — MPLS EXP / 802.1p CoS rules
--   dscp_marking_policies           — DSCP/ToS marking policy catalog
-- Default DSCP policies seeded (4 rows)
-- =============================================================================

SET FOREIGN_KEY_CHECKS=0;

-- ---------------------------------------------------------------------------
-- 1. Extend queue_tree_nodes.queue_type ENUM (cbq, hfsc, pcq additions)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS add_queue_type_values;
DELIMITER //
CREATE PROCEDURE add_queue_type_values()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'queue_tree_nodes'
      AND COLUMN_NAME  = 'queue_type'
      AND COLUMN_TYPE LIKE '%cbq%'
  ) THEN
    ALTER TABLE queue_tree_nodes
      MODIFY COLUMN queue_type
        ENUM('tree','simple','cbq','hfsc','pcq') NOT NULL DEFAULT 'tree';
  END IF;
END //
DELIMITER ;
CALL add_queue_type_values();
DROP PROCEDURE IF EXISTS add_queue_type_values;

-- ---------------------------------------------------------------------------
-- 2. Add vendor_platform to queue_tree_nodes (guarded)
-- ---------------------------------------------------------------------------
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'queue_tree_nodes'
    AND COLUMN_NAME  = 'vendor_platform'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE queue_tree_nodes ADD COLUMN vendor_platform ENUM(''mikrotik'',''cisco'',''juniper'',''generic'') NULL AFTER queue_type',
  'SELECT ''Column vendor_platform already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. interface_qos_policies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interface_qos_policies (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NULL,
  device_id       BIGINT UNSIGNED NULL
                    COMMENT 'Network device this policy applies to; NULL = org-wide template',
  interface_name  VARCHAR(100) NULL
                    COMMENT 'NAS/router interface name (e.g. ether1, gi0/1)',
  policy_type     ENUM('htb','cbq','hfsc','pcq','prio','sfq','generic') NOT NULL DEFAULT 'htb',
  direction       ENUM('ingress','egress','both') NOT NULL DEFAULT 'both',
  parent_policy_id BIGINT UNSIGNED NULL
                    COMMENT 'Parent policy for hierarchical structures',
  bandwidth_mbps  INT UNSIGNED NULL COMMENT 'Committed rate in Mbps',
  ceil_mbps       INT UNSIGNED NULL COMMENT 'Maximum (ceiling) rate in Mbps',
  burst_mbps      INT UNSIGNED NULL,
  priority        TINYINT UNSIGNED NOT NULL DEFAULT 4,
  vendor_config   TEXT NULL
                    COMMENT 'JSON blob of vendor-specific parameters',
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_iqp_org (organization_id),
  KEY idx_iqp_device (device_id),
  KEY idx_iqp_parent (parent_policy_id),
  KEY idx_iqp_status (status),
  KEY idx_iqp_deleted (deleted_at),
  CONSTRAINT fk_iqp_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_iqp_device FOREIGN KEY (device_id)
    REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_iqp_parent FOREIGN KEY (parent_policy_id)
    REFERENCES interface_qos_policies (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. mpls_vlan_prioritization_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mpls_vlan_prioritization_rules (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NULL,
  rule_type       ENUM('mpls_exp','dot1p','dscp_to_dot1p','dot1p_to_dscp','combined')
                    NOT NULL DEFAULT 'dot1p',
  match_vlan_id   SMALLINT UNSIGNED NULL COMMENT 'Outer VLAN to match; NULL = any',
  match_inner_vlan_id SMALLINT UNSIGNED NULL COMMENT 'Inner VLAN (QinQ); NULL = any',
  match_dscp      TINYINT UNSIGNED NULL COMMENT 'DSCP value to match (0-63); NULL = any',
  match_dot1p     TINYINT UNSIGNED NULL COMMENT '802.1p CoS value to match (0-7); NULL = any',
  set_mpls_exp    TINYINT UNSIGNED NULL COMMENT 'MPLS EXP bits to set (0-7)',
  set_dot1p       TINYINT UNSIGNED NULL COMMENT '802.1p CoS to set (0-7)',
  set_dscp        TINYINT UNSIGNED NULL COMMENT 'DSCP value to set (0-63)',
  priority        TINYINT UNSIGNED NOT NULL DEFAULT 5
                    COMMENT 'Rule evaluation order (lower = higher priority)',
  enabled         TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_mvpr_org (organization_id),
  KEY idx_mvpr_enabled (enabled),
  KEY idx_mvpr_priority (priority),
  KEY idx_mvpr_deleted (deleted_at),
  CONSTRAINT fk_mvpr_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. dscp_marking_policies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dscp_marking_policies (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NULL,
  dscp_value      TINYINT UNSIGNED NOT NULL COMMENT 'DSCP codepoint (0-63)',
  dscp_name       VARCHAR(20) NULL
                    COMMENT 'Human-readable DSCP name (EF, AF41, CS3, BE, etc.)',
  traffic_class   ENUM('voice','video','interactive','bulk','scavenger','best_effort')
                    NOT NULL DEFAULT 'best_effort',
  match_protocol  ENUM('tcp','udp','icmp','any') NOT NULL DEFAULT 'any',
  match_dst_port  VARCHAR(100) NULL COMMENT 'Destination port range to match',
  match_src_port  VARCHAR(100) NULL,
  match_l7        VARCHAR(255) NULL COMMENT 'L7 pattern or application name',
  action          ENUM('mark','remark','trust','police') NOT NULL DEFAULT 'mark',
  priority        TINYINT UNSIGNED NOT NULL DEFAULT 5,
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_dmp_org (organization_id),
  KEY idx_dmp_dscp (dscp_value),
  KEY idx_dmp_status (status),
  KEY idx_dmp_deleted (deleted_at),
  CONSTRAINT fk_dmp_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. Seed 4 default DSCP marking policies (global, organization_id NULL)
-- ---------------------------------------------------------------------------
INSERT INTO dscp_marking_policies
  (organization_id, name, description, dscp_value, dscp_name, traffic_class,
   match_protocol, action, priority, status)
SELECT NULL, 'VoIP / EF', 'Expedited Forwarding for voice traffic', 46, 'EF',
  'voice', 'udp', 'mark', 1, 'active'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM dscp_marking_policies
  WHERE organization_id IS NULL AND dscp_name = 'EF'
);

INSERT INTO dscp_marking_policies
  (organization_id, name, description, dscp_value, dscp_name, traffic_class,
   match_protocol, action, priority, status)
SELECT NULL, 'Video Streaming / AF41', 'Assured Forwarding for video streams', 34, 'AF41',
  'video', 'tcp', 'mark', 2, 'active'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM dscp_marking_policies
  WHERE organization_id IS NULL AND dscp_name = 'AF41'
);

INSERT INTO dscp_marking_policies
  (organization_id, name, description, dscp_value, dscp_name, traffic_class,
   match_protocol, action, priority, status)
SELECT NULL, 'Web Browsing / CS3', 'Class Selector 3 for interactive web traffic', 24, 'CS3',
  'interactive', 'tcp', 'mark', 3, 'active'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM dscp_marking_policies
  WHERE organization_id IS NULL AND dscp_name = 'CS3'
);

INSERT INTO dscp_marking_policies
  (organization_id, name, description, dscp_value, dscp_name, traffic_class,
   match_protocol, action, priority, status)
SELECT NULL, 'Bulk / Best Effort', 'Default best-effort marking for bulk transfers', 0, 'BE',
  'best_effort', 'any', 'mark', 8, 'active'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM dscp_marking_policies
  WHERE organization_id IS NULL AND dscp_name = 'BE'
);

SET FOREIGN_KEY_CHECKS=1;
