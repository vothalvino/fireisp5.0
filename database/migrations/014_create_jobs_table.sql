-- Migration: 014_create_jobs_table
-- Description: Creates the jobs (work orders) table for field service management

CREATE TABLE IF NOT EXISTS jobs (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id      BIGINT UNSIGNED NOT NULL,
    site_id        BIGINT UNSIGNED NULL,
    assigned_to    BIGINT UNSIGNED NULL,
    title          VARCHAR(255)    NOT NULL,
    description    TEXT            NULL,
    type           ENUM('installation', 'maintenance', 'repair', 'survey', 'other')
                                   NOT NULL DEFAULT 'other',
    priority       ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
    status         ENUM('scheduled', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
    scheduled_date DATETIME        NULL,
    completed_date DATETIME        NULL,
    notes          TEXT            NULL,
    created_by     BIGINT UNSIGNED NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_jobs_client_id (client_id),
    KEY idx_jobs_site_id (site_id),
    KEY idx_jobs_assigned_to (assigned_to),
    KEY idx_jobs_status (status),
    KEY idx_jobs_scheduled_date (scheduled_date),
    CONSTRAINT fk_jobs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_jobs_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_jobs_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_jobs_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
