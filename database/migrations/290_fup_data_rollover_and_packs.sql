-- =============================================================================
-- Migration 290: FUP data rollover balances, data packs catalog, purchases,
--                and usage notifications — §10.3 FUP/Data Caps enhancements
-- =============================================================================
-- Tables created:
--   data_rollover_balances   — monthly unused-data carry-forward per contract
--   data_packs               — add-on data pack catalog
--   data_pack_purchases      — subscriber data pack activation history
--   fup_usage_notifications  — dedup guard for 80/90/100% usage alerts
-- Scheduled tasks seeded:
--   fup_threshold_notify     — every 15 min, checks and sends threshold alerts
--   rollover_balance_accrue  — monthly (1st), accrues unused data to rollover
-- =============================================================================

SET FOREIGN_KEY_CHECKS=0;

-- ---------------------------------------------------------------------------
-- 1. data_rollover_balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_rollover_balances (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id      BIGINT UNSIGNED NULL,
  contract_id          BIGINT UNSIGNED NOT NULL,
  billing_month        DATE NOT NULL COMMENT 'First day of the month (YYYY-MM-01)',
  rollover_gb          DECIMAL(10,3) NOT NULL DEFAULT 0.000
                         COMMENT 'GB rolled over FROM this month to next',
  consumed_rollover_gb DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rollover_contract_month (contract_id, billing_month),
  KEY idx_drb_org (organization_id),
  KEY idx_drb_contract (contract_id),
  CONSTRAINT fk_drb_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_drb_contract FOREIGN KEY (contract_id)
    REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. data_packs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_packs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NULL,
  data_gb         DECIMAL(10,3) NOT NULL COMMENT 'GB added to subscriber allowance',
  price           DECIMAL(10,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'MXN',
  validity_days   SMALLINT UNSIGNED NOT NULL DEFAULT 30
                    COMMENT 'Days from activation until pack expires',
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_data_packs_org (organization_id),
  KEY idx_data_packs_active (is_active),
  KEY idx_data_packs_deleted (deleted_at),
  CONSTRAINT fk_dp_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. data_pack_purchases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_pack_purchases (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  contract_id     BIGINT UNSIGNED NOT NULL,
  data_pack_id    BIGINT UNSIGNED NOT NULL,
  purchased_by    ENUM('client_portal','admin','api') NOT NULL DEFAULT 'admin',
  purchased_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at    TIMESTAMP NULL,
  expires_at      TIMESTAMP NULL,
  gb_applied      DECIMAL(10,3) NOT NULL
                    COMMENT 'Actual GB applied (from pack at time of purchase)',
  invoice_id      BIGINT UNSIGNED NULL,
  status          ENUM('pending','active','expired','cancelled') NOT NULL DEFAULT 'pending',
  notes           TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dpp_contract (contract_id),
  KEY idx_dpp_data_pack (data_pack_id),
  KEY idx_dpp_status (status),
  KEY idx_dpp_org (organization_id),
  KEY idx_dpp_expires (expires_at),
  CONSTRAINT fk_dpp_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_dpp_contract FOREIGN KEY (contract_id)
    REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_dpp_data_pack FOREIGN KEY (data_pack_id)
    REFERENCES data_packs (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_dpp_invoice FOREIGN KEY (invoice_id)
    REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. fup_usage_notifications (dedup guard for 80/90/100% alerts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fup_usage_notifications (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  contract_id     BIGINT UNSIGNED NOT NULL,
  billing_month   DATE NOT NULL COMMENT 'YYYY-MM-01',
  threshold_pct   TINYINT UNSIGNED NOT NULL COMMENT '80, 90, or 100',
  notified_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  channel         ENUM('email','sms','push') NOT NULL DEFAULT 'email',
  PRIMARY KEY (id),
  UNIQUE KEY uq_fup_notif (contract_id, billing_month, threshold_pct),
  KEY idx_fun_org (organization_id),
  KEY idx_fun_contract (contract_id),
  CONSTRAINT fk_fun_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_fun_contract FOREIGN KEY (contract_id)
    REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Scheduled task: fup_threshold_notify
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks (name, task_type, cron_expression, is_active, priority, description, created_at, updated_at)
SELECT 'fup_threshold_notify', 'notification', '*/15 * * * *', 1, 'normal',
  'Check FUP usage thresholds and send 80/90/100% notifications',
  NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE name = 'fup_threshold_notify'
);

-- ---------------------------------------------------------------------------
-- 6. Scheduled task: rollover_balance_accrue
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks (name, task_type, cron_expression, is_active, priority, description, created_at, updated_at)
SELECT 'rollover_balance_accrue', 'usage_rollup', '0 0 1 * *', 1, 'normal',
  'Monthly: accrue unused data allowance as rollover balance to next month',
  NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE name = 'rollover_balance_accrue'
);

SET FOREIGN_KEY_CHECKS=1;
