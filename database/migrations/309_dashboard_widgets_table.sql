-- =============================================================================
-- Migration 309: Dashboard widgets table — §15.5
-- =============================================================================

CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED NOT NULL  COMMENT 'Widget belongs to this user',
    organization_id BIGINT UNSIGNED NOT NULL,
    widget_type     ENUM(
                        'revenue_chart','subscriber_count','arpu_kpi',
                        'aging_summary','bandwidth_utilization','alert_count',
                        'uptime_chart','top_consumers','cash_flow','churn_rate',
                        'custom_query','network_health','pon_utilization'
                    ) NOT NULL DEFAULT 'revenue_chart',
    title           VARCHAR(100)    NOT NULL,
    position_x      INT UNSIGNED    NOT NULL DEFAULT 0,
    position_y      INT UNSIGNED    NOT NULL DEFAULT 0,
    width           INT UNSIGNED    NOT NULL DEFAULT 2,
    height          INT UNSIGNED    NOT NULL DEFAULT 2,
    config          JSON            NULL      COMMENT 'Widget-specific configuration (period, filters, etc.)',
    is_visible      TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_dash_widgets_user (user_id),
    KEY idx_dash_widgets_org (organization_id),
    KEY idx_dash_widgets_visible (is_visible),
    CONSTRAINT fk_dash_widgets_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dash_widgets_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-user dashboard widget layout (§15.5)';
