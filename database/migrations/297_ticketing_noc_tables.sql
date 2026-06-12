-- =============================================================================
-- Migration 297: Ticketing extensions and work order tables — §12
-- =============================================================================
-- New tables: ticket_time_logs, ticket_relations, ticket_ai_triage,
--             work_orders, work_order_materials, technician_gps_breadcrumbs
-- Column add: tickets.source (INFORMATION_SCHEMA guard)
-- =============================================================================

-- Add source column to tickets via INFORMATION_SCHEMA guard
DROP PROCEDURE IF EXISTS migrate_297;
DELIMITER ;;
CREATE PROCEDURE migrate_297()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND COLUMN_NAME = 'source'
  ) THEN
    ALTER TABLE tickets
      ADD COLUMN source ENUM('manual','alert','portal','ai_escalated') NOT NULL DEFAULT 'manual' AFTER category;
  END IF;
END ;;
DELIMITER ;
CALL migrate_297();
DROP PROCEDURE IF EXISTS migrate_297;

-- ---------------------------------------------------------------------------
-- Table: ticket_time_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_time_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  minutes     INT UNSIGNED    NOT NULL COMMENT 'Duration worked in minutes',
  work_date   DATE            NOT NULL,
  description VARCHAR(500)    NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ttl_ticket (ticket_id),
  KEY idx_ttl_user (user_id),
  KEY idx_ttl_work_date (work_date),
  CONSTRAINT fk_ticket_time_logs_ticket FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ticket_time_logs_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ticket_relations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_relations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id_a     BIGINT UNSIGNED NOT NULL,
  ticket_id_b     BIGINT UNSIGNED NOT NULL,
  relation_type   ENUM('duplicate','related','blocks','blocked_by') NOT NULL DEFAULT 'related',
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_relations_pair (ticket_id_a, ticket_id_b, relation_type),
  KEY idx_tr_ticket_a (ticket_id_a),
  KEY idx_tr_ticket_b (ticket_id_b),
  CONSTRAINT fk_ticket_relations_ticket_a FOREIGN KEY (ticket_id_a)
    REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ticket_relations_ticket_b FOREIGN KEY (ticket_id_b)
    REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ticket_ai_triage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_ai_triage (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id            BIGINT UNSIGNED NOT NULL,
  suggested_category   VARCHAR(100)    NULL,
  suggested_priority   ENUM('low','medium','high','critical') NULL,
  suggested_resolution TEXT            NULL,
  kb_article_ids       JSON            NULL COMMENT 'Array of recommended KB article IDs',
  context_snapshot     JSON            NULL COMMENT 'Redacted context used during triage',
  processed_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_ai_triage_ticket (ticket_id),
  CONSTRAINT fk_ticket_ai_triage_ticket FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: work_orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_orders (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  ticket_id       BIGINT UNSIGNED NULL     COMMENT 'Source ticket (may be NULL for standalone work orders)',
  assigned_to     BIGINT UNSIGNED NULL     COMMENT 'Technician assigned to this work order',
  created_by      BIGINT UNSIGNED NULL     COMMENT 'User who created the work order',
  title           VARCHAR(255)    NOT NULL,
  description     TEXT            NULL,
  status          ENUM('pending','assigned','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
  priority        ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  scheduled_at    DATETIME        NULL     COMMENT 'Planned visit datetime',
  started_at      DATETIME        NULL,
  completed_at    DATETIME        NULL,
  latitude        DECIMAL(10,7)   NULL     COMMENT 'Job site GPS latitude',
  longitude       DECIMAL(10,7)   NULL     COMMENT 'Job site GPS longitude',
  address         VARCHAR(500)    NULL,
  notes           TEXT            NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME        NULL,
  PRIMARY KEY (id),
  KEY idx_wo_organization (organization_id),
  KEY idx_wo_ticket (ticket_id),
  KEY idx_wo_assigned (assigned_to),
  KEY idx_wo_status (status),
  KEY idx_wo_scheduled (scheduled_at),
  KEY idx_wo_deleted (deleted_at),
  CONSTRAINT fk_work_orders_organization FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_work_orders_ticket FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_work_orders_assigned_to FOREIGN KEY (assigned_to)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_work_orders_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: work_order_materials
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_order_materials (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  work_order_id  BIGINT UNSIGNED NOT NULL,
  item_name      VARCHAR(255)    NOT NULL,
  quantity       DECIMAL(10,3)   NOT NULL DEFAULT 1,
  unit           VARCHAR(50)     NULL     COMMENT 'e.g. pcs, m, kg',
  unit_cost      DECIMAL(12,4)   NULL,
  notes          VARCHAR(500)    NULL,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wom_work_order (work_order_id),
  CONSTRAINT fk_work_order_materials_work_order FOREIGN KEY (work_order_id)
    REFERENCES work_orders (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: technician_gps_breadcrumbs (no FKs — append-only write-hot)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technician_gps_breadcrumbs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL COMMENT 'Technician user ID (no FK — append-only)',
  latitude    DECIMAL(10,7)   NOT NULL,
  longitude   DECIMAL(10,7)   NOT NULL,
  accuracy_m  FLOAT           NULL     COMMENT 'GPS horizontal accuracy in metres',
  recorded_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tgb_user (user_id),
  KEY idx_tgb_recorded (recorded_at),
  KEY idx_tgb_user_recorded (user_id, recorded_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
