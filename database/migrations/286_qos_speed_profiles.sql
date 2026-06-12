-- =============================================================================
-- Migration 286: QoS Speed Profiles — §10.1
-- =============================================================================
-- Implements isp-platform-features.md §10.1 "Speed Profiles":
--   Per-queue priority classes (VoIP > Video > Web > Download),
--   tree-based hierarchical QoS (MikroTik Queue Tree / Simple Queue),
--   and proper MikroTik burst semantics (threshold + time).
--
-- Tables created:
--   quality_classes     — Priority class registry (VoIP, Video, Web, Download, Other)
--   queue_tree_nodes    — Hierarchical queue-tree node definitions (parent/child)
--
-- Columns added (stored-procedure guards):
--   plans.burst_threshold_mbps   — MikroTik burst-threshold (CIR %)
--   plans.burst_time_seconds     — MikroTik burst-time window
--   plans.priority_class_id      — FK → quality_classes(id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: quality_classes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quality_classes (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id    BIGINT UNSIGNED NULL,
  name               VARCHAR(100) NOT NULL,
  description        TEXT NULL,
  traffic_type       ENUM('voip','video','web','download','other') NOT NULL DEFAULT 'other'
                       COMMENT 'Traffic type used to infer default priority',
  priority           TINYINT UNSIGNED NOT NULL DEFAULT 4
                       COMMENT 'Queue priority 1 (highest) to 8 (lowest); MikroTik maps to queue priority field',
  dscp_mark          VARCHAR(20) NULL
                       COMMENT 'DSCP marking to apply (e.g. EF, AF41, CS3, BE); NULL = no marking',
  mikrotik_queue_kind ENUM('pcq','sfq','fifo','red','sfb') NOT NULL DEFAULT 'pcq'
                       COMMENT 'MikroTik queue kind for this class',
  max_limit_pct      TINYINT UNSIGNED NULL
                       COMMENT 'Max percentage of parent queue bandwidth allocated to this class; NULL = unlimited',
  status             ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at         DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_quality_classes_org (organization_id),
  KEY idx_quality_classes_traffic_type (traffic_type),
  KEY idx_quality_classes_priority (priority),
  KEY idx_quality_classes_deleted (deleted_at),
  CONSTRAINT fk_quality_classes_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: queue_tree_nodes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_tree_nodes (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id    BIGINT UNSIGNED NULL,
  parent_id          BIGINT UNSIGNED NULL
                       COMMENT 'Parent queue tree node; NULL = root node (global parent)',
  name               VARCHAR(100) NOT NULL,
  description        TEXT NULL,
  queue_type         ENUM('tree','simple') NOT NULL DEFAULT 'tree'
                       COMMENT 'MikroTik queue implementation: Queue Tree or Simple Queue',
  interface          VARCHAR(100) NULL
                       COMMENT 'NAS interface this queue attaches to (e.g. ether1, bridge1)',
  max_limit_mbps     INT UNSIGNED NULL
                       COMMENT 'Maximum bandwidth limit in Mbps for this node (leaf or parent)',
  burst_limit_mbps   INT UNSIGNED NULL
                       COMMENT 'Burst limit in Mbps above max_limit; NULL = no burst',
  burst_threshold_mbps INT UNSIGNED NULL
                       COMMENT 'Burst threshold in Mbps; burst active when average < threshold',
  burst_time_seconds TINYINT UNSIGNED NULL
                       COMMENT 'Burst time window in seconds (MikroTik burst-time field)',
  priority           TINYINT UNSIGNED NOT NULL DEFAULT 4
                       COMMENT 'Queue priority 1 (highest) to 8 (lowest)',
  queue_kind         ENUM('pcq','sfq','fifo','red','sfb') NOT NULL DEFAULT 'pcq',
  status             ENUM('active','inactive') NOT NULL DEFAULT 'active',
  sort_order         SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at         DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_queue_tree_nodes_org (organization_id),
  KEY idx_queue_tree_nodes_parent (parent_id),
  KEY idx_queue_tree_nodes_deleted (deleted_at),
  CONSTRAINT fk_queue_tree_nodes_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_queue_tree_nodes_parent FOREIGN KEY (parent_id)
    REFERENCES queue_tree_nodes (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Column: plans.burst_threshold_mbps
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_286_add_burst_threshold;
DELIMITER //
CREATE PROCEDURE migration_286_add_burst_threshold()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'burst_threshold_mbps'
  ) THEN
    ALTER TABLE plans
      ADD COLUMN burst_threshold_mbps INT UNSIGNED NULL
        COMMENT 'MikroTik burst-threshold in Mbps; burst allowed when average rate < this value'
        AFTER burst_upload_mbps;
  END IF;
END //
DELIMITER ;
CALL migration_286_add_burst_threshold();
DROP PROCEDURE IF EXISTS migration_286_add_burst_threshold;

-- ---------------------------------------------------------------------------
-- Column: plans.burst_time_seconds
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_286_add_burst_time;
DELIMITER //
CREATE PROCEDURE migration_286_add_burst_time()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'burst_time_seconds'
  ) THEN
    ALTER TABLE plans
      ADD COLUMN burst_time_seconds TINYINT UNSIGNED NULL
        COMMENT 'MikroTik burst-time window in seconds (typically 8–16 s)'
        AFTER burst_threshold_mbps;
  END IF;
END //
DELIMITER ;
CALL migration_286_add_burst_time();
DROP PROCEDURE IF EXISTS migration_286_add_burst_time;

-- ---------------------------------------------------------------------------
-- Column: plans.priority_class_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_286_add_priority_class_id;
DELIMITER //
CREATE PROCEDURE migration_286_add_priority_class_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'priority_class_id'
  ) THEN
    ALTER TABLE plans
      ADD COLUMN priority_class_id BIGINT UNSIGNED NULL
        COMMENT 'Quality class assigned to subscribers on this plan; drives queue priority'
        AFTER priority;
  END IF;
END //
DELIMITER ;
CALL migration_286_add_priority_class_id();
DROP PROCEDURE IF EXISTS migration_286_add_priority_class_id;

-- ---------------------------------------------------------------------------
-- FK: fk_plans_priority_class
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_286_add_fk_plans_priority_class;
DELIMITER //
CREATE PROCEDURE migration_286_add_fk_plans_priority_class()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA          = DATABASE()
      AND TABLE_NAME            = 'plans'
      AND CONSTRAINT_NAME       = 'fk_plans_priority_class'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  ) THEN
    ALTER TABLE plans
      ADD CONSTRAINT fk_plans_priority_class
        FOREIGN KEY (priority_class_id) REFERENCES quality_classes (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_286_add_fk_plans_priority_class();
DROP PROCEDURE IF EXISTS migration_286_add_fk_plans_priority_class;

-- ---------------------------------------------------------------------------
-- Seed default quality classes (global — organization_id IS NULL)
-- ---------------------------------------------------------------------------
INSERT INTO quality_classes
    (organization_id, name, description, traffic_type, priority, dscp_mark,
     mikrotik_queue_kind, max_limit_pct, status)
SELECT NULL, 'VoIP', 'Voice over IP traffic — highest priority, strict timing', 'voip', 1, 'EF', 'pcq', 5, 'active'
FROM DUAL WHERE NOT EXISTS (
    SELECT 1 FROM quality_classes WHERE name = 'VoIP' AND organization_id IS NULL
);

INSERT INTO quality_classes
    (organization_id, name, description, traffic_type, priority, dscp_mark,
     mikrotik_queue_kind, max_limit_pct, status)
SELECT NULL, 'Video Streaming', 'Video conferencing and streaming (smooth playback)', 'video', 2, 'AF41', 'pcq', 25, 'active'
FROM DUAL WHERE NOT EXISTS (
    SELECT 1 FROM quality_classes WHERE name = 'Video Streaming' AND organization_id IS NULL
);

INSERT INTO quality_classes
    (organization_id, name, description, traffic_type, priority, dscp_mark,
     mikrotik_queue_kind, max_limit_pct, status)
SELECT NULL, 'Web Browsing', 'Interactive web and gaming traffic', 'web', 4, 'CS3', 'pcq', 40, 'active'
FROM DUAL WHERE NOT EXISTS (
    SELECT 1 FROM quality_classes WHERE name = 'Web Browsing' AND organization_id IS NULL
);

INSERT INTO quality_classes
    (organization_id, name, description, traffic_type, priority, dscp_mark,
     mikrotik_queue_kind, max_limit_pct, status)
SELECT NULL, 'Bulk Download', 'Background downloads, P2P, backups — best effort', 'download', 8, 'BE', 'pcq', 30, 'active'
FROM DUAL WHERE NOT EXISTS (
    SELECT 1 FROM quality_classes WHERE name = 'Bulk Download' AND organization_id IS NULL
);
