-- =============================================================================
-- Migration 351 — §21.2 AI Customer Support: conversations + messages
-- Tables: support_conversations, support_messages
-- =============================================================================

CREATE TABLE IF NOT EXISTS support_conversations (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NOT NULL,
  client_id           BIGINT UNSIGNED NOT NULL,
  channel             VARCHAR(30)     NOT NULL DEFAULT 'web',
  status              ENUM('open','escalated','closed') NOT NULL DEFAULT 'open',
  intent              VARCHAR(50)     NULL,
  confidence          DECIMAL(4,3)    NULL,
  escalation_reason   VARCHAR(255)    NULL,
  escalated_at        DATETIME        NULL,
  ticket_id           BIGINT UNSIGNED NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sc_org      (organization_id),
  KEY idx_sc_client   (client_id),
  KEY idx_sc_status   (status),
  KEY idx_sc_ticket   (ticket_id),
  CONSTRAINT fk_sc_org    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_sc_client FOREIGN KEY (client_id)       REFERENCES clients       (id) ON DELETE CASCADE,
  CONSTRAINT fk_sc_ticket FOREIGN KEY (ticket_id)       REFERENCES tickets       (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  role            ENUM('customer','assistant','system') NOT NULL,
  content         TEXT            NOT NULL,
  intent          VARCHAR(50)     NULL,
  confidence      DECIMAL(4,3)    NULL,
  data_sources    JSON            NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_smsg_conv    (conversation_id),
  KEY idx_smsg_created (created_at),
  CONSTRAINT fk_sm_conversation FOREIGN KEY (conversation_id) REFERENCES support_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
