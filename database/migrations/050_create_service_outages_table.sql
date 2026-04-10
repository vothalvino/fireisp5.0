-- Migration: 050_create_service_outages_table
-- Description: Planned and unplanned outage log. Tracks outages per site and/or
--              device with start/end times, affected client count, root cause,
--              and resolution status. Feeds into SLA reporting and can trigger
--              auto-generation of credit notes for service_outage reason.

CREATE TABLE IF NOT EXISTS service_outages (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    site_id                 BIGINT UNSIGNED  NULL     COMMENT 'Affected site; NULL if device-level only',
    device_id               BIGINT UNSIGNED  NULL     COMMENT 'Affected device; NULL if site-wide',
    outage_type             ENUM('planned', 'unplanned') NOT NULL DEFAULT 'unplanned',
    title                   VARCHAR(255)     NOT NULL,
    description             TEXT             NULL,
    severity                ENUM('minor', 'major', 'critical') NOT NULL DEFAULT 'major',
    started_at              TIMESTAMP        NOT NULL,
    resolved_at             TIMESTAMP        NULL,
    affected_clients_count  INT UNSIGNED     NULL,
    root_cause              TEXT             NULL,
    status                  ENUM('ongoing', 'resolved', 'post_mortem') NOT NULL DEFAULT 'ongoing',
    created_by              BIGINT UNSIGNED  NULL     COMMENT 'User who logged the outage; NULL = system',
    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_service_outages_site_id (site_id),
    KEY idx_service_outages_device_id (device_id),
    KEY idx_service_outages_status (status),
    KEY idx_service_outages_started_at (started_at),
    CONSTRAINT fk_service_outages_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_service_outages_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_service_outages_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
