-- =============================================================================
-- Migration 295: Customer Self-Service Portal Tables — §11
-- =============================================================================
-- Tables created:
--   portal_service_requests  — plan-upgrade, wifi-pwd, pppoe-pwd, static-ip,
--                              cancellation, visit-schedule requests
--   portal_kb_articles       — knowledge-base / FAQ articles
--   portal_chat_sessions     — AI chatbot conversation sessions
--   portal_push_subscriptions — Web Push (browser notification) subscriptions
-- =============================================================================

SET FOREIGN_KEY_CHECKS=0;

-- ---------------------------------------------------------------------------
-- 1. portal_service_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_service_requests (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  client_id       BIGINT UNSIGNED NOT NULL,
  contract_id     BIGINT UNSIGNED NULL,
  request_type    ENUM(
                    'plan_upgrade',
                    'wifi_password_change',
                    'pppoe_password_change',
                    'static_ip_request',
                    'cancellation',
                    'visit_schedule'
                  ) NOT NULL,
  status          ENUM('pending','approved','rejected','completed','cancelled')
                  NOT NULL DEFAULT 'pending',
  payload         JSON NULL COMMENT 'Request parameters (new_plan_id, new_password, preferred_date, etc.)',
  notes           TEXT NULL COMMENT 'Admin notes on approval/rejection',
  approved_by     BIGINT UNSIGNED NULL COMMENT 'User id of approving admin',
  approved_at     DATETIME NULL,
  completed_at    DATETIME NULL,
  cancelled_at    DATETIME NULL,
  proration_credit   DECIMAL(10,2) NULL COMMENT 'Credit for unused days (plan upgrade)',
  proration_charge   DECIMAL(10,2) NULL COMMENT 'Charge for remaining days on new plan',
  proration_net      DECIMAL(10,2) NULL COMMENT 'Net proration amount (charge - credit)',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_psr_org (organization_id),
  KEY idx_psr_client (client_id),
  KEY idx_psr_contract (contract_id),
  KEY idx_psr_type (request_type),
  KEY idx_psr_status (status),
  KEY idx_psr_deleted (deleted_at),
  CONSTRAINT fk_portal_sr_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_portal_sr_client FOREIGN KEY (client_id)
    REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. portal_kb_articles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_kb_articles (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  category        VARCHAR(100) NOT NULL DEFAULT 'general'
                    COMMENT 'e.g. billing, connectivity, account, plans',
  title           VARCHAR(300) NOT NULL,
  slug            VARCHAR(320) NOT NULL,
  body            LONGTEXT NOT NULL COMMENT 'Markdown or HTML article body',
  is_published    TINYINT(1) NOT NULL DEFAULT 1,
  view_count      INT UNSIGNED NOT NULL DEFAULT 0,
  helpful_yes     INT UNSIGNED NOT NULL DEFAULT 0,
  helpful_no      INT UNSIGNED NOT NULL DEFAULT 0,
  created_by      BIGINT UNSIGNED NULL COMMENT 'Admin user id',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kb_org_slug (organization_id, slug),
  KEY idx_kb_org (organization_id),
  KEY idx_kb_category (category),
  KEY idx_kb_published (is_published),
  KEY idx_kb_deleted (deleted_at),
  CONSTRAINT fk_kb_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. portal_chat_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_chat_sessions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  client_id       BIGINT UNSIGNED NOT NULL,
  session_token   VARCHAR(64) NOT NULL COMMENT 'Opaque handle returned to client',
  messages        JSON NOT NULL DEFAULT (JSON_ARRAY())
                    COMMENT 'Array of {role, content, ts} objects',
  status          ENUM('active','resolved','escalated') NOT NULL DEFAULT 'active',
  ticket_id       BIGINT UNSIGNED NULL COMMENT 'Set when AI escalates to human ticket',
  ai_reply_log_id BIGINT UNSIGNED NULL COMMENT 'Last AiReplyLog id for audit',
  turn_count      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pcs_token (session_token),
  KEY idx_pcs_client (client_id),
  KEY idx_pcs_org (organization_id),
  KEY idx_pcs_status (status),
  CONSTRAINT fk_pcs_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_pcs_client FOREIGN KEY (client_id)
    REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. portal_push_subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_push_subscriptions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  client_id       BIGINT UNSIGNED NOT NULL,
  endpoint        VARCHAR(2048) NOT NULL COMMENT 'Web Push endpoint URL',
  p256dh          VARCHAR(512) NOT NULL COMMENT 'Client ECDH public key (base64url)',
  auth            VARCHAR(256) NOT NULL COMMENT 'Auth secret (base64url)',
  user_agent      VARCHAR(255) NULL,
  notify_outage   TINYINT(1) NOT NULL DEFAULT 1,
  notify_billing  TINYINT(1) NOT NULL DEFAULT 1,
  notify_ticket   TINYINT(1) NOT NULL DEFAULT 1,
  last_sent_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_pps_client (client_id),
  KEY idx_pps_org (organization_id),
  KEY idx_pps_deleted (deleted_at),
  CONSTRAINT fk_pps_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_pps_client FOREIGN KEY (client_id)
    REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
