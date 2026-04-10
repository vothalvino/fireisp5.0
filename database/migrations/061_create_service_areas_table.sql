-- Migration: 061_create_service_areas_table
-- Description: Geographic service areas (regions / markets) used for sales
--              territory assignment and network planning.  Each area has a
--              named boundary stored as a MySQL POLYGON geometry with SRID
--              4326 (WGS 84) and an optional link to the owning site (POP /
--              data center) that serves the region.

CREATE TABLE IF NOT EXISTS service_areas (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    site_id         BIGINT UNSIGNED  NULL     COMMENT 'Primary site (POP / tower) serving this area; NULL = unassigned',
    name            VARCHAR(150)     NOT NULL COMMENT 'Human-readable label, e.g. "Downtown Metro", "North Rural"',
    description     TEXT             NULL     COMMENT 'Notes about terrain, demographics, or expansion plans',
    boundary        POLYGON          NOT NULL /*!80003 SRID 4326 */
                                     COMMENT 'WGS 84 polygon that defines the outer boundary of this service area',
    color           VARCHAR(7)       NULL     COMMENT 'Hex colour for map rendering, e.g. "#3B82F6"',
    status          ENUM('planned', 'active', 'retired')
                                     NOT NULL DEFAULT 'planned'
                                     COMMENT 'planned = future build-out; active = currently served; retired = decommissioned',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    SPATIAL KEY spx_service_areas_boundary (boundary),
    KEY idx_service_areas_organization_id (organization_id),
    KEY idx_service_areas_site_id (site_id),
    KEY idx_service_areas_status (status),
    CONSTRAINT fk_service_areas_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_service_areas_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
