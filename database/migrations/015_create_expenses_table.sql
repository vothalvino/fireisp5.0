-- Migration: 015_create_expenses_table
-- Description: Creates the expenses table for tracking business and operational costs

CREATE TABLE IF NOT EXISTS expenses (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    job_id       BIGINT UNSIGNED NULL COMMENT 'Related work order, if applicable',
    user_id      BIGINT UNSIGNED NOT NULL COMMENT 'Employee who incurred the expense',
    category     VARCHAR(100)    NOT NULL COMMENT 'e.g. fuel, equipment, labor, parts',
    description  TEXT            NULL,
    amount       DECIMAL(10, 2)  NOT NULL,
    expense_date DATE            NOT NULL,
    receipt_url  VARCHAR(500)    NULL COMMENT 'URL or path to receipt file',
    status       ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    approved_by  BIGINT UNSIGNED NULL,
    notes        TEXT            NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_expenses_job_id (job_id),
    KEY idx_expenses_user_id (user_id),
    KEY idx_expenses_status (status),
    KEY idx_expenses_expense_date (expense_date),
    CONSTRAINT fk_expenses_job FOREIGN KEY (job_id)
        REFERENCES jobs (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_expenses_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_expenses_approved_by FOREIGN KEY (approved_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
