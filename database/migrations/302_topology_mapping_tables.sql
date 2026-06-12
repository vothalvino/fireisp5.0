-- =============================================================================
-- Migration 302: Topology & Mapping tables — §13
-- =============================================================================
-- New tables: map_geofences, map_infrastructure_points,
--             fiber_route_segments, device_dependency_edges
-- Column adds: devices.latitude, devices.longitude, devices.parent_device_id
--              (all via INFORMATION_SCHEMA stored-procedure guard)
-- =============================================================================

-- Add latitude, longitude, parent_device_id to devices via guard procedure
DROP PROCEDURE IF EXISTS migrate_302;
DELIMITER ;;
CREATE PROCEDURE migrate_302()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'latitude'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN latitude DECIMAL(10,7) NULL COMMENT 'Device GPS latitude (topology map pin)' AFTER notes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'longitude'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN longitude DECIMAL(10,7) NULL COMMENT 'Device GPS longitude (topology map pin)' AFTER latitude;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'parent_device_id'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN parent_device_id BIGINT UNSIGNED NULL COMMENT 'Direct upstream/parent device for dependency graph' AFTER longitude;
  END IF;
END ;;
DELIMITER ;
CALL migrate_302();
DROP PROCEDURE IF EXISTS migrate_302;

-- ---------------------------------------------------------------------------
-- Table: map_geofences
-- Geofence zones — polygon boundary (GeoJSON) or radius-based circle.
-- Used to trigger alerts when CPE devices move outside their designated area.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS map_geofences (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(255)    NOT NULL,
  type            ENUM('polygon','radius') NOT NULL DEFAULT 'polygon',
  boundary        JSON            NULL     COMMENT 'GeoJSON coordinates array for polygon type',
  center_lat      DECIMAL(10,7)   NULL     COMMENT 'Center latitude for radius type',
  center_lng      DECIMAL(10,7)   NULL     COMMENT 'Center longitude for radius type',
  radius_meters   INT UNSIGNED    NULL     COMMENT 'Radius in metres for radius type',
  device_id       BIGINT UNSIGNED NULL     COMMENT 'Optional: pin geofence to a specific device',
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  description     VARCHAR(500)    NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME        NULL,
  PRIMARY KEY (id),
  KEY idx_map_geofences_org (organization_id),
  KEY idx_map_geofences_device (device_id),
  KEY idx_map_geofences_active (is_active),
  KEY idx_map_geofences_deleted (deleted_at),
  CONSTRAINT fk_map_geofences_organization FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: map_infrastructure_points
-- Unified infrastructure map pins: towers, cabinets, splice closures, ODFs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS map_infrastructure_points (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  site_id         BIGINT UNSIGNED NULL     COMMENT 'Optional link to an existing site',
  name            VARCHAR(255)    NOT NULL,
  type            ENUM('tower','cabinet','odf','splice_closure','pole','pop','other') NOT NULL DEFAULT 'other',
  latitude        DECIMAL(10,7)   NOT NULL,
  longitude       DECIMAL(10,7)   NOT NULL,
  address         VARCHAR(500)    NULL,
  description     VARCHAR(500)    NULL,
  properties      JSON            NULL     COMMENT 'Extra vendor-specific key/value pairs',
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME        NULL,
  PRIMARY KEY (id),
  KEY idx_map_infra_org (organization_id),
  KEY idx_map_infra_site (site_id),
  KEY idx_map_infra_type (type),
  KEY idx_map_infra_deleted (deleted_at),
  CONSTRAINT fk_map_infrastructure_points_organization FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_map_infrastructure_points_site FOREIGN KEY (site_id)
    REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: fiber_route_segments
-- Polyline segments for fiber route display — each row is a sub-segment of a
-- fiber route with ordered sequence, coordinates, cable spec, and burial type.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiber_route_segments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  fiber_route_id  BIGINT UNSIGNED NULL     COMMENT 'Parent fiber route (nullable if standalone segment)',
  name            VARCHAR(255)    NULL,
  sequence_no     INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Ordering within the parent route',
  coordinates     JSON            NOT NULL COMMENT 'GeoJSON LineString coordinates array [[lng,lat],...]',
  length_m        DECIMAL(10,2)   NULL     COMMENT 'Segment length in metres',
  cable_type      VARCHAR(100)    NULL     COMMENT 'e.g. ADSS-48F, G652D',
  burial_type     ENUM('aerial','underground','conduit','submarine','indoor','other') NULL,
  fiber_count     SMALLINT UNSIGNED NULL,
  status          ENUM('planned','active','maintenance','decommissioned') NOT NULL DEFAULT 'active',
  notes           TEXT            NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fiber_route_segs_org (organization_id),
  KEY idx_fiber_route_segs_route (fiber_route_id),
  KEY idx_fiber_route_segs_status (status),
  CONSTRAINT fk_fiber_route_segments_organization FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: device_dependency_edges
-- Parent-child device dependencies for cascade visualization and impact
-- analysis.  A directed edge from parent → child models the "if parent fails,
-- child is impacted" relationship.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_dependency_edges (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  parent_device_id BIGINT UNSIGNED NOT NULL COMMENT 'Upstream/failing device',
  child_device_id  BIGINT UNSIGNED NOT NULL COMMENT 'Downstream/impacted device',
  dependency_type  ENUM('power','network','management','other') NOT NULL DEFAULT 'network',
  is_redundant     TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1 if this path is a redundant/failover link',
  notes            VARCHAR(500)    NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dep_edge_pair (organization_id, parent_device_id, child_device_id, dependency_type),
  KEY idx_dep_edge_org (organization_id),
  KEY idx_dep_edge_parent (parent_device_id),
  KEY idx_dep_edge_child (child_device_id),
  CONSTRAINT fk_device_dependency_edges_organization FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_device_dependency_edges_parent FOREIGN KEY (parent_device_id)
    REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_device_dependency_edges_child FOREIGN KEY (child_device_id)
    REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
