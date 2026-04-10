-- Migration: 062_create_coverage_zones_table
-- Description: Coverage zones within a service area — finer-grained polygons
--              that describe the actual network reach, technology type, and
--              maximum available speed.  Used on public coverage-check pages
--              and for internal capacity planning.

CREATE TABLE IF NOT EXISTS coverage_zones (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    service_area_id BIGINT UNSIGNED  NOT NULL COMMENT 'Parent service area this zone belongs to',
    name            VARCHAR(150)     NOT NULL COMMENT 'Label, e.g. "FTTH Zone A", "Fixed-Wireless Sector 3"',
    description     TEXT             NULL     COMMENT 'Additional notes (equipment used, limitations, etc.)',
    zone_type       ENUM('fiber', 'fixed_wireless', 'dsl', 'cable', 'satellite', 'lte', '5g', 'other')
                                     NOT NULL DEFAULT 'fiber'
                                     COMMENT 'Access technology available in this zone',
    boundary        POLYGON          NOT NULL /*!80003 SRID 4326 */
                                     COMMENT 'WGS 84 polygon defining the zone boundary',
    max_download_mbps INT UNSIGNED   NULL     COMMENT 'Maximum advertised download speed in Mbps',
    max_upload_mbps   INT UNSIGNED   NULL     COMMENT 'Maximum advertised upload speed in Mbps',
    color           VARCHAR(7)       NULL     COMMENT 'Hex colour for map rendering, e.g. "#10B981"',
    status          ENUM('planned', 'under_construction', 'active', 'degraded', 'retired')
                                     NOT NULL DEFAULT 'planned'
                                     COMMENT 'planned = design phase; under_construction = build in progress; active = live; degraded = reduced capacity; retired = decommissioned',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    SPATIAL KEY spx_coverage_zones_boundary (boundary),
    KEY idx_coverage_zones_service_area_id (service_area_id),
    KEY idx_coverage_zones_zone_type (zone_type),
    KEY idx_coverage_zones_status (status),
    CONSTRAINT fk_coverage_zones_service_area FOREIGN KEY (service_area_id)
        REFERENCES service_areas (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
