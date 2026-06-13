-- =============================================================================
-- Migration 338 — §18.1 Auto-provisioning pipeline
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: provisioning_pipelines
-- Purpose: Auto-provisioning pipeline runs: order → assign IP → configure → activate → notify.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provisioning_pipelines (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    name                VARCHAR(255)    NOT NULL,
    contract_id         BIGINT UNSIGNED NULL     COMMENT 'Target contract being provisioned',
    client_id           BIGINT UNSIGNED NULL     COMMENT 'Target client',
    status              ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
    current_stage       VARCHAR(100)    NULL     COMMENT 'Name of the stage currently executing',
    stages_config       JSON            NULL     COMMENT 'Ordered array of stage definitions',
    stages_results      JSON            NULL     COMMENT 'Results keyed by stage name',
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    error_message       TEXT            NULL,
    triggered_by        BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_prov_pipelines_org (organization_id),
    KEY idx_prov_pipelines_contract (contract_id),
    KEY idx_prov_pipelines_status (status),
    KEY idx_prov_pipelines_created_at (created_at),
    CONSTRAINT fk_prov_pipelines_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_prov_pipelines_triggered_by FOREIGN KEY (triggered_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Auto-provisioning pipeline runs: order-to-activate workflow (§18.1)';

-- ---------------------------------------------------------------------------
-- Table: provisioning_pipeline_stages
-- Purpose: Per-stage execution record for a provisioning pipeline run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provisioning_pipeline_stages (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pipeline_id         BIGINT UNSIGNED NOT NULL,
    organization_id     BIGINT UNSIGNED NOT NULL,
    stage_order         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    stage_name          VARCHAR(100)    NOT NULL COMMENT 'e.g. assign_ip, configure_device, activate_contract, send_notification',
    status              ENUM('pending','running','completed','failed','skipped') NOT NULL DEFAULT 'pending',
    input_data          JSON            NULL,
    output_data         JSON            NULL,
    error_message       TEXT            NULL,
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_prov_stages_pipeline (pipeline_id),
    KEY idx_prov_stages_org (organization_id),
    KEY idx_prov_stages_status (status),
    CONSTRAINT fk_prov_stages_pipeline FOREIGN KEY (pipeline_id)
        REFERENCES provisioning_pipelines (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_prov_stages_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-stage execution records for provisioning_pipelines (§18.1)';
