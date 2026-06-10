-- =============================================================================
-- Migration 193: Customer Lifecycle tables (leads, service orders, onboarding
--                checklist, win-back campaigns)
-- =============================================================================
-- Implements isp-platform-features.md §1.2 "Customer Lifecycle":
--   • leads                — lead capture and prospect pipeline
--   • service_orders       — service order workflow:
--                            requested → approved → provisioning → activated
--   • service_order_tasks  — customer onboarding checklist (contract signed,
--                            payment method verified, equipment received, …)
--   • winback_campaigns    — win-back campaigns for cancelled customers
--
-- The service-order status machine is enforced in the application layer
-- (lifecycleService) rather than a DB trigger, so failed transitions surface
-- as friendly API errors and remain easy to unit-test.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: leads — prospect pipeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL
                            COMMENT 'Tenant organization; NULL = single-tenant deployment',
    name                VARCHAR(200)    NOT NULL COMMENT 'Prospect name',
    email               VARCHAR(255)    NULL,
    phone               VARCHAR(30)     NULL,
    company             VARCHAR(200)    NULL,
    source              ENUM('website','referral','phone','walk_in','social','campaign','other')
                            NOT NULL DEFAULT 'other' COMMENT 'How the lead was captured',
    status              ENUM('new','contacted','qualified','proposal','won','lost')
                            NOT NULL DEFAULT 'new' COMMENT 'Pipeline stage',
    estimated_value     DECIMAL(12,2)   NULL COMMENT 'Estimated monthly/contract value',
    currency            CHAR(3)         NULL,
    assigned_to         BIGINT UNSIGNED NULL COMMENT 'Sales agent (users.id) owning this lead',
    address             VARCHAR(500)    NULL,
    city                VARCHAR(100)    NULL,
    state               VARCHAR(100)    NULL,
    zip_code            VARCHAR(20)     NULL,
    latitude            DECIMAL(10,7)   NULL,
    longitude           DECIMAL(10,7)   NULL,
    notes               TEXT            NULL,
    converted_client_id BIGINT UNSIGNED NULL COMMENT 'Client created when this lead was won/converted',
    converted_at        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_leads_organization_id (organization_id),
    KEY idx_leads_status (status),
    KEY idx_leads_assigned_to (assigned_to),
    KEY idx_leads_converted_client_id (converted_client_id),
    KEY idx_leads_deleted_at (deleted_at),
    CONSTRAINT fk_leads_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_leads_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_leads_converted_client FOREIGN KEY (converted_client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: service_orders — request → approval → provisioning → activation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_orders (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL
                        COMMENT 'Tenant organization; NULL = single-tenant deployment',
    order_number    VARCHAR(40)     NOT NULL COMMENT 'Human-readable order reference (e.g. SO-000123)',
    client_id       BIGINT UNSIGNED NULL COMMENT 'Existing client this order is for (NULL for prospects)',
    lead_id         BIGINT UNSIGNED NULL COMMENT 'Originating lead, when the order came from the pipeline',
    plan_id         BIGINT UNSIGNED NULL COMMENT 'Requested service plan',
    contract_id     BIGINT UNSIGNED NULL COMMENT 'Contract created/linked when the order is activated',
    order_type      ENUM('new_install','upgrade','downgrade','relocation','reconnect')
                        NOT NULL DEFAULT 'new_install',
    status          ENUM('requested','approved','provisioning','activated','cancelled')
                        NOT NULL DEFAULT 'requested',
    assigned_to     BIGINT UNSIGNED NULL COMMENT 'Technician/agent (users.id) handling the order',
    address         VARCHAR(500)    NULL,
    notes           TEXT            NULL,
    requested_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at     DATETIME        NULL,
    approved_by     BIGINT UNSIGNED NULL,
    activated_at    DATETIME        NULL,
    cancelled_at    DATETIME        NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_service_orders_org_number (organization_id, order_number),
    KEY idx_service_orders_organization_id (organization_id),
    KEY idx_service_orders_client_id (client_id),
    KEY idx_service_orders_lead_id (lead_id),
    KEY idx_service_orders_status (status),
    KEY idx_service_orders_deleted_at (deleted_at),
    CONSTRAINT fk_service_orders_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_service_orders_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_service_orders_lead FOREIGN KEY (lead_id)
        REFERENCES leads (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_service_orders_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_service_orders_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_service_orders_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_service_orders_approved_by FOREIGN KEY (approved_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: service_order_tasks — onboarding checklist items per order
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_order_tasks (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_order_id BIGINT UNSIGNED NOT NULL,
    task_key         VARCHAR(60)     NOT NULL
                         COMMENT 'Checklist key, e.g. contract_signed, payment_verified, equipment_received',
    label            VARCHAR(200)    NOT NULL COMMENT 'Human-readable checklist label',
    is_done          TINYINT(1)      NOT NULL DEFAULT 0,
    completed_at     DATETIME        NULL,
    completed_by     BIGINT UNSIGNED NULL,
    sort_order       INT             NOT NULL DEFAULT 0,
    notes            TEXT            NULL,
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_service_order_tasks_order_key (service_order_id, task_key),
    KEY idx_service_order_tasks_order_id (service_order_id),
    CONSTRAINT fk_service_order_tasks_order FOREIGN KEY (service_order_id)
        REFERENCES service_orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_service_order_tasks_completed_by FOREIGN KEY (completed_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: winback_campaigns — re-engage cancelled customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS winback_campaigns (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL
                            COMMENT 'Tenant organization; NULL = single-tenant deployment',
    name                VARCHAR(200)    NOT NULL,
    status              ENUM('draft','active','paused','completed')
                            NOT NULL DEFAULT 'draft',
    target_segment      ENUM('all_cancelled','cancelled_30d','cancelled_90d','high_value')
                            NOT NULL DEFAULT 'all_cancelled'
                            COMMENT 'Which cancelled-customer cohort this campaign targets',
    offer_description   TEXT            NULL,
    discount_percent    DECIMAL(5,2)    NULL COMMENT 'Retention discount offered (0-100)',
    message_template_id BIGINT UNSIGNED NULL COMMENT 'Message template used for outreach',
    start_date          DATE            NULL,
    end_date            DATE            NULL,
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_winback_campaigns_organization_id (organization_id),
    KEY idx_winback_campaigns_status (status),
    KEY idx_winback_campaigns_deleted_at (deleted_at),
    CONSTRAINT fk_winback_campaigns_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_winback_campaigns_template FOREIGN KEY (message_template_id)
        REFERENCES message_templates (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
