-- =============================================================================
-- Migration 288: Rate Limiting Tables — §10.2
-- =============================================================================
-- Implements isp-platform-features.md §10.2 "Rate Limiting":
--   Per-protocol/port shaping rules (torrent throttling etc.),
--   and rate limit templates per service type.
--
-- Tables created:
--   rate_limit_templates     — Named rate-limit templates per service type
--   protocol_shaping_rules   — Per-protocol/port traffic shaping rules
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: rate_limit_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_templates (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id      BIGINT UNSIGNED NULL,
  name                 VARCHAR(100) NOT NULL,
  description          TEXT NULL,
  service_type         ENUM('pppoe','dhcp','hotspot','static','other') NOT NULL DEFAULT 'pppoe'
                         COMMENT 'Service type this template applies to',
  radius_vendor        ENUM('mikrotik','cisco','juniper','generic') NOT NULL DEFAULT 'mikrotik',
  download_mbps        INT UNSIGNED NOT NULL COMMENT 'Committed information rate download',
  upload_mbps          INT UNSIGNED NOT NULL COMMENT 'Committed information rate upload',
  burst_download_mbps  INT UNSIGNED NULL,
  burst_upload_mbps    INT UNSIGNED NULL,
  burst_threshold_mbps INT UNSIGNED NULL
                         COMMENT 'MikroTik burst-threshold; burst active when avg < threshold',
  burst_time_seconds   TINYINT UNSIGNED NULL
                         COMMENT 'MikroTik burst-time window in seconds',
  rate_string          VARCHAR(255) NULL
                         COMMENT 'Cached/rendered vendor rate string; regenerated on save',
  priority             TINYINT UNSIGNED NOT NULL DEFAULT 4
                         COMMENT 'Queue priority 1 (highest) to 8 (lowest)',
  status               ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_rlt_org (organization_id),
  KEY idx_rlt_service_type (service_type),
  KEY idx_rlt_status (status),
  KEY idx_rlt_deleted (deleted_at),
  CONSTRAINT fk_rlt_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: protocol_shaping_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protocol_shaping_rules (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NULL,
  plan_id             BIGINT UNSIGNED NULL
                        COMMENT 'When set, rule applies only to this plan; NULL = global org rule',
  name                VARCHAR(100) NOT NULL,
  description         TEXT NULL,
  protocol            ENUM('tcp','udp','icmp','any') NOT NULL DEFAULT 'tcp',
  direction           ENUM('download','upload','both') NOT NULL DEFAULT 'both',
  dst_port_range      VARCHAR(100) NULL
                        COMMENT 'Destination port range (e.g. "6881-6889" for BitTorrent, "80,443" for HTTP/S); NULL = any port',
  src_port_range      VARCHAR(100) NULL
                        COMMENT 'Source port range; NULL = any',
  l7_pattern          VARCHAR(255) NULL
                        COMMENT 'Optional Layer-7 pattern name (references MikroTik l7 protocol name)',
  action              ENUM('limit','drop','mark','throttle') NOT NULL DEFAULT 'limit'
                        COMMENT 'Action: limit = rate-limit to limit_mbps; drop = block; mark = just DSCP mark; throttle = same as limit',
  limit_download_mbps INT UNSIGNED NULL
                        COMMENT 'Rate limit download when action = limit/throttle; NULL = no limit',
  limit_upload_mbps   INT UNSIGNED NULL
                        COMMENT 'Rate limit upload when action = limit/throttle; NULL = no limit',
  dscp_mark           VARCHAR(20) NULL
                        COMMENT 'DSCP mark to apply to matched traffic (e.g. CS1, AF11)',
  priority            TINYINT UNSIGNED NOT NULL DEFAULT 5
                        COMMENT 'Rule priority: lower = evaluated first',
  enabled             TINYINT(1) NOT NULL DEFAULT 1,
  preset              VARCHAR(50) NULL
                        COMMENT 'Optional preset identifier (e.g. "bittorrent_throttle", "voip_priority")',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_psr_org (organization_id),
  KEY idx_psr_plan (plan_id),
  KEY idx_psr_protocol (protocol),
  KEY idx_psr_enabled (enabled),
  KEY idx_psr_deleted (deleted_at),
  CONSTRAINT fk_psr_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_psr_plan FOREIGN KEY (plan_id)
    REFERENCES plans (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed preset protocol shaping rules (global — organization_id IS NULL, plan_id IS NULL)
-- These are example/template rules; operators copy and customize per org.
-- ---------------------------------------------------------------------------
INSERT INTO protocol_shaping_rules
    (organization_id, plan_id, name, description, protocol, direction,
     dst_port_range, action, limit_download_mbps, limit_upload_mbps,
     dscp_mark, priority, enabled, preset)
SELECT NULL, NULL,
  'BitTorrent Throttle', 'Throttle BitTorrent (ports 6881-6889) to reduce congestion',
  'tcp', 'both', '6881-6889', 'throttle', 5, 2, 'CS1', 5, 0, 'bittorrent_throttle'
FROM DUAL WHERE NOT EXISTS (
    SELECT 1 FROM protocol_shaping_rules WHERE preset = 'bittorrent_throttle' AND organization_id IS NULL
);

INSERT INTO protocol_shaping_rules
    (organization_id, plan_id, name, description, protocol, direction,
     dst_port_range, action, limit_download_mbps, limit_upload_mbps,
     dscp_mark, priority, enabled, preset)
SELECT NULL, NULL,
  'VoIP Priority', 'Mark VoIP traffic (RTP ports 16384-32767) for expedited forwarding',
  'udp', 'both', '16384-32767', 'mark', NULL, NULL, 'EF', 1, 0, 'voip_priority'
FROM DUAL WHERE NOT EXISTS (
    SELECT 1 FROM protocol_shaping_rules WHERE preset = 'voip_priority' AND organization_id IS NULL
);

INSERT INTO protocol_shaping_rules
    (organization_id, plan_id, name, description, protocol, direction,
     dst_port_range, action, limit_download_mbps, limit_upload_mbps,
     dscp_mark, priority, enabled, preset)
SELECT NULL, NULL,
  'HTTP/HTTPS Priority', 'Mark HTTP/HTTPS traffic with medium priority',
  'tcp', 'both', '80,443', 'mark', NULL, NULL, 'AF21', 3, 0, 'http_priority'
FROM DUAL WHERE NOT EXISTS (
    SELECT 1 FROM protocol_shaping_rules WHERE preset = 'http_priority' AND organization_id IS NULL
);
