-- =============================================================================
-- Migration 337 — §18.1 Batch subscriber operations: batch_jobs + items
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: batch_jobs
-- Purpose: Batch operations across many subscribers (suspend, rate-limit, notify).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_jobs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    name                VARCHAR(255)    NOT NULL,
    operation           ENUM('suspend','unsuspend','rate_limit','send_notification','apply_tag','remove_tag','change_plan','send_email','send_sms')
                            NOT NULL,
    filter_criteria     JSON            NOT NULL COMMENT 'Criteria to select target subscribers/contracts',
    operation_params    JSON            NULL     COMMENT 'Operation-specific parameters (e.g. notification text, rate limit values)',
    status              ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
    total_items         INT UNSIGNED    NOT NULL DEFAULT 0,
    processed_items     INT UNSIGNED    NOT NULL DEFAULT 0,
    success_items       INT UNSIGNED    NOT NULL DEFAULT 0,
    failed_items        INT UNSIGNED    NOT NULL DEFAULT 0,
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    created_by          BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_batch_jobs_org (organization_id),
    KEY idx_batch_jobs_status (status),
    KEY idx_batch_jobs_operation (operation),
    KEY idx_batch_jobs_created_at (created_at),
    CONSTRAINT fk_batch_jobs_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_batch_jobs_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Batch subscriber operations: suspend/notify/rate-limit across many contracts (§18.1)';

-- ---------------------------------------------------------------------------
-- Table: batch_job_items
-- Purpose: Per-subscriber/contract result record for each batch job.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_job_items (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    batch_job_id        BIGINT UNSIGNED NOT NULL,
    organization_id     BIGINT UNSIGNED NOT NULL,
    entity_type         ENUM('contract','client','device') NOT NULL DEFAULT 'contract',
    entity_id           BIGINT UNSIGNED NOT NULL,
    status              ENUM('pending','success','failure','skipped') NOT NULL DEFAULT 'pending',
    result_message      VARCHAR(500)    NULL,
    processed_at        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_batch_job_items_job (batch_job_id),
    KEY idx_batch_job_items_org (organization_id),
    KEY idx_batch_job_items_status (status),
    KEY idx_batch_job_items_entity (entity_type, entity_id),
    CONSTRAINT fk_batch_job_items_job FOREIGN KEY (batch_job_id)
        REFERENCES batch_jobs (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_batch_job_items_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-entity result records for batch_jobs (§18.1)';
