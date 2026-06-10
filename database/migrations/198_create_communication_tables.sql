-- =============================================================================
-- Migration 198: Communication tables (campaigns, per-recipient messages,
--                and customer DND preferences)
-- =============================================================================
-- Implements isp-platform-features.md §1.4 "Communication":
--   • communication_campaigns  — bulk campaign sends (email/SMS/WhatsApp to a
--                                filtered customer set); tracks aggregate stats
--                                (sent, delivered, opened, bounced, failed)
--   • campaign_messages        — per-recipient record for every campaign
--                                dispatch; enables individual delivery tracking
--                                and provider webhook correlation
--   • client_dnd_preferences   — per-customer per-channel Do Not Disturb
--                                preferences (opt-out flag + quiet hours)
--
-- Also alters email_logs and sms_logs to add campaign_message_id so individual
-- sends can be correlated back to their campaign message row, and opened_at
-- for email open-tracking.
--
-- Seeds the campaign_send scheduled task (*/5 * * * *) that processes queued
-- campaign messages and dispatches them via the appropriate provider.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: communication_campaigns — bulk campaign definition and aggregate stats
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_campaigns (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED NULL
                         COMMENT 'Tenant organization; NULL = single-tenant deployment',
    name             VARCHAR(200)    NOT NULL COMMENT 'Human-readable campaign name',
    channel          ENUM('email','sms','whatsapp')
                         NOT NULL COMMENT 'Dispatch channel for this campaign',
    status           ENUM('draft','scheduled','sending','sent','cancelled','failed')
                         NOT NULL DEFAULT 'draft',
    template_id      BIGINT UNSIGNED NULL
                         COMMENT 'Message template used to render individual messages',
    filter_status    VARCHAR(50)     NULL
                         COMMENT 'Filter recipients by client status (e.g. active, suspended)',
    filter_plan_id   BIGINT UNSIGNED NULL
                         COMMENT 'Filter by plan id (optional)',
    filter_tag       VARCHAR(100)    NULL
                         COMMENT 'Filter by client tag/group label',
    recipient_count  INT UNSIGNED    NOT NULL DEFAULT 0
                         COMMENT 'Total recipients at dispatch time',
    sent_count       INT UNSIGNED    NOT NULL DEFAULT 0,
    delivered_count  INT UNSIGNED    NOT NULL DEFAULT 0,
    opened_count     INT UNSIGNED    NOT NULL DEFAULT 0,
    bounced_count    INT UNSIGNED    NOT NULL DEFAULT 0,
    failed_count     INT UNSIGNED    NOT NULL DEFAULT 0,
    scheduled_at     DATETIME        NULL,
    started_at       DATETIME        NULL,
    completed_at     DATETIME        NULL,
    notes            TEXT            NULL,
    created_by       BIGINT UNSIGNED NULL
                         COMMENT 'Staff member (users.id) who created the campaign',
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at       DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_communication_campaigns_organization_id (organization_id),
    KEY idx_communication_campaigns_status (status),
    KEY idx_communication_campaigns_channel (channel),
    KEY idx_communication_campaigns_template_id (template_id),
    KEY idx_communication_campaigns_deleted_at (deleted_at),
    CONSTRAINT fk_communication_campaigns_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_communication_campaigns_template FOREIGN KEY (template_id)
        REFERENCES message_templates (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_communication_campaigns_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: campaign_messages — per-recipient message records for a campaign
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_messages (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED NULL
                             COMMENT 'Tenant organization; NULL = single-tenant deployment',
    campaign_id          BIGINT UNSIGNED NOT NULL,
    client_id            BIGINT UNSIGNED NULL,
    recipient            VARCHAR(320)    NOT NULL
                             COMMENT 'Email address or phone number',
    channel              ENUM('email','sms','whatsapp')
                             NOT NULL,
    status               ENUM('queued','sent','delivered','opened','bounced','failed')
                             NOT NULL DEFAULT 'queued',
    provider_message_id  VARCHAR(200)    NULL
                             COMMENT 'Provider-assigned message SID/ID',
    error_message        TEXT            NULL,
    queued_at            DATETIME        NULL DEFAULT NULL,
    sent_at              DATETIME        NULL DEFAULT NULL,
    delivered_at         DATETIME        NULL DEFAULT NULL,
    opened_at            DATETIME        NULL DEFAULT NULL,
    bounced_at           DATETIME        NULL DEFAULT NULL,
    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_campaign_messages_organization_id (organization_id),
    KEY idx_campaign_messages_campaign_status (campaign_id, status),
    KEY idx_campaign_messages_client_id (client_id),
    KEY idx_campaign_messages_provider_message_id (provider_message_id),
    KEY idx_campaign_messages_status (status),
    CONSTRAINT fk_campaign_messages_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_campaign_messages_campaign FOREIGN KEY (campaign_id)
        REFERENCES communication_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_campaign_messages_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: client_dnd_preferences — per-customer per-channel Do Not Disturb
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_dnd_preferences (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id    BIGINT UNSIGNED NULL
                           COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id          BIGINT UNSIGNED NOT NULL,
    channel            ENUM('email','sms','whatsapp','all')
                           NOT NULL DEFAULT 'all',
    opt_out            TINYINT(1)      NOT NULL DEFAULT 0
                           COMMENT '1 = opted out from marketing/bulk sends',
    quiet_hours_start  TIME            NULL
                           COMMENT 'Local time quiet window start (e.g. 22:00:00)',
    quiet_hours_end    TIME            NULL
                           COMMENT 'Local time quiet window end (e.g. 08:00:00)',
    reason             VARCHAR(300)    NULL
                           COMMENT 'Why opt-out was set',
    created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_client_channel (client_id, channel),
    KEY idx_client_dnd_preferences_organization_id (organization_id),
    KEY idx_client_dnd_preferences_client_id (client_id),
    KEY idx_client_dnd_preferences_opt_out (opt_out),
    CONSTRAINT fk_client_dnd_preferences_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_client_dnd_preferences_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Alter email_logs (campaign_message_id, opened_at) and sms_logs
-- (campaign_message_id). MySQL does not support ADD COLUMN IF NOT EXISTS, so
-- use an idempotent stored-procedure guard (same pattern as migration 136).
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_198_alter_message_logs;
DELIMITER //
CREATE PROCEDURE migration_198_alter_message_logs()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_logs' AND COLUMN_NAME = 'campaign_message_id'
  ) THEN
    ALTER TABLE email_logs
      ADD COLUMN campaign_message_id BIGINT UNSIGNED NULL AFTER template_id,
      ADD KEY idx_email_logs_campaign_message (campaign_message_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_logs' AND COLUMN_NAME = 'opened_at'
  ) THEN
    ALTER TABLE email_logs
      ADD COLUMN opened_at DATETIME NULL AFTER sent_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_logs' AND COLUMN_NAME = 'campaign_message_id'
  ) THEN
    ALTER TABLE sms_logs
      ADD COLUMN campaign_message_id BIGINT UNSIGNED NULL AFTER template_id,
      ADD KEY idx_sms_logs_campaign_message (campaign_message_id);
  END IF;
END //
DELIMITER ;
CALL migration_198_alter_message_logs();
DROP PROCEDURE IF EXISTS migration_198_alter_message_logs;

-- ---------------------------------------------------------------------------
-- Seed: scheduled task driving the campaign dispatch worker
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES
    (NULL,
     'campaign_send',
     'Process queued campaign messages and dispatch them via email/SMS/WhatsApp',
     '*/5 * * * *',
     TRUE,
     'normal');
