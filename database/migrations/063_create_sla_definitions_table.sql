-- Migration: 063_create_sla_definitions_table
-- Description: SLA (Service Level Agreement) definitions linked to plans.
--              Each row captures the uptime guarantee, maximum response and
--              resolution times, compensation rules, and maintenance-window
--              exclusions that form the contractual SLA for a service plan.

CREATE TABLE IF NOT EXISTS sla_definitions (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    plan_id                 BIGINT UNSIGNED  NOT NULL COMMENT 'Plan this SLA applies to',
    name                    VARCHAR(255)     NOT NULL COMMENT 'Human-readable SLA name, e.g. "Gold SLA", "Enterprise 99.99%"',
    description             TEXT             NULL     COMMENT 'Detailed SLA terms and conditions',
    uptime_pct              DECIMAL(5, 2)    NOT NULL DEFAULT 99.00
                                             COMMENT 'Guaranteed uptime percentage over the configured measurement period, e.g. 99.95',
    max_response_minutes    INT UNSIGNED     NULL     COMMENT 'Maximum time to first response after an incident is reported (minutes)',
    max_resolution_minutes  INT UNSIGNED     NULL     COMMENT 'Maximum time to resolve an incident after it is reported (minutes)',
    measurement_period      ENUM('monthly', 'quarterly', 'annual')
                                             NOT NULL DEFAULT 'monthly'
                                             COMMENT 'Period over which uptime is measured',
    compensation_type       ENUM('none', 'credit_percentage', 'credit_fixed', 'service_extension')
                                             NOT NULL DEFAULT 'none'
                                             COMMENT 'Type of compensation when SLA is breached',
    compensation_value      DECIMAL(10, 2)   NULL     COMMENT 'Compensation amount — percentage of monthly fee or fixed currency amount, depending on compensation_type',
    exclude_maintenance     TINYINT(1)       NOT NULL DEFAULT 1
                                             COMMENT '1 = planned maintenance windows are excluded from uptime calculation',
    priority                ENUM('low', 'medium', 'high', 'critical')
                                             NOT NULL DEFAULT 'medium'
                                             COMMENT 'Default incident priority level under this SLA',
    status                  ENUM('active', 'inactive')
                                             NOT NULL DEFAULT 'active',
    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_sla_definitions_plan_id (plan_id),
    KEY idx_sla_definitions_status (status),
    CONSTRAINT fk_sla_definitions_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
