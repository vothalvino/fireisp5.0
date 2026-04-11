-- Migration: 109_create_webhook_deliveries_table
-- Description: Delivery log for outbound webhooks. Records each attempt with
--              HTTP status, response body, response time, retry count, and
--              delivery outcome. Enables redelivery and failure diagnostics.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id                BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    webhook_id        BIGINT UNSIGNED     NOT NULL                    COMMENT 'Webhook registration this delivery belongs to',
    event_name        VARCHAR(100)        NOT NULL                    COMMENT 'Event type that triggered this delivery, e.g. "invoice.created"',
    payload           JSON                NOT NULL                    COMMENT 'Full event payload sent in the request body',
    http_status_code  SMALLINT UNSIGNED   NULL                        COMMENT 'HTTP status code returned by the target endpoint',
    response_body     TEXT                NULL                        COMMENT 'Response body from the target endpoint (truncated if large)',
    response_time_ms  INT UNSIGNED        NULL                        COMMENT 'Round-trip HTTP request time in milliseconds',
    attempt_number    TINYINT UNSIGNED    NOT NULL DEFAULT 1          COMMENT 'Which attempt this row represents (1 = first try)',
    status            ENUM('pending','success','failed','retrying')
                                          NOT NULL DEFAULT 'pending'  COMMENT 'Delivery outcome status',
    next_retry_at     TIMESTAMP           NULL                        COMMENT 'Scheduled time for the next retry attempt; NULL = no retry pending',
    delivered_at      TIMESTAMP           NULL                        COMMENT 'Timestamp of a successful delivery; NULL if not yet succeeded',
    created_at        TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_webhook_deliveries_webhook_id (webhook_id),
    KEY idx_webhook_deliveries_event_name (event_name),
    KEY idx_webhook_deliveries_status (status),
    KEY idx_webhook_deliveries_next_retry_at (next_retry_at),
    CONSTRAINT fk_webhook_deliveries_webhook FOREIGN KEY (webhook_id)
        REFERENCES webhooks (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
