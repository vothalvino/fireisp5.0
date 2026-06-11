-- =============================================================================
-- FireISP 5.0 - Combined Database Schema
-- =============================================================================
-- Description : Full schema for FireISP 5.0 ISP management software.
--               Apply this file once to create all tables in order, or run
--               each numbered file in database/migrations/ individually.
-- Database    : MySQL 8.0+ / MariaDB 10.6+
-- Charset     : utf8mb4 / utf8mb4_unicode_ci
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Table: users
-- Purpose: System users and employees (administrators, technicians, billing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this user belongs to; NULL = single-tenant deployment',
    first_name      VARCHAR(100)    NOT NULL,
    last_name       VARCHAR(100)    NOT NULL,
    email           VARCHAR(255)    NOT NULL,
    password_hash   VARCHAR(255)    NOT NULL,
    role            ENUM('admin', 'billing', 'support', 'technician') NOT NULL DEFAULT 'support',
    phone           VARCHAR(30)     NULL,
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    totp_secret     VARCHAR(255)    NULL     COMMENT 'TOTP shared secret (encrypted/base32 at app layer)',
    totp_enabled    BOOLEAN         NOT NULL DEFAULT FALSE COMMENT 'TRUE when 2FA/TOTP is enabled for this user',
    totp_backup_codes JSON          NULL     COMMENT 'JSON array of one-time backup recovery codes for TOTP',
    last_login_at          TIMESTAMP       NULL,
    failed_login_attempts  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Consecutive failed login attempts since last successful login',
    locked_until           TIMESTAMP       NULL DEFAULT NULL   COMMENT 'Account locked until this timestamp; NULL = not locked',
    created_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_organization_id (organization_id),
    KEY idx_users_deleted_at (deleted_at),
    CONSTRAINT fk_users_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: clients
-- Purpose: ISP customer records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this client belongs to; NULL = single-tenant deployment',
    client_group_id BIGINT UNSIGNED NULL     COMMENT 'Family/account group this client belongs to (see client_groups)',
    name            VARCHAR(255)    NOT NULL,
    email           VARCHAR(255)    NULL,
    phone           VARCHAR(30)     NULL,
    client_type     ENUM('personal', 'company', 'residential', 'business', 'corporate', 'government', 'wholesale') NOT NULL DEFAULT 'personal',
    locale          ENUM('global', 'MX') NOT NULL DEFAULT 'global'
                        COMMENT 'Regional compliance switch: global = no country-specific requirements; MX = SAT CFDI 4.0 + IFT/CRT compliance required',
    tax_id          VARCHAR(50)     NULL,
    curp            VARCHAR(18)     NULL COMMENT 'Mexican personal ID (CURP) â€” personal clients only',
    address         VARCHAR(255)    NULL,
    city            VARCHAR(100)    NULL,
    state           VARCHAR(100)    NULL,
    country         VARCHAR(100)    NULL DEFAULT NULL,
    zip_code        VARCHAR(20)     NULL,
    latitude        DECIMAL(10, 8)  NULL     COMMENT 'Service-address latitude (WGS-84) for the map pin / geocoding',
    longitude       DECIMAL(11, 8)  NULL     COMMENT 'Service-address longitude (WGS-84) for the map pin / geocoding',
    geocoded_at     TIMESTAMP       NULL     COMMENT 'When latitude/longitude were last resolved by the geocoding provider',
    credit_score    SMALLINT UNSIGNED NULL   COMMENT 'Customer credit score (0-1000 scale; NULL = unscored)',
    risk_rating     ENUM('low', 'medium', 'high', 'unrated') NOT NULL DEFAULT 'unrated'
                        COMMENT 'Customer risk rating derived from credit/payment history',
    notes           TEXT            NULL,
    status          ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
    portal_password_hash       VARCHAR(255) NULL      COMMENT 'bcrypt hash for self-service portal password; NULL = portal access not enabled',
    portal_login_attempts      TINYINT      NOT NULL DEFAULT 0,
    portal_locked_until        TIMESTAMP    NULL,
    version         INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT 'Optimistic locking version',
    suspension_exempt        TINYINT(1)   NOT NULL DEFAULT 0   COMMENT 'When 1, suspension rules will never be applied to this client',
    suspension_exempt_reason VARCHAR(500) NULL                 COMMENT 'Optional explanation for why this client is exempt from suspension',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_clients_organization_id (organization_id),
    KEY idx_clients_client_group_id (client_group_id),
    KEY idx_clients_locale (locale),
    KEY idx_clients_status (status),
    KEY idx_clients_email (email),
    KEY idx_clients_risk_rating (risk_rating),
    KEY idx_clients_deleted_at (deleted_at),
    CONSTRAINT fk_clients_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_clients_client_group FOREIGN KEY (client_group_id)
        REFERENCES client_groups (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: client_groups
-- Purpose: Family/account grouping (shared billing, family plan). Defined as a
--          forward reference for the clients.client_group_id FK (resolved under
--          SET FOREIGN_KEY_CHECKS = 0 at the top of this file).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_groups (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id   BIGINT UNSIGNED NULL
                          COMMENT 'Tenant organization this group belongs to; NULL = single-tenant deployment',
    name              VARCHAR(255)    NOT NULL COMMENT 'Group / family name',
    billing_mode      ENUM('separate', 'shared') NOT NULL DEFAULT 'separate'
                          COMMENT 'separate = each member billed individually; shared = primary member billed for all',
    primary_client_id BIGINT UNSIGNED NULL
                          COMMENT 'Member designated as the billing owner when billing_mode = shared',
    notes             TEXT            NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at        DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_client_groups_organization_id (organization_id),
    KEY idx_client_groups_primary_client_id (primary_client_id),
    KEY idx_client_groups_deleted_at (deleted_at),
    CONSTRAINT fk_client_groups_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_client_groups_primary_client FOREIGN KEY (primary_client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: client_custom_fields
-- Purpose: Unlimited per-client key/value custom fields (technician notes,
--          internal tags, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_custom_fields (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id   BIGINT UNSIGNED NOT NULL,
    field_key   VARCHAR(100)    NOT NULL COMMENT 'Custom field name / label',
    field_value TEXT            NULL     COMMENT 'Custom field value (free-form text)',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at  DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_client_custom_fields_client_key (client_id, field_key),
    KEY idx_client_custom_fields_client_id (client_id),
    KEY idx_client_custom_fields_deleted_at (deleted_at),
    CONSTRAINT fk_client_custom_fields_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: leads
-- Purpose: Lead capture and prospect pipeline (Â§1.2 Customer Lifecycle).
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
-- Table: service_orders
-- Purpose: Service order workflow â€” requested â†’ approved â†’ provisioning â†’
--          activated (Â§1.2 Customer Lifecycle).
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
-- Table: service_order_tasks
-- Purpose: Customer onboarding checklist items per service order (Â§1.2).
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
-- Table: winback_campaigns
-- Purpose: Win-back campaigns for cancelled customers (Â§1.2).
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

-- ---------------------------------------------------------------------------
-- Table: contacts
-- Purpose: Contact persons associated with clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id   BIGINT UNSIGNED NOT NULL,
    first_name  VARCHAR(100)    NOT NULL,
    last_name   VARCHAR(100)    NOT NULL,
    email       VARCHAR(255)    NULL,
    phone       VARCHAR(30)     NULL,
    role        VARCHAR(100)    NULL COMMENT 'e.g. Owner, Billing, Technical',
    is_primary  TINYINT(1)      NOT NULL DEFAULT 0,
    notes       TEXT            NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_contacts_client_id (client_id),
    KEY idx_contacts_deleted_at (deleted_at),
    CONSTRAINT fk_contacts_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: sites
-- Purpose: Transport network NMS locations (POPs, data centers, towers, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this site belongs to; NULL = single-tenant deployment',
    name            VARCHAR(255)    NOT NULL,
    site_type       ENUM('pop', 'data_center', 'tower', 'aggregation_node', 'other')
                                    NOT NULL DEFAULT 'other'
                                    COMMENT 'pop=Point of Presence, data_center=Data Center, tower=Transmission Tower, aggregation_node=Network Aggregation Node',
    address         VARCHAR(255)    NULL,
    city            VARCHAR(100)    NULL,
    state           VARCHAR(100)    NULL,
    country         VARCHAR(100)    NULL DEFAULT 'US',
    zip_code        VARCHAR(20)     NULL,
    latitude        DECIMAL(10, 8)  NULL,
    longitude       DECIMAL(11, 8)  NULL,
    notes           TEXT            NULL,
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_sites_organization_id (organization_id),
    KEY idx_sites_site_type (site_type),
    KEY idx_sites_deleted_at (deleted_at),
    CONSTRAINT fk_sites_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: plans
-- Purpose: Internet service packages offered by the ISP
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this plan belongs to; NULL = single-tenant deployment',
    name            VARCHAR(255)    NOT NULL,
    description     TEXT            NULL,
    download_speed_mbps INT UNSIGNED NOT NULL COMMENT 'Download speed in Mbps',
    upload_speed_mbps   INT UNSIGNED NOT NULL COMMENT 'Upload speed in Mbps',
    data_cap_gb     DECIMAL(10, 2)  NULL COMMENT 'Monthly data cap in GB, NULL = unlimited',
    price           DECIMAL(10, 2)  NOT NULL,
    currency        CHAR(3)         NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code',
    billing_cycle   ENUM('monthly', 'quarterly', 'semi_annual', 'annual') NOT NULL DEFAULT 'monthly',
    burst_download_mbps INT UNSIGNED NULL COMMENT 'Burst download speed in Mbps',
    burst_upload_mbps   INT UNSIGNED NULL COMMENT 'Burst upload speed in Mbps',
    radius_vendor       ENUM('mikrotik','cisco','juniper') NULL DEFAULT NULL,
    radius_rate_limit_template VARCHAR(200) NULL,
    fup_threshold_gb    DECIMAL(10,2) NULL COMMENT 'GB at which FUP kicks in; NULL = same as data_cap_gb',
    fup_threshold_percent TINYINT UNSIGNED NULL COMMENT 'Percent of cap at which FUP kicks in',
    fup_download_speed_mbps INT UNSIGNED NULL COMMENT 'Throttled download speed after FUP',
    fup_upload_speed_mbps   INT UNSIGNED NULL COMMENT 'Throttled upload speed after FUP',
    overage_mode        ENUM('none','per_gb','upgrade_prompt') NOT NULL DEFAULT 'none',
    overage_price_per_gb DECIMAL(10,4) NULL,
    trial_days          INT UNSIGNED NULL COMMENT 'Number of free trial days; NULL = no trial',
    trial_price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    priority        TINYINT UNSIGNED NULL COMMENT 'Plan priority 1-8 (1 = highest)',
    status          ENUM('active', 'inactive', 'archived') NOT NULL DEFAULT 'active',
    stack_type      ENUM('ipv4_only','ipv6_only','dual_stack') NOT NULL DEFAULT 'dual_stack' COMMENT 'IP stack type: IPv4-only, IPv6-only, or dual-stack (migration 243)',
    session_timeout_seconds INT UNSIGNED NULL COMMENT 'RADIUS Session-Timeout for subscribers on this plan (migration 225)',
    idle_timeout_seconds    INT UNSIGNED NULL COMMENT 'RADIUS Idle-Timeout for subscribers on this plan (migration 225)',
    simultaneous_use        INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Max concurrent sessions per subscriber on this plan (migration 225)',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_plans_organization_id (organization_id),
    KEY idx_plans_status (status),
    KEY idx_plans_deleted_at (deleted_at),
    CONSTRAINT fk_plans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: contracts
-- Purpose: Service contracts linking clients to plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Owning tenant organisation; NULL = single-tenant deployment',
    client_id      BIGINT UNSIGNED NOT NULL,
    plan_id        BIGINT UNSIGNED NOT NULL,
    site_id        BIGINT UNSIGNED NULL,
    start_date     DATE            NOT NULL,
    end_date       DATE            NULL,
    billing_day    TINYINT UNSIGNED NULL     COMMENT 'Day of month (1â€“28) on which invoices are generated; NULL = inherit from plan'
                       CHECK (billing_day BETWEEN 1 AND 28),
    ip_address     VARCHAR(45)     NULL      COMMENT 'Static IPv4/IPv6 address assigned to this service; NULL = dynamic',
    billing_cycle  ENUM('monthly', 'quarterly', 'semi_annual', 'annual') NULL COMMENT 'Override cycle; NULL means use the plan billing cycle',
    price_override DECIMAL(10, 2)  NULL COMMENT 'Custom price; NULL means use plan price',
    notes          TEXT            NULL,
    connection_type ENUM('pppoe', 'pppoe_dual', 'static', 'dual') NOT NULL DEFAULT 'pppoe'
                       COMMENT 'pppoe = PPPoE IPv4-only (requires RADIUS); pppoe_dual = PPPoE dual-stack IPv4+IPv6 (requires RADIUS); static = static IPv4 (no RADIUS); dual = dual-stack static IPv4+IPv6 (no RADIUS)',
    contract_template_mx_id BIGINT UNSIGNED NULL
                       COMMENT 'IFT/CRT-registered Carta de AdhesiÃ³n template used for this contract; NULL for non-MX clients',
    facturar       BOOLEAN         NOT NULL DEFAULT FALSE
                       COMMENT 'MX only: TRUE = generate individual CFDI for this contract invoices; FALSE = invoices go to factura pÃºblica (venta al pÃºblico en general). When TRUE the client must have a client_mx_profiles row with valid SAT data. Ignored when client locale is not MX',
    status         ENUM('pending','active','suspended','expired','cancelled','terminated') NOT NULL DEFAULT 'pending',
    version        INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT 'Optimistic locking version',
    created_by     BIGINT UNSIGNED NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_contracts_organization_id (organization_id),
    KEY idx_contracts_org_status (organization_id, status),
    KEY idx_contracts_client_id (client_id),
    KEY idx_contracts_plan_id (plan_id),
    KEY idx_contracts_site_id (site_id),
    KEY idx_contracts_connection_type (connection_type),
    KEY idx_contracts_contract_template_mx_id (contract_template_mx_id),
    KEY idx_contracts_facturar (facturar),
    KEY idx_contracts_status (status),
    KEY idx_contracts_client_status (client_id, status),
    KEY idx_contracts_deleted_at (deleted_at),
    CONSTRAINT fk_contracts_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_contract_template_mx FOREIGN KEY (contract_template_mx_id)
        REFERENCES contract_templates_mx (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: nas
-- Purpose: Network Access Servers used for RADIUS authentication
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nas (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL COMMENT 'Tenant organization this NAS belongs to; NULL = single-tenant deployment',
    name        VARCHAR(255)    NOT NULL,
    ip_address  VARCHAR(45)     NOT NULL COMMENT 'Primary IPv4 address',
    ipv6_address VARCHAR(45)    NULL     COMMENT 'IPv6 management address (dual-stack)',
    secret      VARCHAR(255)    NOT NULL COMMENT 'RADIUS shared secret',
    type        VARCHAR(50)     NOT NULL DEFAULT 'other' COMMENT 'e.g. mikrotik, cisco, ubiquiti',
    ports       INT UNSIGNED    NULL,
    description TEXT            NULL,
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    coa_port    SMALLINT UNSIGNED NULL DEFAULT 3799 COMMENT 'UDP port for RADIUS CoA/Disconnect messages (migration 232)',
    location    VARCHAR(200)    NULL COMMENT 'Free-form physical location description (migration 232)',
    site_id     BIGINT UNSIGNED NULL COMMENT 'Physical site where this NAS is installed (FK -> sites.id; SET NULL on site deletion) (migration 232)',
    secondary_nas_id BIGINT UNSIGNED NULL COMMENT 'Standby / secondary NAS for active-standby redundancy (self-ref FK -> nas.id) (migration 232)',
    health_status ENUM('unknown','up','down') NOT NULL DEFAULT 'unknown' COMMENT 'Last known health state (migration 232)',
    last_health_check_at DATETIME NULL COMMENT 'When health_status was last refreshed (migration 232)',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_nas_ip_address (ip_address),
    KEY idx_nas_organization_id (organization_id),
    KEY idx_nas_status (status),
    KEY idx_nas_deleted_at (deleted_at),
    KEY idx_nas_site_id (site_id),
    KEY idx_nas_secondary_nas_id (secondary_nas_id),
    CONSTRAINT fk_nas_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_nas_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_nas_secondary FOREIGN KEY (secondary_nas_id)
        REFERENCES nas (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radius
-- Purpose: RADIUS subscriber authentication accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id     BIGINT UNSIGNED NOT NULL,
    contract_id   BIGINT UNSIGNED NULL,
    nas_id        BIGINT UNSIGNED NULL     COMMENT 'NAS this subscriber authenticates through',
    username      VARCHAR(64)     NOT NULL,
    password      VARCHAR(255)    NOT NULL COMMENT 'Cleartext PPPoE secret used by FreeRADIUS Cleartext-Password lookups; kept visible for operator reference',
    ip_address              VARCHAR(45)     NULL COMMENT 'Static IPv4 address if assigned',
    ipv6_address            VARCHAR(45)     NULL COMMENT 'Static IPv6 address if assigned (dual-stack)',
    ipv6_delegated_prefix   VARCHAR(45)     NULL COMMENT 'Delegated IPv6 prefix e.g. 2001:db8:abcd:: (DHCPv6-PD)',
    ipv6_prefix_len         TINYINT UNSIGNED NULL COMMENT 'Delegated prefix length e.g. 48, 56, 64',
    ipv4_pool_id  BIGINT UNSIGNED NULL     COMMENT 'IPv4 pool for dynamic address assignment (PPPoE)',
    ipv6_pool_id  BIGINT UNSIGNED NULL     COMMENT 'IPv6 pool for dynamic prefix delegation (PPPoE dual-stack)',
    mac_address   VARCHAR(17)     NULL COMMENT 'MAC address in XX:XX:XX:XX:XX:XX format',
    profile       VARCHAR(100)    NULL COMMENT 'RADIUS profile / bandwidth profile name',
    auth_method   ENUM('pppoe','mac','dot1x','eap_tls') NOT NULL DEFAULT 'pppoe'
                      COMMENT 'Authentication method used by this subscriber account',
    status        ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
    simultaneous_use INT UNSIGNED NULL COMMENT 'Per-account override of plan simultaneous_use; NULL = inherit from plan (migration 225)',
    vlan_id       SMALLINT UNSIGNED NULL COMMENT 'Outer VLAN (S-VLAN) for this subscriber (migration 225)',
    inner_vlan_id SMALLINT UNSIGNED NULL COMMENT 'Inner VLAN (C-VLAN) for QinQ deployments (migration 225)',
    service_profile_id BIGINT UNSIGNED NULL COMMENT 'Per-account PPPoE service profile override; takes precedence over pool-level profile (migration 237)',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_radius_username (username),
    KEY idx_radius_client_id (client_id),
    KEY idx_radius_contract_id (contract_id),
    KEY idx_radius_nas_id (nas_id),
    KEY idx_radius_ipv4_pool_id (ipv4_pool_id),
    KEY idx_radius_ipv6_pool_id (ipv6_pool_id),
    KEY idx_radius_status (status),
    KEY idx_radius_deleted_at (deleted_at),
    CONSTRAINT fk_radius_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_radius_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_nas FOREIGN KEY (nas_id)
        REFERENCES nas (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_ipv4_pool FOREIGN KEY (ipv4_pool_id)
        REFERENCES ip_pools (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_ipv6_pool FOREIGN KEY (ipv6_pool_id)
        REFERENCES ip_pools (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_service_profile FOREIGN KEY (service_profile_id)
        REFERENCES pppoe_service_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: devices
-- Purpose: Network equipment inventory for both client CPE (Outdoor/Indoor)
--          and POP infrastructure (PTP, PTMP, OLT, Router, Switch, ONU, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this device belongs to; NULL = single-tenant deployment',
    site_id       BIGINT UNSIGNED NULL,
    client_id     BIGINT UNSIGNED NULL,
    contract_id   BIGINT UNSIGNED NULL     COMMENT 'Contract this device serves (e.g. which service a CPE belongs to)',
    category      ENUM('client', 'pop') NOT NULL DEFAULT 'client'
                      COMMENT 'client=Customer Premises Equipment (Outdoor/Indoor CPE), pop=POP Infrastructure (PTP, PTMP, OLT, Router, etc.)',
    name          VARCHAR(255)    NOT NULL,
    type          ENUM(
                      'outdoor_cpe',
                      'indoor_cpe',
                      'ptp',
                      'ptmp_ap',
                      'olt',
                      'router',
                      'switch',
                      'onu',
                      'other'
                  ) NOT NULL DEFAULT 'other'
                      COMMENT 'Device type â€” client: outdoor_cpe, indoor_cpe; pop: ptp, ptmp_ap, olt, router, switch, onu',
    manufacturer  VARCHAR(100)    NULL,
    model         VARCHAR(100)    NULL,
    serial_number VARCHAR(100)    NULL,
    mac_address   VARCHAR(17)     NULL COMMENT 'MAC address in XX:XX:XX:XX:XX:XX format',
    ip_address    VARCHAR(45)     NULL COMMENT 'Management IPv4 address',
    ipv6_address  VARCHAR(45)     NULL COMMENT 'Management IPv6 address (dual-stack)',
    firmware      VARCHAR(100)    NULL,
    snmp_enabled  BOOLEAN         NOT NULL DEFAULT FALSE COMMENT 'Enable SNMP polling for this device',
    snmp_community VARCHAR(255)   NULL COMMENT 'SNMP community string (v1/v2c) â€” store encrypted; decrypt at application layer',
    snmp_version  ENUM('v1','v2c','v3') NULL DEFAULT 'v2c' COMMENT 'SNMP protocol version',
    snmp_port     SMALLINT UNSIGNED NULL DEFAULT 161 COMMENT 'SNMP UDP port',
    snmp_profile_id BIGINT UNSIGNED NULL
                                       COMMENT 'Explicit SNMP profile override; NULL = auto-match by manufacturer/model/type',
    snmp_v3_security_name VARCHAR(255) NULL COMMENT 'SNMPv3 security name (USM user) — migration 250',
    snmp_v3_auth_protocol ENUM('none','md5','sha','sha256','sha512') NULL DEFAULT 'sha' COMMENT 'SNMPv3 authentication protocol — migration 250',
    snmp_v3_auth_key_encrypted VARCHAR(512) NULL COMMENT 'SNMPv3 auth passphrase — encrypted at app layer — migration 250',
    snmp_v3_priv_protocol ENUM('none','des','aes128','aes256') NULL DEFAULT 'aes128' COMMENT 'SNMPv3 privacy protocol — migration 250',
    snmp_v3_priv_key_encrypted VARCHAR(512) NULL COMMENT 'SNMPv3 privacy passphrase — encrypted at app layer — migration 250',
    snmp_v3_context_name VARCHAR(255) NULL COMMENT 'SNMPv3 context name (optional) — migration 250',
    last_polled_at DATETIME NULL COMMENT 'Timestamp of last successful SNMP poll — migration 250',
    last_poll_error TEXT NULL COMMENT 'Last SNMP poll error message if any — migration 250',
    status        ENUM('online', 'offline', 'maintenance') NOT NULL DEFAULT 'offline',
    notes         TEXT            NULL,
    firerelay_node_id VARCHAR(64) NULL
                                   COMMENT 'FireRelay agent node that can reach this device via RouterOS API',
    role          ENUM('access','distribution','backhaul','core') NULL
                                   COMMENT 'Logical role of this device in the network topology',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_devices_serial_number (serial_number),
    KEY idx_devices_organization_id (organization_id),
    KEY idx_devices_site_id (site_id),
    KEY idx_devices_client_id (client_id),
    KEY idx_devices_contract_id (contract_id),
    KEY idx_devices_category (category),
    KEY idx_devices_status (status),
    KEY idx_devices_snmp_enabled (snmp_enabled),
    KEY idx_devices_snmp_profile_id (snmp_profile_id),
    KEY idx_devices_firerelay_node_id (firerelay_node_id),
    KEY idx_devices_deleted_at (deleted_at),
    CONSTRAINT fk_devices_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_devices_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_devices_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_devices_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_devices_snmp_profile FOREIGN KEY (snmp_profile_id)
        REFERENCES snmp_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: tickets
-- Purpose: Customer support ticket tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Owning tenant organisation; NULL = single-tenant deployment',
    client_id    BIGINT UNSIGNED NOT NULL,
    contract_id  BIGINT UNSIGNED NULL     COMMENT 'Contract this ticket concerns (NULL = general client-level ticket)',
    assigned_to  BIGINT UNSIGNED NULL,
    subject      VARCHAR(255)    NOT NULL,
    description  TEXT            NULL,
    notes        TEXT            NULL COMMENT 'Internal operator notes on this ticket',
    category     VARCHAR(100)    NULL COMMENT 'e.g. connectivity, billing, hardware',
    priority     ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
    status       ENUM('open', 'in_progress', 'waiting', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    resolved_at  TIMESTAMP       NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_tickets_organization_id (organization_id),
    KEY idx_tickets_client_id (client_id),
    KEY idx_tickets_contract_id (contract_id),
    KEY idx_tickets_assigned_to (assigned_to),
    KEY idx_tickets_status (status),
    KEY idx_tickets_priority (priority),
    KEY idx_tickets_client_status (client_id, status, created_at DESC),
    KEY idx_tickets_assigned_status (assigned_to, status),
    KEY idx_tickets_deleted_at (deleted_at),
    CONSTRAINT fk_tickets_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tickets_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_tickets_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_tickets_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: invoices
-- Purpose: Billing records issued to clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL      COMMENT 'Owning tenant organisation; NULL = single-tenant deployment',
    client_id       BIGINT UNSIGNED NOT NULL,
    contract_id     BIGINT UNSIGNED NULL,
    invoice_number  VARCHAR(50)     NOT NULL,
    issue_date      DATE            NOT NULL DEFAULT (CURRENT_DATE) COMMENT 'Billing date of the invoice',
    due_date        DATE            NOT NULL,
    issued_at       DATETIME        NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when the invoice record was created (used by DSAR export)',
    subtotal        DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    tax_rate        DECIMAL(5, 4)   NOT NULL DEFAULT 0.0000 COMMENT 'e.g. 0.0800 for 8%',
    tax_amount      DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    total           DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    currency        CHAR(3)         NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code',
    tax_rate_id     BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    notes           TEXT            NULL,
    status          ENUM('draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled', 'void') NOT NULL DEFAULT 'draft',
    paid_at         TIMESTAMP       NULL,
    version         INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT 'Optimistic locking version',
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_invoices_number (invoice_number),
    KEY idx_invoices_organization_id (organization_id),
    KEY idx_invoices_org_status (organization_id, status),
    KEY idx_invoices_client_id (client_id),
    KEY idx_invoices_contract_id (contract_id),
    KEY idx_invoices_status (status),
    KEY idx_invoices_due_date (due_date),
    KEY idx_invoices_client_created (client_id, created_at DESC),
    KEY idx_invoices_status_due (status, due_date),
    KEY idx_invoices_tax_rate_id (tax_rate_id),
    KEY idx_invoices_deleted_at (deleted_at),
    CONSTRAINT fk_invoices_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_invoices_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_invoices_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_invoices_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payments
-- Purpose: Records of payments received from clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED NULL     COMMENT 'Owning tenant organisation; NULL = single-tenant deployment',
    client_id        BIGINT UNSIGNED NOT NULL,
    invoice_id       BIGINT UNSIGNED NULL,
    amount           DECIMAL(10, 2)  NOT NULL,
    currency         CHAR(3)         NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code',
    payment_date     DATE            NOT NULL DEFAULT (CURRENT_DATE) COMMENT 'Date the payment was received; defaults to today',
    payment_method   ENUM('cash', 'check', 'card', 'transfer', 'online',
                         'credit_card', 'debit_card', 'bank_transfer',
                         'oxxo_pay', 'spei', 'codi', 'convenience_store',
                         'digital_wallet', 'other')
                                     NOT NULL DEFAULT 'cash'
                                     COMMENT 'Payment instrument; simplified: cash/check/card/transfer/online/other; MX methods: oxxo_pay, spei, codi, convenience_store, digital_wallet',
    sat_forma_pago   VARCHAR(2)      NULL COMMENT 'SAT c_FormaPago code used to stamp on CFDI pago complement (e.g. 01=cash, 03=SPEI, 06=CoDi)',
    reference_number VARCHAR(100)    NULL COMMENT 'Check number, transaction ID, etc.',
    clabe            VARCHAR(18)     NULL COMMENT '18-digit CLABE interbank key â€” required for SPEI and CoDi transactions',
    bank_name        VARCHAR(100)    NULL COMMENT 'Bank name for SPEI / CoDi transactions',
    notes            TEXT            NULL,
    status           ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled')
                                     NOT NULL DEFAULT 'completed'
                                     COMMENT 'Payment lifecycle status',
    version          INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT 'Optimistic locking version',
    recorded_by      BIGINT UNSIGNED NULL,
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_payments_organization_id (organization_id),
    KEY idx_payments_client_id (client_id),
    KEY idx_payments_invoice_id (invoice_id),
    KEY idx_payments_payment_date (payment_date),
    KEY idx_payments_status (status),
    KEY idx_payments_client_created (client_id, created_at DESC),
    KEY idx_payments_deleted_at (deleted_at),
    CONSTRAINT fk_payments_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payments_recorded_by FOREIGN KEY (recorded_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payments_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payment_allocations
-- Purpose: Junction table for split payments â€” records what portion of a payment
--          was applied to each invoice.  Supports one-payment-many-invoices flows
--          (e.g. client pays a lump sum covering several outstanding invoices).
--          The payments.invoice_id column is kept for simple single-invoice cases.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_allocations (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    payment_id  BIGINT UNSIGNED NOT NULL  COMMENT 'Payment being allocated',
    invoice_id  BIGINT UNSIGNED NOT NULL  COMMENT 'Invoice receiving this portion of the payment',
    amount      DECIMAL(10, 2)  NOT NULL  COMMENT 'Portion of the payment applied to this invoice',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_allocations_payment_invoice (payment_id, invoice_id),
    KEY idx_payment_allocations_invoice_id (invoice_id),
    KEY idx_payment_allocations_deleted_at (deleted_at),
    CONSTRAINT fk_payment_allocations_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_payment_allocations_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payment_plans
-- Purpose: Payment plan for splitting invoices into installments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_plans (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NULL,
    client_id           BIGINT UNSIGNED  NOT NULL,
    total_amount        DECIMAL(12,2)    NOT NULL,
    installment_count   INT UNSIGNED     NOT NULL DEFAULT 1,
    frequency           ENUM('weekly','biweekly','monthly') NOT NULL DEFAULT 'monthly',
    status              ENUM('active','completed','defaulted','cancelled') NOT NULL DEFAULT 'active',
    notes               TEXT             NULL,
    created_by          BIGINT UNSIGNED  NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME         NULL,

    PRIMARY KEY (id),
    KEY idx_payment_plans_organization_id (organization_id),
    KEY idx_payment_plans_client_id (client_id),
    KEY idx_payment_plans_status (status),
    KEY idx_payment_plans_deleted_at (deleted_at),
    CONSTRAINT fk_payment_plans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payment_plans_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_payment_plans_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payment_plan_installments
-- Purpose: Individual installment records for a payment plan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_plan_installments (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NULL,
    plan_id             BIGINT UNSIGNED  NOT NULL,
    invoice_id          BIGINT UNSIGNED  NULL     COMMENT 'Invoice this installment covers; NULL until invoice is generated',
    sequence            INT UNSIGNED     NOT NULL COMMENT 'Order of this installment within the plan (1-based)',
    amount              DECIMAL(12,2)    NOT NULL,
    due_date            DATE             NOT NULL,
    status              ENUM('pending','paid','overdue') NOT NULL DEFAULT 'pending',
    paid_payment_id     BIGINT UNSIGNED  NULL     COMMENT 'Payment record that settled this installment',
    paid_at             DATETIME         NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_plan_sequence (plan_id, sequence),
    KEY idx_payment_plan_installments_organization_id (organization_id),
    KEY idx_payment_plan_installments_plan_id (plan_id),
    KEY idx_payment_plan_installments_invoice_id (invoice_id),
    KEY idx_payment_plan_installments_status (status),
    KEY idx_payment_plan_installments_due_date (due_date),
    CONSTRAINT fk_ppi_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ppi_plan FOREIGN KEY (plan_id)
        REFERENCES payment_plans (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ppi_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ppi_paid_payment FOREIGN KEY (paid_payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: cash_reconciliation_sessions
-- Purpose: Field agent cash collection reconciliation sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_reconciliation_sessions (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NULL,
    agent_user_id       BIGINT UNSIGNED  NOT NULL COMMENT 'Field agent who opened this session',
    opened_at           DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at           DATETIME         NULL,
    expected_total      DECIMAL(12,2)    NULL     COMMENT 'System-computed total of cash payments recorded during session window',
    counted_total       DECIMAL(12,2)    NULL     COMMENT 'Physical cash count submitted by the agent at close',
    variance            DECIMAL(12,2)    NULL     COMMENT 'counted_total - expected_total; negative = short, positive = over',
    status              ENUM('open','closed','approved','disputed') NOT NULL DEFAULT 'open',
    notes               TEXT             NULL,
    approved_by         BIGINT UNSIGNED  NULL     COMMENT 'Supervisor who approved or disputed the session',
    approved_at         DATETIME         NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME         NULL,

    PRIMARY KEY (id),
    KEY idx_cash_recon_organization_id (organization_id),
    KEY idx_cash_recon_agent_user_id (agent_user_id),
    KEY idx_cash_recon_status (status),
    KEY idx_cash_recon_opened_at (opened_at),
    KEY idx_cash_recon_deleted_at (deleted_at),
    CONSTRAINT fk_cash_recon_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cash_recon_agent FOREIGN KEY (agent_user_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cash_recon_approved_by FOREIGN KEY (approved_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: quotes
-- Purpose: Service estimates and proposals for prospective or existing clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotes (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL  COMMENT 'Owning tenant organisation; NULL = single-tenant deployment',
    client_id    BIGINT UNSIGNED NOT NULL,
    contract_id  BIGINT UNSIGNED NULL     COMMENT 'Contract this quote relates to, if any',
    quote_number VARCHAR(50)     NOT NULL,
    issue_date   DATE            NOT NULL DEFAULT (CURRENT_DATE) COMMENT 'Date this quote was issued',
    valid_until  DATE            NULL     COMMENT 'Date this quote expires',
    subtotal     DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    tax_rate     DECIMAL(5, 4)   NOT NULL DEFAULT 0.0000 COMMENT 'e.g. 0.0800 for 8%',
    tax_amount   DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    total        DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    currency     CHAR(3)         NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code',
    tax_rate_id  BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    notes        TEXT            NULL,
    status       ENUM('draft', 'sent', 'accepted', 'rejected', 'expired') NOT NULL DEFAULT 'draft',
    created_by   BIGINT UNSIGNED NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_quotes_number (quote_number),
    KEY idx_quotes_organization_id (organization_id),
    KEY idx_quotes_client_id (client_id),
    KEY idx_quotes_contract_id (contract_id),
    KEY idx_quotes_status (status),
    KEY idx_quotes_tax_rate_id (tax_rate_id),
    KEY idx_quotes_deleted_at (deleted_at),
    CONSTRAINT fk_quotes_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_quotes_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_quotes_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_quotes_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_quotes_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: jobs
-- Purpose: Field work orders for installations, maintenance, and repairs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id      BIGINT UNSIGNED NOT NULL,
    site_id        BIGINT UNSIGNED NULL,
    contract_id    BIGINT UNSIGNED NULL     COMMENT 'Contract this job is related to (installation, repair, maintenance)',
    ticket_id      BIGINT UNSIGNED NULL     COMMENT 'Originating support ticket, if this job was escalated from a ticket',
    assigned_to    BIGINT UNSIGNED NULL,
    title          VARCHAR(255)    NOT NULL,
    description    TEXT            NULL,
    type           ENUM('installation', 'maintenance', 'repair', 'survey', 'other')
                                   NOT NULL DEFAULT 'other',
    priority       ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
    status         ENUM('scheduled', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
    scheduled_date DATETIME        NULL,
    completed_date DATETIME        NULL,
    notes          TEXT            NULL,
    created_by     BIGINT UNSIGNED NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_jobs_client_id (client_id),
    KEY idx_jobs_site_id (site_id),
    KEY idx_jobs_contract_id (contract_id),
    KEY idx_jobs_ticket_id (ticket_id),
    KEY idx_jobs_assigned_to (assigned_to),
    KEY idx_jobs_status (status),
    KEY idx_jobs_scheduled_date (scheduled_date),
    CONSTRAINT fk_jobs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_jobs_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_jobs_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_jobs_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_jobs_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_jobs_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: expenses
-- Purpose: Operational expenses and costs, optionally linked to jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this expense belongs to; NULL = single-tenant deployment',
    job_id       BIGINT UNSIGNED NULL COMMENT 'Related work order, if applicable',
    user_id      BIGINT UNSIGNED NOT NULL COMMENT 'Employee who incurred the expense',
    category     VARCHAR(100)    NOT NULL COMMENT 'e.g. fuel, equipment, labor, parts',
    description  TEXT            NULL,
    amount       DECIMAL(10, 2)  NOT NULL,
    currency     CHAR(3)         NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code',
    expense_date DATE            NOT NULL,
    receipt_url  VARCHAR(500)    NULL COMMENT 'URL or path to receipt file',
    status       ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    approved_by  BIGINT UNSIGNED NULL,
    notes        TEXT            NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_expenses_organization_id (organization_id),
    KEY idx_expenses_job_id (job_id),
    KEY idx_expenses_user_id (user_id),
    KEY idx_expenses_status (status),
    KEY idx_expenses_expense_date (expense_date),
    KEY idx_expenses_deleted_at (deleted_at),
    CONSTRAINT fk_expenses_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_expenses_job FOREIGN KEY (job_id)
        REFERENCES jobs (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_expenses_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_expenses_approved_by FOREIGN KEY (approved_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: organizations
-- Purpose: ISP company / tenant configuration (one row per organization)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                VARCHAR(255)    NOT NULL,
    locale              ENUM('global', 'MX') NOT NULL DEFAULT 'global'
                            COMMENT 'Regional compliance switch: global = no country-specific requirements; MX = SAT CFDI 4.0 + IFT/CRT compliance required',
    legal_name          VARCHAR(255)    NULL,
    tax_id              VARCHAR(50)     NULL COMMENT 'SAT / tax-authority registration number',
    email               VARCHAR(255)    NULL,
    phone               VARCHAR(30)     NULL,
    address             VARCHAR(255)    NULL,
    city                VARCHAR(100)    NULL,
    state               VARCHAR(100)    NULL,
    country             VARCHAR(100)    NULL DEFAULT NULL,
    zip_code            VARCHAR(20)     NULL,
    website             VARCHAR(255)    NULL,
    online_payment_url  VARCHAR(255)    NULL COMMENT 'URL for the online payment portal',
    map_url             VARCHAR(500)    NULL COMMENT 'URL or embed link for office/coverage map',
    notes               TEXT            NULL,
    status              ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_organizations_locale (locale),
    KEY idx_organizations_status (status),
    KEY idx_organizations_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ip_pools
-- Purpose: IP address pools available for subscriber assignment (IPAM)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ip_pools (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL COMMENT 'Tenant organization this pool belongs to; NULL = single-tenant deployment',
    name        VARCHAR(255)    NOT NULL COMMENT 'Pool name e.g. Residential-Pool-1',
    ip_version  ENUM('4', '6') NOT NULL DEFAULT '4' COMMENT 'Address family: 4 = IPv4, 6 = IPv6',
    network     VARCHAR(45)     NOT NULL COMMENT 'Network address e.g. 10.0.0.0 (v4) or 2001:db8:: (v6)',
    subnet_mask VARCHAR(45)     NULL     COMMENT 'Network mask, dotted-decimal (IPv4) or CIDR notation',
    gateway     VARCHAR(45)     NULL     COMMENT 'Default gateway for the pool',
    pool_type   VARCHAR(50)     NULL     COMMENT 'Allocation type e.g. dynamic, static',
    dns_primary VARCHAR(45)     NULL     COMMENT 'Primary DNS server',
    dns_secondary VARCHAR(45)   NULL     COMMENT 'Secondary DNS server',
    site_id     BIGINT UNSIGNED NULL     COMMENT 'Site / POP the pool is served from',
    nas_id      BIGINT UNSIGNED NULL     COMMENT 'NAS device serving this pool; NULL = not tied to a specific NAS',
    service_type ENUM('residential','business','corporate','government','mixed') NULL DEFAULT 'mixed'
                                         COMMENT 'Subscriber class this pool is intended to serve',
    default_prefix_len TINYINT UNSIGNED  NULL
                                         COMMENT 'IPv6 prefix delegation length assigned to subscribers (e.g. 48, 56, 64); NULL for IPv4 pools or when PD is unused',
    excluded_ranges TEXT                 NULL
                                         COMMENT 'Comma- or newline-separated IP ranges to skip during dynamic allocation (e.g. management addresses)',
    last_alerted_threshold TINYINT UNSIGNED NULL
                                         COMMENT 'Last utilization % threshold that fired an alert (75 or 90); reset to NULL when usage drops below 75%',
    dhcpv6_mode ENUM('stateful','stateless','slaac') NULL COMMENT 'DHCPv6 mode for IPv6 pools (migration 243)',
    ra_enabled  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Enable Router Advertisements for this pool (migration 243)',
    ra_managed_flag TINYINT(1)  NOT NULL DEFAULT 0 COMMENT 'Set M flag in RA (managed address config) (migration 243)',
    ra_other_flag TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'Set O flag in RA (other config) (migration 243)',
    ra_lifetime_seconds INT UNSIGNED NOT NULL DEFAULT 1800 COMMENT 'RA router lifetime in seconds (migration 243)',
    slaac_prefix VARCHAR(50)    NULL COMMENT 'IPv6 prefix for SLAAC advertisement (migration 243)',
    region_name VARCHAR(100)    NULL COMMENT 'Geographic region name for this pool (migration 243)',
    service_profile_id BIGINT UNSIGNED NULL COMMENT 'PPPoE service profile applied to subscribers using this pool (migration 237)',
    notes       TEXT            NULL,
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ip_pools_network_mask_ver (network, subnet_mask, ip_version),
    KEY idx_ip_pools_organization_id (organization_id),
    KEY idx_ip_pools_ip_version (ip_version),
    KEY idx_ip_pools_site_id (site_id),
    KEY idx_ip_pools_nas_id (nas_id),
    KEY idx_ip_pools_status (status),
    KEY idx_ip_pools_deleted_at (deleted_at),
    CONSTRAINT fk_ip_pools_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ip_pools_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ip_pools_nas FOREIGN KEY (nas_id)
        REFERENCES nas (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ip_pools_service_profile FOREIGN KEY (service_profile_id)
        REFERENCES pppoe_service_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ip_assignments
-- Purpose: Track individual IP address assignments to clients / devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ip_assignments (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL COMMENT 'Tenant organization this assignment belongs to; NULL = single-tenant deployment',
    pool_id     BIGINT UNSIGNED NOT NULL COMMENT 'Parent IP pool',
    contract_id BIGINT UNSIGNED NULL     COMMENT 'Linked contract (for static/dual connection types)',
    client_id   BIGINT UNSIGNED NULL     COMMENT 'Assigned client',
    device_id   BIGINT UNSIGNED NULL     COMMENT 'Assigned device',
    ip_address  VARCHAR(45)     NOT NULL COMMENT 'Assigned IPv4 or IPv6 address',
    prefix_len  TINYINT UNSIGNED NULL     COMMENT 'For IPv6 prefix delegation: prefix length delegated to subscriber (e.g. 48, 56, 64); NULL for single-address assignments',
    mac_address VARCHAR(17)     NULL     COMMENT 'Bound MAC address (XX:XX:XX:XX:XX:XX)',
    type        ENUM('static', 'dynamic', 'reserved') NOT NULL DEFAULT 'dynamic',
    notes       TEXT            NULL,
    status      ENUM('active', 'available', 'expired') NOT NULL DEFAULT 'available'
                    COMMENT 'Lifecycle state â€” reservation intent is captured by the type field',
    assigned_at TIMESTAMP       NULL,
    expires_at  TIMESTAMP       NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ip_assignments_ip (ip_address),
    KEY idx_ip_assignments_organization_id (organization_id),
    KEY idx_ip_assignments_pool_id (pool_id),
    KEY idx_ip_assignments_contract_id (contract_id),
    KEY idx_ip_assignments_client_id (client_id),
    KEY idx_ip_assignments_device_id (device_id),
    KEY idx_ip_assignments_status (status),
    KEY idx_ip_assignments_deleted_at (deleted_at),
    CONSTRAINT fk_ip_assignments_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ip_assignments_pool FOREIGN KEY (pool_id)
        REFERENCES ip_pools (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ip_assignments_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ip_assignments_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ip_assignments_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: audit_logs
-- Purpose: System-wide audit trail for tracking who changed what and when
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NULL     COMMENT 'User who performed the action; NULL for system actions',
    action      ENUM('create', 'update', 'delete', 'login', 'logout', 'export', 'other') NOT NULL,
    entity_type VARCHAR(50)     NOT NULL COMMENT 'Table or resource name e.g. clients, invoices',
    entity_id   BIGINT UNSIGNED NULL     COMMENT 'ID of the affected record',
    summary     VARCHAR(500)    NULL     COMMENT 'Human-readable description of the change',
    old_values  JSON            NULL     COMMENT 'Previous field values (JSON)',
    new_values  JSON            NULL     COMMENT 'Updated field values (JSON)',
    ip_address  VARCHAR(45)     NULL     COMMENT 'IP address of the request origin',
    user_agent  VARCHAR(500)    NULL     COMMENT 'Browser / API client identifier',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_audit_logs_user_id (user_id),
    KEY idx_audit_logs_entity (entity_type, entity_id),
    KEY idx_audit_logs_entity_type_id (entity_type, entity_id, created_at DESC),
    KEY idx_audit_logs_action (action),
    KEY idx_audit_logs_created_at (created_at),
    CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: notifications
-- Purpose: System notifications and alerts for users (billing reminders,
--          network alerts, ticket updates, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NOT NULL COMMENT 'Recipient user',
    title       VARCHAR(255)    NOT NULL,
    body        TEXT            NULL,
    type        ENUM('info', 'warning', 'error', 'billing', 'network', 'ticket') NOT NULL DEFAULT 'info',
    entity_type VARCHAR(50)     NULL     COMMENT 'Related entity e.g. invoices, tickets',
    entity_id   BIGINT UNSIGNED NULL     COMMENT 'Related entity ID for deep linking',
    is_read     TINYINT(1)      NOT NULL DEFAULT 0,
    read_at     TIMESTAMP       NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_notifications_user_id (user_id),
    KEY idx_notifications_is_read (is_read),
    KEY idx_notifications_type (type),
    KEY idx_notifications_created_at (created_at),
    KEY idx_notifications_deleted_at (deleted_at),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: invoice_items
-- Purpose: Individual line items that make up an invoice's subtotal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_items (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_id  BIGINT UNSIGNED NOT NULL,
    description VARCHAR(255)    NOT NULL COMMENT 'Line-item description e.g. plan name, one-time fee',
    quantity    DECIMAL(10, 2)  NOT NULL DEFAULT 1.00,
    unit_price  DECIMAL(10, 2)  NOT NULL,
    amount      DECIMAL(10, 2)  NOT NULL DEFAULT 0.00 COMMENT 'Line-item total amount (quantity Ã— unit_price); populated on INSERT by billingService and Invoice.addItem',
    tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Per-line-item tax rate override; NULL = inherit from parent invoice',
    total       DECIMAL(10, 2)  GENERATED ALWAYS AS (quantity * unit_price) STORED COMMENT 'quantity * unit_price',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_invoice_items_invoice_id (invoice_id),
    KEY idx_invoice_items_tax_rate_id (tax_rate_id),
    KEY idx_invoice_items_deleted_at (deleted_at),
    CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_invoice_items_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: quote_items
-- Purpose: Individual line items that make up a quote's subtotal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quote_items (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    quote_id    BIGINT UNSIGNED NOT NULL,
    description VARCHAR(255)    NOT NULL COMMENT 'Line-item description e.g. service, installation fee',
    quantity    DECIMAL(10, 2)  NOT NULL DEFAULT 1.00,
    unit_price  DECIMAL(10, 2)  NOT NULL,
    tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Per-line-item tax rate override; NULL = inherit from parent quote',
    total       DECIMAL(10, 2)  GENERATED ALWAYS AS (quantity * unit_price) STORED COMMENT 'quantity * unit_price',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_quote_items_quote_id (quote_id),
    KEY idx_quote_items_tax_rate_id (tax_rate_id),
    KEY idx_quote_items_deleted_at (deleted_at),
    CONSTRAINT fk_quote_items_quote FOREIGN KEY (quote_id)
        REFERENCES quotes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_quote_items_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ticket_comments
-- Purpose: Conversation tracking and internal notes on support tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_comments (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ticket_id  BIGINT UNSIGNED NOT NULL,
    user_id    BIGINT UNSIGNED NULL     COMMENT 'Staff member who posted the comment; NULL for system messages',
    body       TEXT            NOT NULL,
    is_internal TINYINT(1)     NOT NULL DEFAULT 0 COMMENT '1 = internal note visible only to staff',
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ticket_comments_ticket_id (ticket_id),
    KEY idx_ticket_comments_user_id (user_id),
    KEY idx_ticket_comments_deleted_at (deleted_at),
    CONSTRAINT fk_ticket_comments_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_comments_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: files
-- Purpose: File metadata for all entity-scoped and system storage folders:
--          devices   (device_history, evidence)
--          clients   (client_file, notification_log)
--          tickets   (chat_history, document)
--          organizations (isp_info, sat, online_payment, map, logo)
--          backup    (backup)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_type  ENUM('device', 'client', 'ticket', 'organization', 'backup') NOT NULL
                     COMMENT 'Top-level folder: devices | clients | tickets | organizations | backup',
    entity_id    BIGINT UNSIGNED NULL
                     COMMENT 'ID of the related entity; NULL for backup files',
    category     ENUM(
                     'device_history',   -- devices / p/device
                     'evidence',         -- devices / p/device
                     'client_file',      -- clients / p/client
                     'notification_log', -- clients / p/client
                     'chat_history',     -- tickets / p/ticket
                     'document',         -- tickets / p/ticket
                     'isp_info',         -- organizations / p/organization
                     'sat',              -- organizations / p/organization
                     'online_payment',   -- organizations / p/organization
                     'map',              -- organizations / p/organization
                     'logo',             -- organizations / p/organization
                     'backup'            -- backup folder
                 ) NOT NULL COMMENT 'File category within its entity folder',
    file_name    VARCHAR(255)    NOT NULL COMMENT 'Original file name as uploaded',
    file_path    VARCHAR(500)    NOT NULL COMMENT 'Relative storage path on disk or object store',
    file_size    BIGINT UNSIGNED NULL     COMMENT 'File size in bytes',
    mime_type    VARCHAR(100)    NULL     COMMENT 'MIME type e.g. image/png, application/pdf',
    uploaded_by  BIGINT UNSIGNED NULL     COMMENT 'User who uploaded the file',
    notes        TEXT            NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_files_entity      (entity_type, entity_id),
    KEY idx_files_category    (category),
    KEY idx_files_uploaded_by (uploaded_by),
    KEY idx_files_deleted_at (deleted_at),
    CONSTRAINT fk_files_uploaded_by FOREIGN KEY (uploaded_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_files_entity_id CHECK (
        entity_type = 'backup' OR entity_id IS NOT NULL
    ),
    CONSTRAINT chk_files_category_match CHECK (
        (entity_type = 'device'       AND category IN ('device_history', 'evidence'))
     OR (entity_type = 'client'       AND category IN ('client_file', 'notification_log'))
     OR (entity_type = 'ticket'       AND category IN ('chat_history', 'document'))
     OR (entity_type = 'organization' AND category IN ('isp_info', 'sat', 'online_payment', 'map', 'logo'))
     OR (entity_type = 'backup'       AND category = 'backup')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: snmp_metrics
-- Purpose: Raw SNMP poll data collected every 5 minutes from devices.
--          Wide-table design (one row per device/interface per poll) with
--          monthly RANGE partitioning for instant DROP PARTITION retention.
--          Retained for 90 days via snmp_maintain_partitions().
--          No FK on device_id to avoid write overhead on the hot insert path.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_metrics (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id       BIGINT UNSIGNED NOT NULL,
    interface_id    VARCHAR(64)     NULL       COMMENT 'SNMP ifIndex or ifDescr for interface-level metrics',
    if_in_octets       BIGINT          NULL       COMMENT 'ifInOctets -- bytes received',
    if_out_octets      BIGINT          NULL       COMMENT 'ifOutOctets -- bytes transmitted',
    if_in_errors       BIGINT          NULL       COMMENT 'ifInErrors -- inbound errors',
    if_out_errors      BIGINT          NULL       COMMENT 'ifOutErrors -- outbound errors',
    cpu_usage          SMALLINT        NULL       COMMENT 'CPU utilization percentage',
    memory_usage       SMALLINT        NULL       COMMENT 'Memory utilization percentage',
    signal_strength    INTEGER         NULL       COMMENT 'Wireless signal strength in dBm',
    latency_ms         DECIMAL(10,2)   NULL       COMMENT 'ICMP ping latency in milliseconds',
    -- §6.2 extended device monitoring metrics (migration 255)
    voltage_mv         INT             NULL       COMMENT 'Supply voltage in millivolts (e.g. 12000 = 12V)',
    temperature_c      DECIMAL(6,2)    NULL       COMMENT 'Device/sensor temperature in Celsius',
    fan_speed_rpm      INT             NULL       COMMENT 'Fan speed in RPM',
    if_in_discards     BIGINT          NULL       COMMENT 'ifInDiscards — inbound packets discarded',
    if_out_discards    BIGINT          NULL       COMMENT 'ifOutDiscards — outbound packets discarded',
    sfp_tx_power_dbm   DECIMAL(8,4)    NULL       COMMENT 'SFP/QSFP Tx optical power in dBm',
    sfp_rx_power_dbm   DECIMAL(8,4)    NULL       COMMENT 'SFP/QSFP Rx optical power in dBm',
    sfp_temperature_c  DECIMAL(6,2)    NULL       COMMENT 'SFP/QSFP transceiver temperature in Celsius',
    ups_battery_pct    SMALLINT        NULL       COMMENT 'UPS battery charge percentage',
    ups_runtime_min    INT             NULL       COMMENT 'UPS estimated runtime remaining in minutes',
    poe_power_mw       INT             NULL       COMMENT 'PoE port power draw in milliwatts',
    humidity_pct       DECIMAL(5,2)    NULL       COMMENT 'Environmental relative humidity percentage',
    -- §6.2 gap metrics (migration 264)
    if_oper_status     TINYINT         NULL       COMMENT 'IF-MIB ifOperStatus: 1=up 2=down 3=testing 7=lowerLayerDown',
    -- §9.1 wireless/RF metrics (migration 279)
    noise_floor_dbm    SMALLINT        NULL       COMMENT '§9.1 RF noise floor in dBm',
    air_util_pct       TINYINT         NULL       COMMENT '§9.1 Airtime utilization percentage (0–100)',
    gps_sync_status    TINYINT         NULL       COMMENT '§9.1 GPS sync status: 1=synced 0=not-synced',
    snr_db             SMALLINT        NULL       COMMENT '§9.1 Signal-to-noise ratio in dB',
    ccq_pct            SMALLINT        NULL       COMMENT '§9.1 Client Connection Quality percentage (0–100)',
    tx_rate_mbps       DECIMAL(8,2)    NULL       COMMENT '§9.1 Wireless transmit modulation rate in Mbps',
    rx_rate_mbps       DECIMAL(8,2)    NULL       COMMENT '§9.1 Wireless receive modulation rate in Mbps',
    polled_at          TIMESTAMP       NOT NULL   COMMENT 'Timestamp of the SNMP poll',
    created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id, polled_at),
    KEY idx_snmp_metrics_device_time (device_id, polled_at),
    KEY idx_snmp_metrics_device_iface_time (device_id, interface_id, polled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (UNIX_TIMESTAMP(polled_at)) (
    PARTITION p2026_01 VALUES LESS THAN (UNIX_TIMESTAMP('2026-02-01')),
    PARTITION p2026_02 VALUES LESS THAN (UNIX_TIMESTAMP('2026-03-01')),
    PARTITION p2026_03 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION p2026_04 VALUES LESS THAN (UNIX_TIMESTAMP('2026-05-01')),
    PARTITION p2026_05 VALUES LESS THAN (UNIX_TIMESTAMP('2026-06-01')),
    PARTITION p2026_06 VALUES LESS THAN (UNIX_TIMESTAMP('2026-07-01')),
    PARTITION p_future  VALUES LESS THAN MAXVALUE
);

-- ---------------------------------------------------------------------------
-- Table: snmp_metrics_1hr
-- Purpose: Hourly aggregates of SNMP metrics.  Wide-table design: one row per
--          device / interface per hour with per-metric avg / min / max columns.
--          Retained for 1 year via batch DELETE in snmp_apply_retention().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_metrics_1hr (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id           BIGINT UNSIGNED NOT NULL,
    interface_id        VARCHAR(64)     NOT NULL DEFAULT '' COMMENT 'SNMP ifIndex or ifDescr; empty string for device-level metrics',
    period_start        TIMESTAMP       NOT NULL             COMMENT 'Start of the 1-hour aggregation window',
    avg_if_in_octets    DECIMAL(20,4)   NULL     COMMENT 'Average ifInOctets in the period',
    min_if_in_octets    BIGINT          NULL     COMMENT 'Minimum ifInOctets in the period',
    max_if_in_octets    BIGINT          NULL     COMMENT 'Maximum ifInOctets in the period',
    avg_if_out_octets   DECIMAL(20,4)   NULL     COMMENT 'Average ifOutOctets in the period',
    min_if_out_octets   BIGINT          NULL     COMMENT 'Minimum ifOutOctets in the period',
    max_if_out_octets   BIGINT          NULL     COMMENT 'Maximum ifOutOctets in the period',
    avg_if_in_errors    DECIMAL(20,4)   NULL     COMMENT 'Average ifInErrors in the period',
    min_if_in_errors    BIGINT          NULL     COMMENT 'Minimum ifInErrors in the period',
    max_if_in_errors    BIGINT          NULL     COMMENT 'Maximum ifInErrors in the period',
    avg_if_out_errors   DECIMAL(20,4)   NULL     COMMENT 'Average ifOutErrors in the period',
    min_if_out_errors   BIGINT          NULL     COMMENT 'Minimum ifOutErrors in the period',
    max_if_out_errors   BIGINT          NULL     COMMENT 'Maximum ifOutErrors in the period',
    avg_cpu_usage       DECIMAL(5,2)    NULL     COMMENT 'Average CPU utilization percentage',
    min_cpu_usage       SMALLINT        NULL     COMMENT 'Minimum CPU utilization percentage',
    max_cpu_usage       SMALLINT        NULL     COMMENT 'Maximum CPU utilization percentage',
    avg_memory_usage    DECIMAL(5,2)    NULL     COMMENT 'Average memory utilization percentage',
    min_memory_usage    SMALLINT        NULL     COMMENT 'Minimum memory utilization percentage',
    max_memory_usage    SMALLINT        NULL     COMMENT 'Maximum memory utilization percentage',
    avg_signal_strength DECIMAL(7,2)    NULL     COMMENT 'Average signal strength in dBm',
    min_signal_strength INTEGER         NULL     COMMENT 'Minimum signal strength in dBm',
    max_signal_strength INTEGER         NULL     COMMENT 'Maximum signal strength in dBm',
    avg_latency_ms          DECIMAL(10,2)   NULL     COMMENT 'Average latency in milliseconds',
    min_latency_ms          DECIMAL(10,2)   NULL     COMMENT 'Minimum latency in milliseconds',
    max_latency_ms          DECIMAL(10,2)   NULL     COMMENT 'Maximum latency in milliseconds',
    -- §6.2 extended device monitoring metrics (migration 255)
    avg_voltage_mv          DECIMAL(12,4)   NULL,
    min_voltage_mv          INT             NULL,
    max_voltage_mv          INT             NULL,
    avg_temperature_c       DECIMAL(8,4)    NULL,
    min_temperature_c       DECIMAL(6,2)    NULL,
    max_temperature_c       DECIMAL(6,2)    NULL,
    avg_fan_speed_rpm       DECIMAL(10,2)   NULL,
    min_fan_speed_rpm       INT             NULL,
    max_fan_speed_rpm       INT             NULL,
    avg_if_in_discards      DECIMAL(20,4)   NULL,
    min_if_in_discards      BIGINT          NULL,
    max_if_in_discards      BIGINT          NULL,
    avg_if_out_discards     DECIMAL(20,4)   NULL,
    min_if_out_discards     BIGINT          NULL,
    max_if_out_discards     BIGINT          NULL,
    avg_sfp_tx_power_dbm    DECIMAL(10,4)   NULL,
    min_sfp_tx_power_dbm    DECIMAL(8,4)    NULL,
    max_sfp_tx_power_dbm    DECIMAL(8,4)    NULL,
    avg_sfp_rx_power_dbm    DECIMAL(10,4)   NULL,
    min_sfp_rx_power_dbm    DECIMAL(8,4)    NULL,
    max_sfp_rx_power_dbm    DECIMAL(8,4)    NULL,
    avg_sfp_temperature_c   DECIMAL(8,4)    NULL,
    min_sfp_temperature_c   DECIMAL(6,2)    NULL,
    max_sfp_temperature_c   DECIMAL(6,2)    NULL,
    avg_ups_battery_pct     DECIMAL(5,2)    NULL,
    min_ups_battery_pct     SMALLINT        NULL,
    max_ups_battery_pct     SMALLINT        NULL,
    avg_ups_runtime_min     DECIMAL(10,2)   NULL,
    min_ups_runtime_min     INT             NULL,
    max_ups_runtime_min     INT             NULL,
    avg_poe_power_mw        DECIMAL(12,4)   NULL,
    min_poe_power_mw        INT             NULL,
    max_poe_power_mw        INT             NULL,
    avg_humidity_pct        DECIMAL(7,4)    NULL,
    min_humidity_pct        DECIMAL(5,2)    NULL,
    max_humidity_pct        DECIMAL(5,2)    NULL,
    -- §6.2 gap metrics (migration 264)
    avg_if_oper_status      DECIMAL(4,2)    NULL     COMMENT 'Average ifOperStatus in the period',
    min_if_oper_status      TINYINT         NULL     COMMENT 'Min ifOperStatus in the period',
    max_if_oper_status      TINYINT         NULL     COMMENT 'Max ifOperStatus in the period',
    -- §9.1 wireless/RF metrics (migration 279)
    avg_noise_floor_dbm     DECIMAL(7,2)    NULL     COMMENT 'Average noise floor dBm',
    min_noise_floor_dbm     SMALLINT        NULL     COMMENT 'Min noise floor dBm',
    max_noise_floor_dbm     SMALLINT        NULL     COMMENT 'Max noise floor dBm',
    avg_air_util_pct        DECIMAL(5,2)    NULL     COMMENT 'Average airtime utilization %',
    min_air_util_pct        TINYINT         NULL     COMMENT 'Min airtime utilization %',
    max_air_util_pct        TINYINT         NULL     COMMENT 'Max airtime utilization %',
    avg_gps_sync_status     DECIMAL(4,2)    NULL     COMMENT 'Average GPS sync status',
    min_gps_sync_status     TINYINT         NULL     COMMENT 'Min GPS sync status',
    max_gps_sync_status     TINYINT         NULL     COMMENT 'Max GPS sync status',
    avg_snr_db              DECIMAL(7,2)    NULL     COMMENT 'Average SNR dB',
    min_snr_db              SMALLINT        NULL     COMMENT 'Min SNR dB',
    max_snr_db              SMALLINT        NULL     COMMENT 'Max SNR dB',
    avg_ccq_pct             DECIMAL(5,2)    NULL     COMMENT 'Average CCQ %',
    min_ccq_pct             SMALLINT        NULL     COMMENT 'Min CCQ %',
    max_ccq_pct             SMALLINT        NULL     COMMENT 'Max CCQ %',
    avg_tx_rate_mbps        DECIMAL(10,4)   NULL     COMMENT 'Average Tx rate Mbps',
    min_tx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Min Tx rate Mbps',
    max_tx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Max Tx rate Mbps',
    avg_rx_rate_mbps        DECIMAL(10,4)   NULL     COMMENT 'Average Rx rate Mbps',
    min_rx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Min Rx rate Mbps',
    max_rx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Max Rx rate Mbps',
    sample_count            INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of raw samples aggregated',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1hr_device_iface_period (device_id, interface_id, period_start),
    KEY idx_snmp_1hr_period_start (period_start),
    CONSTRAINT fk_snmp_1hr_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: snmp_metrics_1day
-- Purpose: Daily aggregates of SNMP metrics.  Wide-table design: one row per
--          device / interface per day with per-metric avg / min / max columns.
--          Retained indefinitely (3+ years).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_metrics_1day (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id           BIGINT UNSIGNED NOT NULL,
    interface_id        VARCHAR(64)     NOT NULL DEFAULT '' COMMENT 'SNMP ifIndex or ifDescr; empty string for device-level metrics',
    period_start        DATE            NOT NULL             COMMENT 'Date of the daily aggregation window',
    avg_if_in_octets    DECIMAL(20,4)   NULL     COMMENT 'Average ifInOctets across hourly windows',
    min_if_in_octets    BIGINT          NULL     COMMENT 'Minimum ifInOctets across hourly windows',
    max_if_in_octets    BIGINT          NULL     COMMENT 'Maximum ifInOctets across hourly windows',
    avg_if_out_octets   DECIMAL(20,4)   NULL     COMMENT 'Average ifOutOctets across hourly windows',
    min_if_out_octets   BIGINT          NULL     COMMENT 'Minimum ifOutOctets across hourly windows',
    max_if_out_octets   BIGINT          NULL     COMMENT 'Maximum ifOutOctets across hourly windows',
    avg_if_in_errors    DECIMAL(20,4)   NULL     COMMENT 'Average ifInErrors across hourly windows',
    min_if_in_errors    BIGINT          NULL     COMMENT 'Minimum ifInErrors across hourly windows',
    max_if_in_errors    BIGINT          NULL     COMMENT 'Maximum ifInErrors across hourly windows',
    avg_if_out_errors   DECIMAL(20,4)   NULL     COMMENT 'Average ifOutErrors across hourly windows',
    min_if_out_errors   BIGINT          NULL     COMMENT 'Minimum ifOutErrors across hourly windows',
    max_if_out_errors   BIGINT          NULL     COMMENT 'Maximum ifOutErrors across hourly windows',
    avg_cpu_usage       DECIMAL(5,2)    NULL     COMMENT 'Average CPU utilization percentage',
    min_cpu_usage       SMALLINT        NULL     COMMENT 'Minimum CPU utilization percentage',
    max_cpu_usage       SMALLINT        NULL     COMMENT 'Maximum CPU utilization percentage',
    avg_memory_usage    DECIMAL(5,2)    NULL     COMMENT 'Average memory utilization percentage',
    min_memory_usage    SMALLINT        NULL     COMMENT 'Minimum memory utilization percentage',
    max_memory_usage    SMALLINT        NULL     COMMENT 'Maximum memory utilization percentage',
    avg_signal_strength DECIMAL(7,2)    NULL     COMMENT 'Average signal strength in dBm',
    min_signal_strength INTEGER         NULL     COMMENT 'Minimum signal strength in dBm',
    max_signal_strength INTEGER         NULL     COMMENT 'Maximum signal strength in dBm',
    avg_latency_ms          DECIMAL(10,2)   NULL     COMMENT 'Average latency in milliseconds',
    min_latency_ms          DECIMAL(10,2)   NULL     COMMENT 'Minimum latency in milliseconds',
    max_latency_ms          DECIMAL(10,2)   NULL     COMMENT 'Maximum latency in milliseconds',
    -- §6.2 extended device monitoring metrics (migration 255)
    avg_voltage_mv          DECIMAL(12,4)   NULL,
    min_voltage_mv          INT             NULL,
    max_voltage_mv          INT             NULL,
    avg_temperature_c       DECIMAL(8,4)    NULL,
    min_temperature_c       DECIMAL(6,2)    NULL,
    max_temperature_c       DECIMAL(6,2)    NULL,
    avg_fan_speed_rpm       DECIMAL(10,2)   NULL,
    min_fan_speed_rpm       INT             NULL,
    max_fan_speed_rpm       INT             NULL,
    avg_if_in_discards      DECIMAL(20,4)   NULL,
    min_if_in_discards      BIGINT          NULL,
    max_if_in_discards      BIGINT          NULL,
    avg_if_out_discards     DECIMAL(20,4)   NULL,
    min_if_out_discards     BIGINT          NULL,
    max_if_out_discards     BIGINT          NULL,
    avg_sfp_tx_power_dbm    DECIMAL(10,4)   NULL,
    min_sfp_tx_power_dbm    DECIMAL(8,4)    NULL,
    max_sfp_tx_power_dbm    DECIMAL(8,4)    NULL,
    avg_sfp_rx_power_dbm    DECIMAL(10,4)   NULL,
    min_sfp_rx_power_dbm    DECIMAL(8,4)    NULL,
    max_sfp_rx_power_dbm    DECIMAL(8,4)    NULL,
    avg_sfp_temperature_c   DECIMAL(8,4)    NULL,
    min_sfp_temperature_c   DECIMAL(6,2)    NULL,
    max_sfp_temperature_c   DECIMAL(6,2)    NULL,
    avg_ups_battery_pct     DECIMAL(5,2)    NULL,
    min_ups_battery_pct     SMALLINT        NULL,
    max_ups_battery_pct     SMALLINT        NULL,
    avg_ups_runtime_min     DECIMAL(10,2)   NULL,
    min_ups_runtime_min     INT             NULL,
    max_ups_runtime_min     INT             NULL,
    avg_poe_power_mw        DECIMAL(12,4)   NULL,
    min_poe_power_mw        INT             NULL,
    max_poe_power_mw        INT             NULL,
    avg_humidity_pct        DECIMAL(7,4)    NULL,
    min_humidity_pct        DECIMAL(5,2)    NULL,
    max_humidity_pct        DECIMAL(5,2)    NULL,
    -- §6.2 gap metrics (migration 264)
    avg_if_oper_status      DECIMAL(4,2)    NULL     COMMENT 'Average ifOperStatus in the period',
    min_if_oper_status      TINYINT         NULL     COMMENT 'Min ifOperStatus in the period',
    max_if_oper_status      TINYINT         NULL     COMMENT 'Max ifOperStatus in the period',
    -- §9.1 wireless/RF metrics (migration 279)
    avg_noise_floor_dbm     DECIMAL(7,2)    NULL     COMMENT 'Average noise floor dBm',
    min_noise_floor_dbm     SMALLINT        NULL     COMMENT 'Min noise floor dBm',
    max_noise_floor_dbm     SMALLINT        NULL     COMMENT 'Max noise floor dBm',
    avg_air_util_pct        DECIMAL(5,2)    NULL     COMMENT 'Average airtime utilization %',
    min_air_util_pct        TINYINT         NULL     COMMENT 'Min airtime utilization %',
    max_air_util_pct        TINYINT         NULL     COMMENT 'Max airtime utilization %',
    avg_gps_sync_status     DECIMAL(4,2)    NULL     COMMENT 'Average GPS sync status',
    min_gps_sync_status     TINYINT         NULL     COMMENT 'Min GPS sync status',
    max_gps_sync_status     TINYINT         NULL     COMMENT 'Max GPS sync status',
    avg_snr_db              DECIMAL(7,2)    NULL     COMMENT 'Average SNR dB',
    min_snr_db              SMALLINT        NULL     COMMENT 'Min SNR dB',
    max_snr_db              SMALLINT        NULL     COMMENT 'Max SNR dB',
    avg_ccq_pct             DECIMAL(5,2)    NULL     COMMENT 'Average CCQ %',
    min_ccq_pct             SMALLINT        NULL     COMMENT 'Min CCQ %',
    max_ccq_pct             SMALLINT        NULL     COMMENT 'Max CCQ %',
    avg_tx_rate_mbps        DECIMAL(10,4)   NULL     COMMENT 'Average Tx rate Mbps',
    min_tx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Min Tx rate Mbps',
    max_tx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Max Tx rate Mbps',
    avg_rx_rate_mbps        DECIMAL(10,4)   NULL     COMMENT 'Average Rx rate Mbps',
    min_rx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Min Rx rate Mbps',
    max_rx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Max Rx rate Mbps',
    sample_count            INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of hourly samples aggregated',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1day_device_iface_period (device_id, interface_id, period_start),
    KEY idx_snmp_1day_period_start (period_start),
    CONSTRAINT fk_snmp_1day_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: snmp_metrics_1month
-- Purpose: Monthly aggregates of SNMP metrics.  Wide-table design: one row per
--          device / interface per month.  Retained 3 years (migration 265).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_metrics_1month (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id           BIGINT UNSIGNED NOT NULL,
    interface_id        VARCHAR(64)     NOT NULL DEFAULT '' COMMENT 'SNMP ifIndex or ifDescr; empty string for device-level metrics',
    period_start        DATE            NOT NULL             COMMENT 'First day of the monthly aggregation window',
    avg_if_in_octets    DECIMAL(20,4)   NULL,
    min_if_in_octets    BIGINT          NULL,
    max_if_in_octets    BIGINT          NULL,
    avg_if_out_octets   DECIMAL(20,4)   NULL,
    min_if_out_octets   BIGINT          NULL,
    max_if_out_octets   BIGINT          NULL,
    avg_if_in_errors    DECIMAL(20,4)   NULL,
    min_if_in_errors    BIGINT          NULL,
    max_if_in_errors    BIGINT          NULL,
    avg_if_out_errors   DECIMAL(20,4)   NULL,
    min_if_out_errors   BIGINT          NULL,
    max_if_out_errors   BIGINT          NULL,
    avg_cpu_usage       DECIMAL(5,2)    NULL,
    min_cpu_usage       SMALLINT        NULL,
    max_cpu_usage       SMALLINT        NULL,
    avg_memory_usage    DECIMAL(5,2)    NULL,
    min_memory_usage    SMALLINT        NULL,
    max_memory_usage    SMALLINT        NULL,
    avg_signal_strength DECIMAL(7,2)    NULL,
    min_signal_strength INTEGER         NULL,
    max_signal_strength INTEGER         NULL,
    avg_latency_ms      DECIMAL(10,2)   NULL,
    min_latency_ms      DECIMAL(10,2)   NULL,
    max_latency_ms      DECIMAL(10,2)   NULL,
    avg_voltage_mv      DECIMAL(12,4)   NULL,
    min_voltage_mv      INT             NULL,
    max_voltage_mv      INT             NULL,
    avg_temperature_c   DECIMAL(8,4)    NULL,
    min_temperature_c   DECIMAL(6,2)    NULL,
    max_temperature_c   DECIMAL(6,2)    NULL,
    avg_fan_speed_rpm   DECIMAL(10,2)   NULL,
    min_fan_speed_rpm   INT             NULL,
    max_fan_speed_rpm   INT             NULL,
    avg_if_in_discards  DECIMAL(20,4)   NULL,
    min_if_in_discards  BIGINT          NULL,
    max_if_in_discards  BIGINT          NULL,
    avg_if_out_discards DECIMAL(20,4)   NULL,
    min_if_out_discards BIGINT          NULL,
    max_if_out_discards BIGINT          NULL,
    avg_sfp_tx_power_dbm DECIMAL(10,4)  NULL,
    min_sfp_tx_power_dbm DECIMAL(8,4)   NULL,
    max_sfp_tx_power_dbm DECIMAL(8,4)   NULL,
    avg_sfp_rx_power_dbm DECIMAL(10,4)  NULL,
    min_sfp_rx_power_dbm DECIMAL(8,4)   NULL,
    max_sfp_rx_power_dbm DECIMAL(8,4)   NULL,
    avg_sfp_temperature_c DECIMAL(8,4)  NULL,
    min_sfp_temperature_c DECIMAL(6,2)  NULL,
    max_sfp_temperature_c DECIMAL(6,2)  NULL,
    avg_ups_battery_pct DECIMAL(5,2)    NULL,
    min_ups_battery_pct SMALLINT        NULL,
    max_ups_battery_pct SMALLINT        NULL,
    avg_ups_runtime_min DECIMAL(10,2)   NULL,
    min_ups_runtime_min INT             NULL,
    max_ups_runtime_min INT             NULL,
    avg_poe_power_mw    DECIMAL(12,4)   NULL,
    min_poe_power_mw    INT             NULL,
    max_poe_power_mw    INT             NULL,
    avg_humidity_pct    DECIMAL(7,4)    NULL,
    min_humidity_pct    DECIMAL(5,2)    NULL,
    max_humidity_pct    DECIMAL(5,2)    NULL,
    avg_if_oper_status  DECIMAL(4,2)    NULL,
    min_if_oper_status  TINYINT         NULL,
    max_if_oper_status  TINYINT         NULL,
    -- §9.1 wireless/RF metrics (migration 279)
    avg_noise_floor_dbm DECIMAL(7,2)    NULL,
    min_noise_floor_dbm SMALLINT        NULL,
    max_noise_floor_dbm SMALLINT        NULL,
    avg_air_util_pct    DECIMAL(5,2)    NULL,
    min_air_util_pct    TINYINT         NULL,
    max_air_util_pct    TINYINT         NULL,
    avg_gps_sync_status DECIMAL(4,2)    NULL,
    min_gps_sync_status TINYINT         NULL,
    max_gps_sync_status TINYINT         NULL,
    avg_snr_db          DECIMAL(7,2)    NULL,
    min_snr_db          SMALLINT        NULL,
    max_snr_db          SMALLINT        NULL,
    avg_ccq_pct         DECIMAL(5,2)    NULL,
    min_ccq_pct         SMALLINT        NULL,
    max_ccq_pct         SMALLINT        NULL,
    avg_tx_rate_mbps    DECIMAL(10,4)   NULL,
    min_tx_rate_mbps    DECIMAL(8,2)    NULL,
    max_tx_rate_mbps    DECIMAL(8,2)    NULL,
    avg_rx_rate_mbps    DECIMAL(10,4)   NULL,
    min_rx_rate_mbps    DECIMAL(8,2)    NULL,
    max_rx_rate_mbps    DECIMAL(8,2)    NULL,
    sample_count        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of daily samples aggregated',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1month_device_iface_period (device_id, interface_id, period_start),
    KEY idx_snmp_1month_period_start (period_start),
    CONSTRAINT fk_snmp_1month_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Monthly SNMP metric aggregates — retained 3 years';

-- ---------------------------------------------------------------------------
-- Table: snmp_rollup_state
-- Purpose: High-watermark table tracking the last successfully processed
--          timestamp for each rollup tier.  Enables rollup procedures to
--          catch up automatically after a missed run or server restart.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_rollup_state (
    rollup_name    VARCHAR(32)  NOT NULL COMMENT 'Rollup tier identifier (1hr, 1day, 1month)',
    last_processed TIMESTAMP    NULL     COMMENT 'High-watermark: last successfully processed timestamp',
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (rollup_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO snmp_rollup_state (rollup_name, last_processed) VALUES
    ('1hr',  NULL),
    ('1day', NULL);

-- ---------------------------------------------------------------------------
-- Table: snmp_profiles
-- Purpose: Named SNMP polling templates matched by manufacturer/model/device_type.
--          The poller selects a profile per device and walks only the OIDs
--          defined in snmp_profile_oids for that profile.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_profiles (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name          VARCHAR(100)    NOT NULL COMMENT 'Profile name e.g. Ubiquiti airOS, MikroTik RouterOS',
    manufacturer  VARCHAR(100)    NULL     COMMENT 'Match devices.manufacturer (NULL = any)',
    model_pattern VARCHAR(100)    NULL     COMMENT 'SQL LIKE pattern to match devices.model (NULL = any)',
    device_type   ENUM('outdoor_cpe','indoor_cpe','ptp','ptmp_ap','olt','router','switch','onu','other') NULL
                                           COMMENT 'Match devices.type (NULL = any)',
    snmp_version  ENUM('v1','v2c','v3') NULL DEFAULT 'v2c' COMMENT 'Preferred SNMP version for this profile',
    poll_interval_sec INT UNSIGNED NOT NULL DEFAULT 300 COMMENT 'Poll interval in seconds (default 5 min)',
    is_default    BOOLEAN         NOT NULL DEFAULT FALSE COMMENT 'Fallback profile when no manufacturer/model match',
    description   TEXT            NULL,
    status        ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_profiles_name (name),
    KEY idx_snmp_profiles_manufacturer (manufacturer),
    KEY idx_snmp_profiles_status (status),
    KEY idx_snmp_profiles_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: snmp_profile_oids
-- Purpose: Maps vendor-specific SNMP OIDs to the normalized metric columns in
--          snmp_metrics (if_in_octets, cpu_usage, signal_strength, etc.).
--          Each row tells the poller: "for this profile, poll this OID and
--          store the result in this snmp_metrics column".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_profile_oids (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    profile_id      BIGINT UNSIGNED NOT NULL,
    oid             VARCHAR(255)    NOT NULL COMMENT 'SNMP OID to poll e.g. 1.3.6.1.2.1.2.2.1.10',
    metric_column   VARCHAR(64)     NOT NULL COMMENT 'Target column in snmp_metrics: if_in_octets, cpu_usage, signal_strength, etc.',
    label           VARCHAR(100)    NULL     COMMENT 'Human-readable label for display',
    oid_type        ENUM('gauge','counter','counter64','string','timeticks') NOT NULL DEFAULT 'gauge'
                                             COMMENT 'SNMP value type for proper delta/rate calculation',
    is_per_interface BOOLEAN        NOT NULL DEFAULT FALSE COMMENT 'TRUE = walk ifTable with ifIndex, FALSE = scalar',
    transform       VARCHAR(255)    NULL     COMMENT 'Optional transform expression e.g. "value / 10", "value * -1"',
    sort_order      INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Display ordering within the profile',
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_profile_oid (profile_id, oid),
    KEY idx_snmp_profile_oids_metric (metric_column),
    KEY idx_snmp_profile_oids_status (status),
    KEY idx_snmp_profile_oids_deleted_at (deleted_at),
    CONSTRAINT fk_snmp_profile_oids_profile FOREIGN KEY (profile_id)
        REFERENCES snmp_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: snmp_traps
-- ---------------------------------------------------------------------------
-- Stores unsolicited SNMP trap messages pushed by network devices.
-- Populated by the snmpTrapReceiver service (UDP listener on SNMP_TRAP_PORT).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS snmp_traps (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED,
    device_id        BIGINT UNSIGNED,
    source_ip        VARCHAR(45)      NOT NULL,
    trap_type        VARCHAR(64)      NOT NULL DEFAULT 'unknown',
    trap_oid         VARCHAR(255),
    varbinds         JSON,
    community        VARCHAR(128),
    snmp_version     TINYINT UNSIGNED NOT NULL DEFAULT 2,
    is_acknowledged  TINYINT(1)       NOT NULL DEFAULT 0,
    acknowledged_by  BIGINT UNSIGNED,
    acknowledged_at  DATETIME,
    received_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    CONSTRAINT fk_snmp_traps_org    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
    CONSTRAINT fk_snmp_traps_device FOREIGN KEY (device_id)       REFERENCES devices(id)       ON DELETE SET NULL,
    CONSTRAINT fk_snmp_traps_ack_by FOREIGN KEY (acknowledged_by) REFERENCES users(id)         ON DELETE SET NULL,

    INDEX idx_snmp_traps_org_received    (organization_id, received_at),
    INDEX idx_snmp_traps_device_received (device_id, received_at),
    INDEX idx_snmp_traps_type            (trap_type),
    INDEX idx_snmp_traps_received        (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: device_groups  §6.1 Device Discovery & Onboarding (migration 249)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_groups (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization',
    name            VARCHAR(200)    NOT NULL,
    description     TEXT            NULL,
    group_type      ENUM('type','location','region','olt','custom') NOT NULL DEFAULT 'custom'
                                             COMMENT 'Grouping criterion',
    color           VARCHAR(7)      NULL     COMMENT 'Hex color for UI display',
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_device_groups_org_name (organization_id, name),
    KEY idx_device_groups_organization_id (organization_id),
    KEY idx_device_groups_status (status),
    KEY idx_device_groups_deleted_at (deleted_at),
    CONSTRAINT fk_device_groups_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: device_group_members  §6.1 (migration 249)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_group_members (
    device_group_id BIGINT UNSIGNED NOT NULL,
    device_id       BIGINT UNSIGNED NOT NULL,
    added_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (device_group_id, device_id),
    KEY idx_dgm_device_id (device_id),
    CONSTRAINT fk_dgm_group FOREIGN KEY (device_group_id)
        REFERENCES device_groups (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dgm_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: discovery_scans  §6.1 (migration 250)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_scans (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NULL,
    name                    VARCHAR(200)    NOT NULL,
    cidr_ranges             JSON            NOT NULL COMMENT 'Array of CIDR strings to scan',
    snmp_version            ENUM('v1','v2c','v3') NOT NULL DEFAULT 'v2c',
    snmp_community          VARCHAR(255)    NULL     COMMENT 'Community string for v1/v2c scans',
    snmp_v3_security_name   VARCHAR(255)    NULL,
    snmp_v3_auth_protocol   ENUM('none','md5','sha','sha256','sha512') NULL DEFAULT 'sha',
    snmp_v3_auth_key_encrypted VARCHAR(512) NULL     COMMENT 'Encrypted SNMPv3 auth key',
    snmp_v3_priv_protocol   ENUM('none','des','aes128','aes256') NULL DEFAULT 'aes128',
    snmp_v3_priv_key_encrypted VARCHAR(512) NULL     COMMENT 'Encrypted SNMPv3 priv key',
    snmp_port               SMALLINT UNSIGNED NOT NULL DEFAULT 161,
    timeout_ms              INT UNSIGNED    NOT NULL DEFAULT 3000,
    concurrency             INT UNSIGNED    NOT NULL DEFAULT 50,
    status                  ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
    scan_started_at         DATETIME        NULL,
    scan_completed_at       DATETIME        NULL,
    total_hosts             INT UNSIGNED    NULL,
    scanned_hosts           INT UNSIGNED    NOT NULL DEFAULT 0,
    discovered_hosts        INT UNSIGNED    NOT NULL DEFAULT 0,
    error_message           TEXT            NULL,
    created_by              BIGINT UNSIGNED NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at              DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_discovery_scans_org (organization_id),
    KEY idx_discovery_scans_status (status),
    KEY idx_discovery_scans_deleted_at (deleted_at),
    CONSTRAINT fk_discovery_scans_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_discovery_scans_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: discovery_results  §6.1 (migration 250)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_results (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    scan_id              BIGINT UNSIGNED NOT NULL,
    organization_id      BIGINT UNSIGNED NULL,
    ip_address           VARCHAR(45)     NOT NULL,
    hostname             VARCHAR(255)    NULL,
    sys_descr            TEXT            NULL,
    sys_oid              VARCHAR(255)    NULL,
    snmp_version         TINYINT UNSIGNED NOT NULL DEFAULT 2,
    manufacturer         VARCHAR(100)    NULL,
    model                VARCHAR(100)    NULL,
    device_type          ENUM('outdoor_cpe','indoor_cpe','ptp','ptmp_ap','olt','router','switch','onu','other') NULL,
    suggested_profile_id BIGINT UNSIGNED NULL,
    status               ENUM('pending_review','onboarded','ignored') NOT NULL DEFAULT 'pending_review',
    device_id            BIGINT UNSIGNED NULL,
    discovered_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_discovery_results_scan_id (scan_id),
    KEY idx_discovery_results_org (organization_id),
    KEY idx_discovery_results_status (status),
    KEY idx_discovery_results_ip (ip_address),
    CONSTRAINT fk_dr_scan FOREIGN KEY (scan_id)
        REFERENCES discovery_scans (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dr_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_dr_profile FOREIGN KEY (suggested_profile_id)
        REFERENCES snmp_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_dr_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: snmp_trap_forwarding_rules  §6.1 (migration 251)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_trap_forwarding_rules (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED NULL,
    name                 VARCHAR(200)    NOT NULL,
    match_trap_type      VARCHAR(64)     NULL,
    match_source_ip      VARCHAR(45)     NULL,
    match_oid_prefix     VARCHAR(255)    NULL,
    forward_to_url       VARCHAR(500)    NULL,
    forward_to_email     VARCHAR(255)    NULL,
    forward_to_webhook_id BIGINT UNSIGNED NULL,
    transform_template   TEXT            NULL,
    is_active            BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at           DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_stfr_org (organization_id),
    KEY idx_stfr_active (is_active),
    KEY idx_stfr_deleted_at (deleted_at),
    CONSTRAINT fk_stfr_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: dr_drill_logs
-- Purpose: Audit log for automated quarterly DR-drill runs.
--          Each row records the outcome of one non-destructive drill:
--            Phase 1 â€” backup taken + size verified
--            Phase 4 â€” referential-integrity and financial-consistency checks
--          Phases 2 (drop) and 3 (restore) are intentionally manual.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dr_drill_logs (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    run_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT 'When this drill run started',
    status              ENUM('pass', 'fail', 'error') NOT NULL
                            COMMENT 'pass = all checks OK; fail = one or more checks failed; error = drill aborted by exception',
    backup_file         VARCHAR(500)     NULL
                            COMMENT 'Relative path to the backup file created in this drill',
    backup_size_bytes   BIGINT UNSIGNED  NULL
                            COMMENT 'Compressed size of the backup file in bytes',
    checks              JSON             NULL
                            COMMENT 'JSON object containing each check name mapped to its result',
    error_message       TEXT             NULL
                            COMMENT 'Error details when status is fail or error',
    duration_ms         INT UNSIGNED     NULL
                            COMMENT 'Total drill wall-clock time in milliseconds',

    PRIMARY KEY (id),
    KEY idx_dr_drill_logs_run_at (run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log for automated quarterly DR-drill runs.';

-- ---------------------------------------------------------------------------
-- Seed: snmp_profiles â€” pre-built profiles for common ISP device vendors
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES
    (
        'Generic IF-MIB',
        NULL, NULL, NULL,
        'v2c', 300, TRUE,
        'Default fallback profile using standard IF-MIB (RFC 2863) and HOST-RESOURCES-MIB (RFC 2790) OIDs. Applied to any device that does not match a more specific profile.'
    ),
    (
        'Ubiquiti airOS',
        'Ubiquiti', NULL, NULL,
        'v2c', 300, FALSE,
        'Ubiquiti airOS devices (airMAX, airFiber). Uses Ubiquiti enterprise MIB (OID prefix 1.3.6.1.4.1.41112) for signal strength, CPU, and memory in addition to standard IF-MIB interface counters.'
    ),
    (
        'MikroTik RouterOS',
        'MikroTik', NULL, NULL,
        'v2c', 300, FALSE,
        'MikroTik RouterOS devices. Uses MikroTik enterprise MIB (OID prefix 1.3.6.1.4.1.14988) for wireless signal strength in addition to standard IF-MIB interface counters and HOST-RESOURCES-MIB CPU/memory.'
    ),
    (
        'Cambium Networks',
        'Cambium', NULL, NULL,
        'v2c', 300, FALSE,
        'Cambium Networks devices (ePMP, PMP, cnPilot). Uses Cambium enterprise MIB (OID prefix 1.3.6.1.4.1.161) for RSSI and CPU in addition to standard IF-MIB interface counters.'
    );

-- ---------------------------------------------------------------------------
-- Seed: snmp_profile_oids â€” OID mappings per vendor profile
-- ---------------------------------------------------------------------------

-- Generic IF-MIB OIDs
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'   AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'           AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL        AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',         'if_out_octets',               'Outbound Octets',             'counter', TRUE,  NULL,  20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',         'if_in_errors',                'Inbound Errors',              'counter', TRUE,  NULL,  30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',         'if_out_errors',               'Outbound Errors',             'counter', TRUE,  NULL,  40 UNION ALL
    SELECT '1.3.6.1.2.1.25.3.3.1.2',       'cpu_usage',                   'CPU Usage (%)',               'gauge',   FALSE, NULL,  50 UNION ALL
    SELECT '1.3.6.1.2.1.25.2.3.1.6',       'memory_usage',                'Memory Used (storage units)', 'gauge',   FALSE, NULL,  60
) o
WHERE p.name = 'Generic IF-MIB';

-- Ubiquiti airOS OIDs
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'        AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'    AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',              'if_out_octets',               'Outbound Octets',        'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',              'if_in_errors',                'Inbound Errors',         'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',              'if_out_errors',               'Outbound Errors',        'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.5',       'signal_strength',             'airOS Signal (dBm)',     'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.2',       'cpu_usage',                   'airOS CPU (%)',          'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.41112.1.4.5.1.4',       'memory_usage',                'airOS Memory (%)',       'gauge',   FALSE, NULL, 70
) o
WHERE p.name = 'Ubiquiti airOS';

-- MikroTik RouterOS OIDs
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'           AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'             AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                 'if_out_octets',               'Outbound Octets',                'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                 'if_in_errors',                'Inbound Errors',                 'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                 'if_out_errors',               'Outbound Errors',                'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.2.1.25.3.3.1.2',               'cpu_usage',                   'CPU Usage (HOST-RESOURCES)',     'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.2.1.25.2.3.1.6',               'memory_usage',                'Memory Used (hrStorageUsed)',    'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.14988.1.1.1.2.1.3',        'signal_strength',             'RouterOS Wireless Signal (dBm)', 'gauge',   FALSE, NULL, 70
) o
WHERE p.name = 'MikroTik RouterOS';

-- Cambium Networks OIDs
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    o.oid,
    o.metric_column,
    o.label,
    o.oid_type,
    o.is_per_interface,
    o.transform,
    o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'           AS oid, 'if_in_octets'   AS metric_column, 'Inbound Octets'   AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                 'if_out_octets',               'Outbound Octets',       'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',                 'if_in_errors',                'Inbound Errors',        'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',                 'if_out_errors',               'Outbound Errors',       'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.161.19.3.2.2.117.0',       'signal_strength',             'Cambium RSSI (dBm)',    'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.161.19.3.1.4.1.0',         'cpu_usage',                   'Cambium CPU (%)',       'gauge',   FALSE, NULL, 60
) o
WHERE p.name = 'Cambium Networks';

-- ---------------------------------------------------------------------------
-- Seed: §9.1 new vendor snmp_profiles — Mimosa, Tarana, Radwin, Siklu
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_profiles
    (name, manufacturer, model_pattern, device_type, snmp_version, poll_interval_sec, is_default, description)
VALUES
    (
        'Mimosa Networks',
        'Mimosa', 'A[2-9]|B[2-9]|C[2-9]', NULL,
        'v2c', 60, FALSE,
        'Mimosa Networks A/B/C-series wireless backhaul and PTMP access points. '
        'Uses Mimosa enterprise MIB (OID prefix 1.3.6.1.4.1.43356) for signal, '
        'noise floor, CCQ, air utilization, and modulation rates.'
    ),
    (
        'Tarana Wireless',
        'Tarana', 'G1|G1A|G1B', NULL,
        'v2c', 60, FALSE,
        'Tarana Wireless G1 fixed wireless access system. '
        'Uses Tarana enterprise MIB (OID prefix 1.3.6.1.4.1.50536) for DL/UL signal, '
        'noise floor, SNR, and GPS sync status.'
    ),
    (
        'Radwin',
        'Radwin', '2000|5000|JET', NULL,
        'v2c', 60, FALSE,
        'Radwin 2000/5000 series PTP/PTMP wireless broadband systems. '
        'Uses Radwin enterprise MIB (OID prefix 1.3.6.1.4.1.4329) for signal, '
        'modulation, airtime utilization, and Tx power.'
    ),
    (
        'Siklu',
        'Siklu', 'EH-[0-9]|BreezeULTRA|MultiHaul', NULL,
        'v2c', 60, FALSE,
        'Siklu E-band / V-band mmWave wireless links. '
        'Uses Siklu enterprise MIB (OID prefix 1.3.6.1.4.1.31926) for RSL, '
        'TSL, SNR, modulation, and link budget metrics.'
    );

-- Mimosa Networks OIDs
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, o.oid_type, o.is_per_interface, o.transform, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'         AS oid, 'if_in_octets'    AS metric_column, 'Inbound Octets'              AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',               'if_out_octets',                    'Outbound Octets',             'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.1.1.1',        'cpu_usage',                        'Mimosa CPU (%)',              'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.1',      'signal_strength',                  'Mimosa Rx Signal (dBm)',      'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.2',      'noise_floor_dbm',                  'Mimosa Noise Floor (dBm)',    'gauge',   FALSE, NULL, 70 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.4',      'snr_db',                           'Mimosa SNR (dB)',             'gauge',   FALSE, NULL, 80 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.7',      'air_util_pct',                     'Mimosa Airtime Util (%)',     'gauge',   FALSE, NULL, 90 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.10',     'tx_rate_mbps',                     'Mimosa DL Rate (Mbps)',       'gauge',   FALSE, NULL, 100 UNION ALL
    SELECT '1.3.6.1.4.1.43356.2.1.2.1.1.11',     'rx_rate_mbps',                     'Mimosa UL Rate (Mbps)',       'gauge',   FALSE, NULL, 110
) o
WHERE p.name = 'Mimosa Networks';

-- Tarana Wireless OIDs
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, o.oid_type, o.is_per_interface, o.transform, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'         AS oid, 'if_in_octets'    AS metric_column, 'Inbound Octets'               AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',               'if_out_octets',                    'Outbound Octets',              'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.2.1.1',          'cpu_usage',                        'Tarana CPU (%)',               'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.1',          'signal_strength',                  'Tarana DL RSSI (dBm)',         'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.2',          'noise_floor_dbm',                  'Tarana Noise Floor (dBm)',     'gauge',   FALSE, NULL, 70 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.3',          'snr_db',                           'Tarana SNR (dB)',              'gauge',   FALSE, NULL, 80 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.4',          'gps_sync_status',                  'Tarana GPS Sync (1=synced)',   'gauge',   FALSE, NULL, 90 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.7',          'air_util_pct',                     'Tarana Airtime Util (%)',      'gauge',   FALSE, NULL, 100 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.5',          'tx_rate_mbps',                     'Tarana DL Capacity (Mbps)',    'gauge',   FALSE, NULL, 110 UNION ALL
    SELECT '1.3.6.1.4.1.50536.1.1.1.6',          'rx_rate_mbps',                     'Tarana UL Capacity (Mbps)',    'gauge',   FALSE, NULL, 120
) o
WHERE p.name = 'Tarana Wireless';

-- Radwin OIDs
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, o.oid_type, o.is_per_interface, o.transform, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'             AS oid, 'if_in_octets'    AS metric_column, 'Inbound Octets'               AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',                   'if_out_octets',                    'Outbound Octets',              'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.1.1.1.4',             'cpu_usage',                        'Radwin CPU (%)',               'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.14',          'signal_strength',                  'Radwin RSL (dBm)',             'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.17',          'noise_floor_dbm',                  'Radwin Noise Floor (dBm)',     'gauge',   FALSE, NULL, 70 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.16',          'snr_db',                           'Radwin SNR (dB)',              'gauge',   FALSE, NULL, 80 UNION ALL
    SELECT '1.3.6.1.4.1.4329.5.2.2.1.1.25',          'air_util_pct',                     'Radwin Airtime Util (%)',      'gauge',   FALSE, NULL, 90
) o
WHERE p.name = 'Radwin';

-- Siklu OIDs
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT p.id, o.oid, o.metric_column, o.label, o.oid_type, o.is_per_interface, o.transform, o.sort_order
FROM snmp_profiles p
JOIN (
    SELECT '1.3.6.1.2.1.2.2.1.10'         AS oid, 'if_in_octets'    AS metric_column, 'Inbound Octets'               AS label, 'counter' AS oid_type, TRUE  AS is_per_interface, NULL AS transform, 10 AS sort_order UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.16',               'if_out_octets',                    'Outbound Octets',              'counter', TRUE,  NULL, 20 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.14',               'if_in_errors',                     'Inbound Errors',               'counter', TRUE,  NULL, 30 UNION ALL
    SELECT '1.3.6.1.2.1.2.2.1.20',               'if_out_errors',                    'Outbound Errors',              'counter', TRUE,  NULL, 40 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.1.1.1',          'cpu_usage',                        'Siklu CPU (%)',                'gauge',   FALSE, NULL, 50 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.4.1.1.1',        'signal_strength',                  'Siklu RSL (dBm)',              'gauge',   FALSE, NULL, 60 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.4.1.1.3',        'snr_db',                           'Siklu SNR (dB)',               'gauge',   FALSE, NULL, 80 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.4.1.1.7',        'tx_rate_mbps',                     'Siklu Tx Capacity (Mbps)',     'gauge',   FALSE, NULL, 100 UNION ALL
    SELECT '1.3.6.1.4.1.31926.1.4.1.1.8',        'rx_rate_mbps',                     'Siklu Rx Capacity (Mbps)',     'gauge',   FALSE, NULL, 110
) o
WHERE p.name = 'Siklu';

-- ---------------------------------------------------------------------------
-- §9.3 GPS sync OID seeds (migration 284)
-- ---------------------------------------------------------------------------
-- Ubiquiti airOS — ubntAirIfGpsSync (airMAX TDMA MIB)
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    '1.3.6.1.4.1.41112.1.6.1.2.1.5',
    'gps_sync_status',
    'airMAX GPS Sync (1=synced)',
    'gauge',
    FALSE,
    NULL,
    140
FROM snmp_profiles p
WHERE p.name = 'Ubiquiti airOS';

-- Mimosa Networks — mimosaGpsSync
INSERT IGNORE INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, transform, sort_order)
SELECT
    p.id,
    '1.3.6.1.4.1.43356.2.1.2.1.1.8',
    'gps_sync_status',
    'Mimosa GPS Sync (1=synced)',
    'gauge',
    FALSE,
    NULL,
    115
FROM snmp_profiles p
WHERE p.name = 'Mimosa Networks';

-- ---------------------------------------------------------------------------
-- §9.3 Scheduled task: wireless AP sector poll (migration 284)
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (task_name, task_type, cron_expression, priority, is_enabled, description)
SELECT
    'wireless_ap_sector_poll',
    'snmp_poll',
    '*/5 * * * *',
    'normal',
    TRUE,
    'Poll AP sector metrics: noise floor, air utilization, connected clients, GPS sync'
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks WHERE task_name = 'wireless_ap_sector_poll'
);

-- =============================================================================
-- Connection Logs (Compliance & Usage)
-- =============================================================================
-- Connection logs record every subscriber session event for regulatory compliance.
-- Session traffic counters (bytes_in/out, packets_in/out) on stop/interim events
-- also serve as the source of truth for per-contract data usage â€” no separate
-- NetFlow usage tables are needed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table 31: connection_logs
-- Purpose: Records every subscriber session event (start / stop /
--          interim-update) for regulatory compliance.  Denormalised so each
--          row is self-contained even if the referenced contract or client is
--          later deleted.  No FK on contract_id / client_id for this reason.
--          Monthly RANGE partitions for instant DROP PARTITION retention (2 years).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connection_logs (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_id           BIGINT UNSIGNED NOT NULL          COMMENT 'Contract at time of session (no FK â€” compliance)',
    client_id             BIGINT UNSIGNED NOT NULL          COMMENT 'Client at time of session (no FK â€” compliance)',
    nas_id                BIGINT UNSIGNED NULL              COMMENT 'NAS that authenticated the session',
    username              VARCHAR(64)     NOT NULL          COMMENT 'RADIUS username at time of session',
    session_id            VARCHAR(64)     NULL              COMMENT 'RADIUS Acct-Session-Id',
    ip_address            VARCHAR(45)     NULL              COMMENT 'IPv4 address assigned during session',
    ipv6_address          VARCHAR(45)     NULL              COMMENT 'IPv6 address assigned during session',
    ipv6_delegated_prefix VARCHAR(45)     NULL              COMMENT 'Delegated IPv6 prefix during session',
    nas_ip_address        VARCHAR(45)     NULL              COMMENT 'NAS IP address at time of session',
    event_type            ENUM('start','stop','interim-update') NOT NULL COMMENT 'RADIUS accounting event type',
    bytes_in              BIGINT UNSIGNED NULL              COMMENT 'Session inbound bytes (at stop/interim)',
    bytes_out             BIGINT UNSIGNED NULL              COMMENT 'Session outbound bytes (at stop/interim)',
    packets_in            BIGINT UNSIGNED NULL              COMMENT 'Session inbound packets (at stop/interim)',
    packets_out           BIGINT UNSIGNED NULL              COMMENT 'Session outbound packets (at stop/interim)',
    session_duration      INT UNSIGNED    NULL              COMMENT 'Session duration in seconds (at stop)',
    terminate_cause       VARCHAR(64)     NULL              COMMENT 'RADIUS Acct-Terminate-Cause',
    event_at              TIMESTAMP       NOT NULL          COMMENT 'When the accounting event occurred',
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acct_session_id       VARCHAR(64)     NULL              COMMENT 'FreeRADIUS Acct-Session-Id attribute (migration 230)',
    nas_port_id           VARCHAR(100)    NULL              COMMENT 'NAS-Port-Id string e.g. eth0/0/0.1 (migration 230)',
    called_station_id     VARCHAR(100)    NULL              COMMENT 'Called-Station-Id - MAC or circuit-ID (migration 230)',
    calling_station_id    VARCHAR(100)    NULL              COMMENT 'Calling-Station-Id - subscriber MAC (migration 230)',
    framed_ip             VARCHAR(45)     NULL              COMMENT 'Framed-IP-Address (migration 230)',
    framed_ipv6_prefix    VARCHAR(64)     NULL              COMMENT 'Framed-IPv6-Prefix delegated to the subscriber (migration 230)',
    acct_output_octets_v6 BIGINT UNSIGNED NULL              COMMENT 'IPv6 output (egress) octets for this session (migration 244)',
    acct_input_octets_v6  BIGINT UNSIGNED NULL              COMMENT 'IPv6 input (ingress) octets for this session (migration 244)',
    stack_type            ENUM('ipv4','ipv6','dual') NULL  COMMENT 'IP stack type for this session (migration 244)',

    PRIMARY KEY (id, event_at),
    KEY idx_conn_logs_contract_time (contract_id, event_at),
    KEY idx_conn_logs_client_time (client_id, event_at),
    KEY idx_conn_logs_username (username, event_at),
    KEY idx_conn_logs_ip_address (ip_address, event_at),
    KEY idx_connection_logs_ipv6_address (ipv6_address),
    KEY idx_conn_logs_session_id (session_id),
    KEY idx_conn_logs_acct_session_id (acct_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (UNIX_TIMESTAMP(event_at)) (
    PARTITION p2026_01 VALUES LESS THAN (UNIX_TIMESTAMP('2026-02-01')),
    PARTITION p2026_02 VALUES LESS THAN (UNIX_TIMESTAMP('2026-03-01')),
    PARTITION p2026_03 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION p2026_04 VALUES LESS THAN (UNIX_TIMESTAMP('2026-05-01')),
    PARTITION p2026_05 VALUES LESS THAN (UNIX_TIMESTAMP('2026-06-01')),
    PARTITION p2026_06 VALUES LESS THAN (UNIX_TIMESTAMP('2026-07-01')),
    PARTITION p_future  VALUES LESS THAN MAXVALUE
);

-- =============================================================================
-- SNMP Rollup Procedures & Scheduled Events
-- =============================================================================
-- MySQL equivalents of TimescaleDB continuous aggregates and retention policies.
-- Requires:  SET GLOBAL event_scheduler = ON;  (in my.cnf or at runtime)
--
-- Rollup flow : snmp_metrics (raw 5-min) -> snmp_metrics_1hr -> snmp_metrics_1day
-- Retention   : raw kept 90 days (DROP PARTITION), hourly kept 1 year (batch
--               DELETE), daily kept indefinitely (3+ years)
-- =============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_rollup_to_1hr
-- Purpose:   Aggregate raw 5-min samples into hourly rows using a
--            high-watermark so missed runs catch up automatically.
--            Idempotent via INSERT ... ON DUPLICATE KEY UPDATE.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_rollup_to_1hr()
proc: BEGIN
    DECLARE v_from_ts TIMESTAMP;
    DECLARE v_to_ts   TIMESTAMP;

    SELECT COALESCE(last_processed, DATE_SUB(NOW(), INTERVAL 90 DAY))
    INTO v_from_ts
    FROM snmp_rollup_state
    WHERE rollup_name = '1hr';

    SET v_to_ts = DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00');

    IF v_from_ts >= v_to_ts THEN
        LEAVE proc;
    END IF;

    INSERT INTO snmp_metrics_1hr
        (device_id, interface_id, period_start,
         avg_if_in_octets,       min_if_in_octets,       max_if_in_octets,
         avg_if_out_octets,      min_if_out_octets,      max_if_out_octets,
         avg_if_in_errors,       min_if_in_errors,       max_if_in_errors,
         avg_if_out_errors,      min_if_out_errors,      max_if_out_errors,
         avg_cpu_usage,          min_cpu_usage,           max_cpu_usage,
         avg_memory_usage,       min_memory_usage,        max_memory_usage,
         avg_signal_strength,    min_signal_strength,     max_signal_strength,
         avg_latency_ms,         min_latency_ms,          max_latency_ms,
         avg_voltage_mv,         min_voltage_mv,          max_voltage_mv,
         avg_temperature_c,      min_temperature_c,       max_temperature_c,
         avg_fan_speed_rpm,      min_fan_speed_rpm,       max_fan_speed_rpm,
         avg_if_in_discards,     min_if_in_discards,      max_if_in_discards,
         avg_if_out_discards,    min_if_out_discards,     max_if_out_discards,
         avg_sfp_tx_power_dbm,   min_sfp_tx_power_dbm,   max_sfp_tx_power_dbm,
         avg_sfp_rx_power_dbm,   min_sfp_rx_power_dbm,   max_sfp_rx_power_dbm,
         avg_sfp_temperature_c,  min_sfp_temperature_c,  max_sfp_temperature_c,
         avg_ups_battery_pct,    min_ups_battery_pct,     max_ups_battery_pct,
         avg_ups_runtime_min,    min_ups_runtime_min,     max_ups_runtime_min,
         avg_poe_power_mw,       min_poe_power_mw,        max_poe_power_mw,
         avg_humidity_pct,       min_humidity_pct,        max_humidity_pct,
         sample_count)
    SELECT
        device_id,
        COALESCE(interface_id, '')                        AS interface_id,
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')       AS period_start,
        AVG(if_in_octets),       MIN(if_in_octets),       MAX(if_in_octets),
        AVG(if_out_octets),      MIN(if_out_octets),      MAX(if_out_octets),
        AVG(if_in_errors),       MIN(if_in_errors),       MAX(if_in_errors),
        AVG(if_out_errors),      MIN(if_out_errors),      MAX(if_out_errors),
        AVG(cpu_usage),          MIN(cpu_usage),           MAX(cpu_usage),
        AVG(memory_usage),       MIN(memory_usage),        MAX(memory_usage),
        AVG(signal_strength),    MIN(signal_strength),     MAX(signal_strength),
        AVG(latency_ms),         MIN(latency_ms),          MAX(latency_ms),
        AVG(voltage_mv),         MIN(voltage_mv),          MAX(voltage_mv),
        AVG(temperature_c),      MIN(temperature_c),       MAX(temperature_c),
        AVG(fan_speed_rpm),      MIN(fan_speed_rpm),       MAX(fan_speed_rpm),
        AVG(if_in_discards),     MIN(if_in_discards),      MAX(if_in_discards),
        AVG(if_out_discards),    MIN(if_out_discards),     MAX(if_out_discards),
        AVG(sfp_tx_power_dbm),   MIN(sfp_tx_power_dbm),   MAX(sfp_tx_power_dbm),
        AVG(sfp_rx_power_dbm),   MIN(sfp_rx_power_dbm),   MAX(sfp_rx_power_dbm),
        AVG(sfp_temperature_c),  MIN(sfp_temperature_c),  MAX(sfp_temperature_c),
        AVG(ups_battery_pct),    MIN(ups_battery_pct),     MAX(ups_battery_pct),
        AVG(ups_runtime_min),    MIN(ups_runtime_min),     MAX(ups_runtime_min),
        AVG(poe_power_mw),       MIN(poe_power_mw),        MAX(poe_power_mw),
        AVG(humidity_pct),       MIN(humidity_pct),        MAX(humidity_pct),
        COUNT(*)
    FROM snmp_metrics
    WHERE polled_at >  v_from_ts
      AND polled_at <  v_to_ts
    GROUP BY
        device_id,
        COALESCE(interface_id, ''),
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets       = VALUES(avg_if_in_octets),
        min_if_in_octets       = VALUES(min_if_in_octets),
        max_if_in_octets       = VALUES(max_if_in_octets),
        avg_if_out_octets      = VALUES(avg_if_out_octets),
        min_if_out_octets      = VALUES(min_if_out_octets),
        max_if_out_octets      = VALUES(max_if_out_octets),
        avg_if_in_errors       = VALUES(avg_if_in_errors),
        min_if_in_errors       = VALUES(min_if_in_errors),
        max_if_in_errors       = VALUES(max_if_in_errors),
        avg_if_out_errors      = VALUES(avg_if_out_errors),
        min_if_out_errors      = VALUES(min_if_out_errors),
        max_if_out_errors      = VALUES(max_if_out_errors),
        avg_cpu_usage          = VALUES(avg_cpu_usage),
        min_cpu_usage          = VALUES(min_cpu_usage),
        max_cpu_usage          = VALUES(max_cpu_usage),
        avg_memory_usage       = VALUES(avg_memory_usage),
        min_memory_usage       = VALUES(min_memory_usage),
        max_memory_usage       = VALUES(max_memory_usage),
        avg_signal_strength    = VALUES(avg_signal_strength),
        min_signal_strength    = VALUES(min_signal_strength),
        max_signal_strength    = VALUES(max_signal_strength),
        avg_latency_ms         = VALUES(avg_latency_ms),
        min_latency_ms         = VALUES(min_latency_ms),
        max_latency_ms         = VALUES(max_latency_ms),
        avg_voltage_mv         = VALUES(avg_voltage_mv),
        min_voltage_mv         = VALUES(min_voltage_mv),
        max_voltage_mv         = VALUES(max_voltage_mv),
        avg_temperature_c      = VALUES(avg_temperature_c),
        min_temperature_c      = VALUES(min_temperature_c),
        max_temperature_c      = VALUES(max_temperature_c),
        avg_fan_speed_rpm      = VALUES(avg_fan_speed_rpm),
        min_fan_speed_rpm      = VALUES(min_fan_speed_rpm),
        max_fan_speed_rpm      = VALUES(max_fan_speed_rpm),
        avg_if_in_discards     = VALUES(avg_if_in_discards),
        min_if_in_discards     = VALUES(min_if_in_discards),
        max_if_in_discards     = VALUES(max_if_in_discards),
        avg_if_out_discards    = VALUES(avg_if_out_discards),
        min_if_out_discards    = VALUES(min_if_out_discards),
        max_if_out_discards    = VALUES(max_if_out_discards),
        avg_sfp_tx_power_dbm   = VALUES(avg_sfp_tx_power_dbm),
        min_sfp_tx_power_dbm   = VALUES(min_sfp_tx_power_dbm),
        max_sfp_tx_power_dbm   = VALUES(max_sfp_tx_power_dbm),
        avg_sfp_rx_power_dbm   = VALUES(avg_sfp_rx_power_dbm),
        min_sfp_rx_power_dbm   = VALUES(min_sfp_rx_power_dbm),
        max_sfp_rx_power_dbm   = VALUES(max_sfp_rx_power_dbm),
        avg_sfp_temperature_c  = VALUES(avg_sfp_temperature_c),
        min_sfp_temperature_c  = VALUES(min_sfp_temperature_c),
        max_sfp_temperature_c  = VALUES(max_sfp_temperature_c),
        avg_ups_battery_pct    = VALUES(avg_ups_battery_pct),
        min_ups_battery_pct    = VALUES(min_ups_battery_pct),
        max_ups_battery_pct    = VALUES(max_ups_battery_pct),
        avg_ups_runtime_min    = VALUES(avg_ups_runtime_min),
        min_ups_runtime_min    = VALUES(min_ups_runtime_min),
        max_ups_runtime_min    = VALUES(max_ups_runtime_min),
        avg_poe_power_mw       = VALUES(avg_poe_power_mw),
        min_poe_power_mw       = VALUES(min_poe_power_mw),
        max_poe_power_mw       = VALUES(max_poe_power_mw),
        avg_humidity_pct       = VALUES(avg_humidity_pct),
        min_humidity_pct       = VALUES(min_humidity_pct),
        max_humidity_pct       = VALUES(max_humidity_pct),
        sample_count           = VALUES(sample_count);

    UPDATE snmp_rollup_state
    SET last_processed = v_to_ts
    WHERE rollup_name  = '1hr';
END$$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_rollup_to_1day
-- Purpose:   Aggregate hourly rows into daily rows using a high-watermark.
--            Idempotent via ON DUPLICATE KEY UPDATE.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_rollup_to_1day()
proc: BEGIN
    DECLARE v_from_date DATE;
    DECLARE v_to_date   DATE;

    SELECT COALESCE(DATE(last_processed), DATE_SUB(CURDATE(), INTERVAL 1 YEAR))
    INTO v_from_date
    FROM snmp_rollup_state
    WHERE rollup_name = '1day';

    SET v_to_date = CURDATE();

    IF v_from_date >= v_to_date THEN
        LEAVE proc;
    END IF;

    INSERT INTO snmp_metrics_1day
        (device_id, interface_id, period_start,
         avg_if_in_octets,       min_if_in_octets,       max_if_in_octets,
         avg_if_out_octets,      min_if_out_octets,      max_if_out_octets,
         avg_if_in_errors,       min_if_in_errors,       max_if_in_errors,
         avg_if_out_errors,      min_if_out_errors,      max_if_out_errors,
         avg_cpu_usage,          min_cpu_usage,           max_cpu_usage,
         avg_memory_usage,       min_memory_usage,        max_memory_usage,
         avg_signal_strength,    min_signal_strength,     max_signal_strength,
         avg_latency_ms,         min_latency_ms,          max_latency_ms,
         avg_voltage_mv,         min_voltage_mv,          max_voltage_mv,
         avg_temperature_c,      min_temperature_c,       max_temperature_c,
         avg_fan_speed_rpm,      min_fan_speed_rpm,       max_fan_speed_rpm,
         avg_if_in_discards,     min_if_in_discards,      max_if_in_discards,
         avg_if_out_discards,    min_if_out_discards,     max_if_out_discards,
         avg_sfp_tx_power_dbm,   min_sfp_tx_power_dbm,   max_sfp_tx_power_dbm,
         avg_sfp_rx_power_dbm,   min_sfp_rx_power_dbm,   max_sfp_rx_power_dbm,
         avg_sfp_temperature_c,  min_sfp_temperature_c,  max_sfp_temperature_c,
         avg_ups_battery_pct,    min_ups_battery_pct,     max_ups_battery_pct,
         avg_ups_runtime_min,    min_ups_runtime_min,     max_ups_runtime_min,
         avg_poe_power_mw,       min_poe_power_mw,        max_poe_power_mw,
         avg_humidity_pct,       min_humidity_pct,        max_humidity_pct,
         sample_count)
    SELECT
        device_id,
        interface_id,
        DATE(period_start)                                     AS period_start,
        AVG(avg_if_in_octets),       MIN(min_if_in_octets),       MAX(max_if_in_octets),
        AVG(avg_if_out_octets),      MIN(min_if_out_octets),      MAX(max_if_out_octets),
        AVG(avg_if_in_errors),       MIN(min_if_in_errors),       MAX(max_if_in_errors),
        AVG(avg_if_out_errors),      MIN(min_if_out_errors),      MAX(max_if_out_errors),
        AVG(avg_cpu_usage),          MIN(min_cpu_usage),           MAX(max_cpu_usage),
        AVG(avg_memory_usage),       MIN(min_memory_usage),        MAX(max_memory_usage),
        AVG(avg_signal_strength),    MIN(min_signal_strength),     MAX(max_signal_strength),
        AVG(avg_latency_ms),         MIN(min_latency_ms),          MAX(max_latency_ms),
        AVG(avg_voltage_mv),         MIN(min_voltage_mv),          MAX(max_voltage_mv),
        AVG(avg_temperature_c),      MIN(min_temperature_c),       MAX(max_temperature_c),
        AVG(avg_fan_speed_rpm),      MIN(min_fan_speed_rpm),       MAX(max_fan_speed_rpm),
        AVG(avg_if_in_discards),     MIN(min_if_in_discards),      MAX(max_if_in_discards),
        AVG(avg_if_out_discards),    MIN(min_if_out_discards),     MAX(max_if_out_discards),
        AVG(avg_sfp_tx_power_dbm),   MIN(min_sfp_tx_power_dbm),   MAX(max_sfp_tx_power_dbm),
        AVG(avg_sfp_rx_power_dbm),   MIN(min_sfp_rx_power_dbm),   MAX(max_sfp_rx_power_dbm),
        AVG(avg_sfp_temperature_c),  MIN(min_sfp_temperature_c),  MAX(max_sfp_temperature_c),
        AVG(avg_ups_battery_pct),    MIN(min_ups_battery_pct),     MAX(max_ups_battery_pct),
        AVG(avg_ups_runtime_min),    MIN(min_ups_runtime_min),     MAX(max_ups_runtime_min),
        AVG(avg_poe_power_mw),       MIN(min_poe_power_mw),        MAX(max_poe_power_mw),
        AVG(avg_humidity_pct),       MIN(min_humidity_pct),        MAX(max_humidity_pct),
        SUM(sample_count)
    FROM snmp_metrics_1hr
    WHERE period_start >= v_from_date
      AND period_start <  v_to_date
    GROUP BY device_id, interface_id, DATE(period_start)
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets       = VALUES(avg_if_in_octets),
        min_if_in_octets       = VALUES(min_if_in_octets),
        max_if_in_octets       = VALUES(max_if_in_octets),
        avg_if_out_octets      = VALUES(avg_if_out_octets),
        min_if_out_octets      = VALUES(min_if_out_octets),
        max_if_out_octets      = VALUES(max_if_out_octets),
        avg_if_in_errors       = VALUES(avg_if_in_errors),
        min_if_in_errors       = VALUES(min_if_in_errors),
        max_if_in_errors       = VALUES(max_if_in_errors),
        avg_if_out_errors      = VALUES(avg_if_out_errors),
        min_if_out_errors      = VALUES(min_if_out_errors),
        max_if_out_errors      = VALUES(max_if_out_errors),
        avg_cpu_usage          = VALUES(avg_cpu_usage),
        min_cpu_usage          = VALUES(min_cpu_usage),
        max_cpu_usage          = VALUES(max_cpu_usage),
        avg_memory_usage       = VALUES(avg_memory_usage),
        min_memory_usage       = VALUES(min_memory_usage),
        max_memory_usage       = VALUES(max_memory_usage),
        avg_signal_strength    = VALUES(avg_signal_strength),
        min_signal_strength    = VALUES(min_signal_strength),
        max_signal_strength    = VALUES(max_signal_strength),
        avg_latency_ms         = VALUES(avg_latency_ms),
        min_latency_ms         = VALUES(min_latency_ms),
        max_latency_ms         = VALUES(max_latency_ms),
        avg_voltage_mv         = VALUES(avg_voltage_mv),
        min_voltage_mv         = VALUES(min_voltage_mv),
        max_voltage_mv         = VALUES(max_voltage_mv),
        avg_temperature_c      = VALUES(avg_temperature_c),
        min_temperature_c      = VALUES(min_temperature_c),
        max_temperature_c      = VALUES(max_temperature_c),
        avg_fan_speed_rpm      = VALUES(avg_fan_speed_rpm),
        min_fan_speed_rpm      = VALUES(min_fan_speed_rpm),
        max_fan_speed_rpm      = VALUES(max_fan_speed_rpm),
        avg_if_in_discards     = VALUES(avg_if_in_discards),
        min_if_in_discards     = VALUES(min_if_in_discards),
        max_if_in_discards     = VALUES(max_if_in_discards),
        avg_if_out_discards    = VALUES(avg_if_out_discards),
        min_if_out_discards    = VALUES(min_if_out_discards),
        max_if_out_discards    = VALUES(max_if_out_discards),
        avg_sfp_tx_power_dbm   = VALUES(avg_sfp_tx_power_dbm),
        min_sfp_tx_power_dbm   = VALUES(min_sfp_tx_power_dbm),
        max_sfp_tx_power_dbm   = VALUES(max_sfp_tx_power_dbm),
        avg_sfp_rx_power_dbm   = VALUES(avg_sfp_rx_power_dbm),
        min_sfp_rx_power_dbm   = VALUES(min_sfp_rx_power_dbm),
        max_sfp_rx_power_dbm   = VALUES(max_sfp_rx_power_dbm),
        avg_sfp_temperature_c  = VALUES(avg_sfp_temperature_c),
        min_sfp_temperature_c  = VALUES(min_sfp_temperature_c),
        max_sfp_temperature_c  = VALUES(max_sfp_temperature_c),
        avg_ups_battery_pct    = VALUES(avg_ups_battery_pct),
        min_ups_battery_pct    = VALUES(min_ups_battery_pct),
        max_ups_battery_pct    = VALUES(max_ups_battery_pct),
        avg_ups_runtime_min    = VALUES(avg_ups_runtime_min),
        min_ups_runtime_min    = VALUES(min_ups_runtime_min),
        max_ups_runtime_min    = VALUES(max_ups_runtime_min),
        avg_poe_power_mw       = VALUES(avg_poe_power_mw),
        min_poe_power_mw       = VALUES(min_poe_power_mw),
        max_poe_power_mw       = VALUES(max_poe_power_mw),
        avg_humidity_pct       = VALUES(avg_humidity_pct),
        min_humidity_pct       = VALUES(min_humidity_pct),
        max_humidity_pct       = VALUES(max_humidity_pct),
        sample_count           = VALUES(sample_count);

    UPDATE snmp_rollup_state
    SET last_processed = TIMESTAMP(v_to_date)
    WHERE rollup_name  = '1day';
END$$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_apply_retention
-- Purpose:   Purge hourly rows older than 1 year via batch DELETE.
--            Daily rows are kept indefinitely (3+ years).
--            Raw snmp_metrics retention is handled by snmp_maintain_partitions()
--            using instant DROP PARTITION.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_apply_retention()
BEGIN
    DECLARE rows_deleted INT DEFAULT 1;

    WHILE rows_deleted > 0 DO
        DELETE FROM snmp_metrics_1hr
        WHERE period_start < DATE_SUB(NOW(), INTERVAL 1 YEAR)
        LIMIT 10000;
        SET rows_deleted = ROW_COUNT();
    END WHILE;
END$$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_maintain_partitions
-- Purpose:   (1) Ensure monthly partitions exist for the next 3 months by
--                reorganising p_future before it is needed.
--            (2) Drop partitions whose upper bound is older than 90 days
--                (instant operation -- replaces batch-DELETE retention for
--                raw snmp_metrics).
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_maintain_partitions()
BEGIN
    DECLARE v_month     DATE;
    DECLARE v_pname     VARCHAR(32);
    DECLARE v_next_ts   BIGINT;
    DECLARE v_exists    INT  DEFAULT 0;
    DECLARE v_cutoff_ts BIGINT;
    DECLARE v_old_pname VARCHAR(32);
    DECLARE v_done      TINYINT DEFAULT 0;

    DECLARE c_old CURSOR FOR
        SELECT partition_name
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'snmp_metrics'
          AND partition_name != 'p_future'
          AND partition_description != 'MAXVALUE'
          AND CAST(partition_description AS UNSIGNED) <= v_cutoff_ts;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    -- Ensure partitions exist for the next 3 full months
    SET v_month = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01');

    WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
        SET v_pname   = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
        SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));

        SELECT COUNT(*) INTO v_exists
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'snmp_metrics'
          AND partition_name = v_pname;

        IF v_exists = 0 THEN
            SET @sql = CONCAT(
                'ALTER TABLE snmp_metrics REORGANIZE PARTITION p_future INTO (',
                'PARTITION ', v_pname, ' VALUES LESS THAN (', v_next_ts, '), ',
                'PARTITION p_future VALUES LESS THAN MAXVALUE)'
            );
            PREPARE stmt FROM @sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END IF;

        SET v_month = DATE_ADD(v_month, INTERVAL 1 MONTH);
    END WHILE;

    -- Drop partitions older than 90 days
    SET v_cutoff_ts = UNIX_TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 90 DAY));
    SET v_done = 0;

    OPEN c_old;
    drop_loop: LOOP
        FETCH c_old INTO v_old_pname;
        IF v_done THEN LEAVE drop_loop; END IF;
        SET @sql = CONCAT('ALTER TABLE snmp_metrics DROP PARTITION ', v_old_pname);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END LOOP;
    CLOSE c_old;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Scheduled events (require event_scheduler = ON)
-- ---------------------------------------------------------------------------

-- Run hourly rollup every hour at minute :05
CREATE EVENT IF NOT EXISTS evt_snmp_rollup_1hr
    ON SCHEDULE EVERY 1 HOUR
    STARTS DATE_FORMAT(NOW() + INTERVAL 1 HOUR, '%Y-%m-%d %H:05:00')
    ON COMPLETION PRESERVE
    COMMENT 'Aggregate raw SNMP samples into snmp_metrics_1hr every hour'
    DO CALL snmp_rollup_to_1hr();

-- Run daily rollup once per day at 00:30
CREATE EVENT IF NOT EXISTS evt_snmp_rollup_1day
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 30 MINUTE)
    ON COMPLETION PRESERVE
    COMMENT 'Aggregate hourly SNMP rows into snmp_metrics_1day once per day'
    DO CALL snmp_rollup_to_1day();

-- Run retention purge once per day at 02:00 (hourly data only)
CREATE EVENT IF NOT EXISTS evt_snmp_retention
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 2 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Purge hourly SNMP data older than 1 year'
    DO CALL snmp_apply_retention();

-- Run partition maintenance daily at 03:00
CREATE EVENT IF NOT EXISTS evt_snmp_partition_maintenance
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Maintain snmp_metrics monthly partitions: add future, drop expired'
    DO CALL snmp_maintain_partitions();

-- =============================================================================
-- Connection Logs Partition Maintenance
-- =============================================================================
-- Retention: connection_logs kept 2 years (DROP PARTITION â€” compliance)
-- =============================================================================

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Procedure: connection_logs_maintain_partitions
-- Purpose:   (1) Ensure monthly partitions exist for the next 3 months on
--                connection_logs by reorganising p_future.
--            (2) Drop connection_logs partitions older than 2 years.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS connection_logs_maintain_partitions()
BEGIN
    DECLARE v_month     DATE;
    DECLARE v_pname     VARCHAR(32);
    DECLARE v_next_ts   BIGINT;
    DECLARE v_exists    INT DEFAULT 0;

    -- -------------------------------------------------------------------
    -- 1. Ensure connection_logs has partitions for the next 3 full months
    -- -------------------------------------------------------------------
    SET v_month = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01');

    WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
        SET v_pname   = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
        SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));

        SELECT COUNT(*) INTO v_exists
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'connection_logs'
          AND partition_name = v_pname;

        IF v_exists = 0 THEN
            SET @sql = CONCAT(
                'ALTER TABLE connection_logs REORGANIZE PARTITION p_future INTO (',
                'PARTITION ', v_pname, ' VALUES LESS THAN (', v_next_ts, '), ',
                'PARTITION p_future VALUES LESS THAN MAXVALUE)'
            );
            PREPARE stmt FROM @sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END IF;

        SET v_month = DATE_ADD(v_month, INTERVAL 1 MONTH);
    END WHILE;

    -- -------------------------------------------------------------------
    -- 2. Drop connection_logs partitions older than 2 years
    -- -------------------------------------------------------------------
    BEGIN
        DECLARE v_cutoff_cl BIGINT;
        DECLARE v_old_cl    VARCHAR(32);
        DECLARE v_done_cl   TINYINT DEFAULT 0;

        DECLARE c_old_cl CURSOR FOR
            SELECT partition_name
            FROM information_schema.PARTITIONS
            WHERE table_schema = DATABASE()
              AND table_name   = 'connection_logs'
              AND partition_name != 'p_future'
              AND partition_description != 'MAXVALUE'
              AND CAST(partition_description AS UNSIGNED) <= v_cutoff_cl;

        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_cl = 1;

        SET v_cutoff_cl = UNIX_TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 YEAR));

        OPEN c_old_cl;
        drop_cl_loop: LOOP
            FETCH c_old_cl INTO v_old_cl;
            IF v_done_cl THEN LEAVE drop_cl_loop; END IF;
            SET @sql = CONCAT('ALTER TABLE connection_logs DROP PARTITION ', v_old_cl);
            PREPARE stmt FROM @sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END LOOP;
        CLOSE c_old_cl;
    END;
END$$

DELIMITER ;

-- Run connection_logs partition maintenance daily at 03:30
CREATE EVENT IF NOT EXISTS evt_connection_logs_partition_maintenance
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR + INTERVAL 30 MINUTE)
    ON COMPLETION PRESERVE
    COMMENT 'Maintain connection_logs monthly partitions: add future, drop expired (2-year retention)'
    DO CALL connection_logs_maintain_partitions();

-- ---------------------------------------------------------------------------
-- Table: warehouses
-- Purpose: Physical storage locations for spare equipment and materials.
--          Multiple warehouses supported; aisle/column/shelf granularity is
--          tracked at the inventory_stock level.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this warehouse belongs to; NULL = single-tenant deployment',
    name            VARCHAR(255)    NOT NULL COMMENT 'Warehouse name (e.g. Main Warehouse, Site B Storage)',
    address         VARCHAR(255)    NULL,
    city            VARCHAR(100)    NULL,
    state           VARCHAR(100)    NULL,
    country         VARCHAR(100)    NULL DEFAULT 'US',
    zip_code        VARCHAR(20)     NULL,
    latitude        DECIMAL(10, 8)  NULL,
    longitude       DECIMAL(11, 8)  NULL,
    notes           TEXT            NULL,
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_warehouses_organization_id (organization_id),
    KEY idx_warehouses_status (status),
    KEY idx_warehouses_deleted_at (deleted_at),
    CONSTRAINT fk_warehouses_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: inventory_items
-- Purpose: Catalog of spare equipment and materials that can be stocked in
--          warehouses (antennas, cables, routers, ONUs, connectors, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_items (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this inventory item belongs to; NULL = single-tenant deployment',
    sku             VARCHAR(100)    NULL COMMENT 'Stock-keeping unit / internal part number',
    name            VARCHAR(255)    NOT NULL COMMENT 'Item name (e.g. MikroTik hAP acÂ³)',
    category        ENUM(
                        'antenna',
                        'cable',
                        'router',
                        'switch',
                        'onu',
                        'olt',
                        'cpe',
                        'connector',
                        'power_supply',
                        'enclosure',
                        'tool',
                        'other'
                    ) NOT NULL DEFAULT 'other'
                        COMMENT 'Item category for filtering and reporting',
    manufacturer    VARCHAR(100)    NULL,
    model           VARCHAR(100)    NULL,
    description     TEXT            NULL,
    unit            VARCHAR(30)     NOT NULL DEFAULT 'unit'
                        COMMENT 'Unit of measure (unit, meter, roll, box, pair, etc.)',
    unit_cost       DECIMAL(10, 2)  NULL COMMENT 'Default purchase cost per unit',
    sale_price      DECIMAL(10, 2)  NULL COMMENT 'Default sale price per unit when sold to a client',
    reorder_level   INT UNSIGNED    NULL COMMENT 'Minimum total stock before a reorder alert is triggered',
    notes           TEXT            NULL,
    status          ENUM('active', 'discontinued') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_items_sku (sku),
    KEY idx_inventory_items_organization_id (organization_id),
    KEY idx_inventory_items_category (category),
    KEY idx_inventory_items_status (status),
    KEY idx_inventory_items_deleted_at (deleted_at),
    CONSTRAINT fk_inventory_items_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: inventory_stock
-- Purpose: Current stock level of each item at each warehouse location.
--          Each row represents a unique combination of item + warehouse +
--          aisle/column/shelf.  Granular location fields are optional.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_stock (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    item_id       BIGINT UNSIGNED NOT NULL,
    warehouse_id  BIGINT UNSIGNED NOT NULL,
    aisle         VARCHAR(20)     NULL COMMENT 'Aisle identifier within the warehouse',
    col           VARCHAR(20)     NULL COMMENT 'Column identifier within the aisle',
    shelf         VARCHAR(20)     NULL COMMENT 'Shelf identifier within the column',
    quantity      INT             NOT NULL DEFAULT 0 COMMENT 'Current quantity on hand',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_stock_location (item_id, warehouse_id, aisle, col, shelf),
    KEY idx_inventory_stock_warehouse_id (warehouse_id),
    KEY idx_inventory_stock_item_id (item_id),
    KEY idx_inventory_stock_deleted_at (deleted_at),
    CONSTRAINT fk_inventory_stock_item FOREIGN KEY (item_id)
        REFERENCES inventory_items (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inventory_stock_warehouse FOREIGN KEY (warehouse_id)
        REFERENCES warehouses (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: inventory_transactions
-- Purpose: Immutable log of every stock movement â€” receiving, job assignments,
--          client sales, warehouse transfers, returns, and adjustments.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    stock_id          BIGINT UNSIGNED NOT NULL COMMENT 'inventory_stock row affected',
    transaction_type  ENUM(
                          'receive',
                          'assign_to_job',
                          'sell_to_client',
                          'transfer_out',
                          'transfer_in',
                          'return',
                          'adjustment'
                      ) NOT NULL
                          COMMENT 'receive=new stock in, assign_to_job=used on a work order, sell_to_client=sold directly to client, transfer_out/in=warehouse-to-warehouse move, return=returned from job/client, adjustment=manual correction',
    quantity          INT             NOT NULL COMMENT 'Positive for inbound, negative for outbound',
    unit_price        DECIMAL(10, 2)  NULL COMMENT 'Price per unit at time of transaction (for sales/receives)',

    -- Optional context references
    job_id            BIGINT UNSIGNED NULL COMMENT 'Related job (assign_to_job / return)',
    client_id         BIGINT UNSIGNED NULL COMMENT 'Related client (sell_to_client)',
    invoice_id        BIGINT UNSIGNED NULL COMMENT 'Invoice tied to a client sale, if any',
    destination_stock_id BIGINT UNSIGNED NULL COMMENT 'Target inventory_stock row for transfers',

    performed_by      BIGINT UNSIGNED NULL COMMENT 'User who performed the transaction',
    reference         VARCHAR(255)    NULL COMMENT 'External reference (PO number, receipt, etc.)',
    notes             TEXT            NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_inv_txn_stock_id (stock_id),
    KEY idx_inv_txn_type (transaction_type),
    KEY idx_inv_txn_job_id (job_id),
    KEY idx_inv_txn_client_id (client_id),
    KEY idx_inv_txn_invoice_id (invoice_id),
    KEY idx_inv_txn_destination_stock_id (destination_stock_id),
    KEY idx_inv_txn_performed_by (performed_by),
    KEY idx_inv_txn_created_at (created_at),
    CONSTRAINT fk_inv_txn_stock FOREIGN KEY (stock_id)
        REFERENCES inventory_stock (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_job FOREIGN KEY (job_id)
        REFERENCES jobs (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_destination_stock FOREIGN KEY (destination_stock_id)
        REFERENCES inventory_stock (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_inv_txn_performed_by FOREIGN KEY (performed_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: credit_notes
-- Purpose: Credits issued to clients â€” for returns, courtesy adjustments,
--          service outages, billing errors, duplicate payments, downgrades,
--          cancellations, or other reasons. Optionally linked to the original
--          invoice being credited.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_notes (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id    BIGINT UNSIGNED NULL      COMMENT 'Owning tenant organisation; NULL = single-tenant deployment',
    client_id          BIGINT UNSIGNED NOT NULL,
    contract_id        BIGINT UNSIGNED NULL,
    invoice_id         BIGINT UNSIGNED NULL      COMMENT 'Original invoice being credited, if any',
    payment_id         BIGINT UNSIGNED NULL      COMMENT 'Payment that triggered this credit note (e.g. duplicate payment refund)',
    credit_note_number VARCHAR(50)     NOT NULL,
    issue_date         DATE            NOT NULL DEFAULT (CURRENT_DATE) COMMENT 'Date this credit note was issued',
    reason             ENUM(
                           'billing_error',
                           'service_interruption',
                           'overpayment',
                           'promotional_credit',
                           'contract_cancellation',
                           'other'
                       ) NOT NULL
                           COMMENT 'Reason the credit note was issued',
    subtotal           DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    tax_rate           DECIMAL(5, 4)   NOT NULL DEFAULT 0.0000 COMMENT 'e.g. 0.0800 for 8%',
    tax_amount         DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    total              DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    currency           CHAR(3)         NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code',
    tax_rate_id        BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    notes              TEXT            NULL,
    status             ENUM('draft', 'issued', 'applied', 'cancelled') NOT NULL DEFAULT 'draft'
                           COMMENT 'draft=being prepared; issued=sent to client; applied=credit applied to account; cancelled=voided',
    applied_at         TIMESTAMP       NULL      COMMENT 'When the credit was applied to the client account',
    created_by         BIGINT UNSIGNED NULL,
    created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_credit_notes_number (credit_note_number),
    KEY idx_credit_notes_organization_id (organization_id),
    KEY idx_credit_notes_client_id (client_id),
    KEY idx_credit_notes_contract_id (contract_id),
    KEY idx_credit_notes_invoice_id (invoice_id),
    KEY idx_credit_notes_payment_id (payment_id),
    KEY idx_credit_notes_status (status),
    KEY idx_credit_notes_reason (reason),
    KEY idx_credit_notes_issue_date (issue_date),
    KEY idx_credit_notes_tax_rate_id (tax_rate_id),
    KEY idx_credit_notes_deleted_at (deleted_at),
    CONSTRAINT fk_credit_notes_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: credit_note_items
-- Purpose: Individual line items that make up a credit note's subtotal
--          (same pattern as invoice_items)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_note_items (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    credit_note_id  BIGINT UNSIGNED NOT NULL,
    description     VARCHAR(255)    NOT NULL COMMENT 'Line-item description e.g. returned router, service outage compensation',
    quantity        DECIMAL(10, 2)  NOT NULL DEFAULT 1.00,
    unit_price      DECIMAL(10, 2)  NOT NULL,
    tax_rate_id     BIGINT UNSIGNED NULL COMMENT 'Per-line-item tax rate override; NULL = inherit from parent credit note',
    total           DECIMAL(10, 2)  GENERATED ALWAYS AS (quantity * unit_price) STORED COMMENT 'quantity * unit_price',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_credit_note_items_credit_note_id (credit_note_id),
    KEY idx_credit_note_items_tax_rate_id (tax_rate_id),
    KEY idx_credit_note_items_deleted_at (deleted_at),
    CONSTRAINT fk_credit_note_items_credit_note FOREIGN KEY (credit_note_id)
        REFERENCES credit_notes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_credit_note_items_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: billing_periods
-- Purpose: Tracks each contract's billing windows â€” which periods have been
--          invoiced, which are upcoming, and when the next invoice should be
--          auto-generated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_periods (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_id     BIGINT UNSIGNED NOT NULL  COMMENT 'Contract this billing period belongs to',
    period_start    DATE            NOT NULL  COMMENT 'First day of the billing window (inclusive)',
    period_end      DATE            NOT NULL  COMMENT 'Last day of the billing window (inclusive)',
    invoice_id      BIGINT UNSIGNED NULL      COMMENT 'Invoice generated for this period; NULL = not yet invoiced',
    status          ENUM('pending', 'invoiced', 'skipped')
                        NOT NULL DEFAULT 'pending'
                        COMMENT 'pending = awaiting invoice generation; invoiced = invoice created; skipped = manually skipped',
    scheduled_at    DATE            NOT NULL  COMMENT 'Date when the invoice should be auto-generated for this period',
    invoiced_at     TIMESTAMP       NULL      COMMENT 'Timestamp when the invoice was actually generated',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_billing_periods_contract_period (contract_id, period_start),
    UNIQUE KEY uq_billing_period_contract_dates (contract_id, period_start, period_end),
    KEY idx_billing_periods_contract_id (contract_id),
    KEY idx_billing_periods_invoice_id (invoice_id),
    KEY idx_billing_periods_status (status),
    KEY idx_billing_periods_scheduled_at (scheduled_at),
    CONSTRAINT fk_billing_periods_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_billing_periods_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_billing_periods_invoiced CHECK (
        status != 'invoiced' OR invoice_id IS NOT NULL
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: network_links
-- Purpose: Device-to-device connections â€” fiber, wireless, copper, or virtual
--          links between two devices, with optional capacity and interface info.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS network_links (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization this network link belongs to; NULL = single-tenant deployment',
    device_a_id     BIGINT UNSIGNED NOT NULL  COMMENT 'First endpoint device',
    device_b_id     BIGINT UNSIGNED NOT NULL  COMMENT 'Second endpoint device',
    link_type       ENUM('fiber', 'wireless', 'copper', 'virtual', 'other')
                        NOT NULL DEFAULT 'fiber'
                        COMMENT 'Physical or logical medium connecting the two devices',
    capacity_mbps   INT UNSIGNED    NULL      COMMENT 'Link capacity in Mbps (e.g. 1000 = 1 Gbps)',
    -- §9.2 PTP/wireless monitoring columns (migration 282)
    tx_signal_dbm   DECIMAL(7,2)    NULL      COMMENT 'Tx signal strength in dBm (PTP/wireless links)',
    rx_signal_dbm   DECIMAL(7,2)    NULL      COMMENT 'Rx signal strength in dBm (PTP/wireless links)',
    modulation      VARCHAR(50)     NULL      COMMENT 'Modulation mode e.g. QPSK, 16QAM, 64QAM, 256QAM, 1024QAM',
    tx_throughput_mbps DECIMAL(10,3) NULL     COMMENT 'Current Tx throughput in Mbps',
    rx_throughput_mbps DECIMAL(10,3) NULL     COMMENT 'Current Rx throughput in Mbps',
    link_budget_db  DECIMAL(7,2)    NULL      COMMENT 'Calculated link budget in dB (FSPL - losses + Tx power + gain)',
    failover_link_id BIGINT UNSIGNED NULL     COMMENT 'FK to network_links — backup link for failover (no FK constraint)',
    is_primary      TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '1=primary link, 0=backup/failover link',
    failover_state  ENUM('normal','failed_over','recovering') NOT NULL DEFAULT 'normal',
    medium          ENUM('fiber','wireless','copper') NULL
                        COMMENT 'Physical medium of the link',
    role            ENUM('access','distribution','backhaul','core') NULL
                        COMMENT 'Logical role in the network topology',
    interface_a     VARCHAR(100)    NULL      COMMENT 'Interface name on device A (e.g. eth0, ether1, ge-0/0/0)',
    interface_b     VARCHAR(100)    NULL      COMMENT 'Interface name on device B',
    status          ENUM('active', 'down', 'maintenance', 'decommissioned')
                        NOT NULL DEFAULT 'active'
                        COMMENT 'Operational status of the link',
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_network_links_organization_id (organization_id),
    KEY idx_network_links_device_a_id (device_a_id),
    KEY idx_network_links_device_b_id (device_b_id),
    KEY idx_network_links_link_type (link_type),
    KEY idx_network_links_status (status),
    KEY idx_network_links_deleted_at (deleted_at),
    CONSTRAINT fk_network_links_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_network_links_device_a FOREIGN KEY (device_a_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_network_links_device_b FOREIGN KEY (device_b_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_network_links_different_devices CHECK (device_a_id != device_b_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ap_channel_plans (§9.1)
-- Purpose: Channel assignment registry per site for AP frequency planning.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_channel_plans (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    site_id         BIGINT UNSIGNED NOT NULL COMMENT 'Site this channel plan belongs to',
    name            VARCHAR(100)    NOT NULL COMMENT 'Descriptive name for this channel plan',
    frequency_mhz   INT             NOT NULL COMMENT 'Center frequency in MHz (e.g. 5180, 5785)',
    channel_width_mhz SMALLINT      NOT NULL COMMENT 'Channel width in MHz (e.g. 20, 40, 80)',
    notes           TEXT            NULL,
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ap_channel_plans_organization_id (organization_id),
    KEY idx_ap_channel_plans_site_id (site_id),
    KEY idx_ap_channel_plans_status (status),
    KEY idx_ap_channel_plans_deleted_at (deleted_at),
    CONSTRAINT fk_ap_channel_plans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ap_channel_plans_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Channel assignment registry per site for AP frequency planning';

-- ---------------------------------------------------------------------------
-- Table: ap_sector_configs (§9.1)
-- Purpose: AP-specific wireless RF configuration per sector device.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_sector_configs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    device_id           BIGINT UNSIGNED NOT NULL COMMENT 'AP/PTP device (type=ptmp_ap or ptp)',
    sector_azimuth_deg  SMALLINT        NULL     COMMENT 'Sector azimuth bearing in degrees (0–359)',
    sector_width_deg    SMALLINT        NULL     COMMENT 'Sector beam width in degrees',
    frequency_mhz       INT             NULL     COMMENT 'Operating frequency in MHz',
    channel_width_mhz   SMALLINT        NULL     COMMENT 'Channel width in MHz',
    tx_power_dbm        SMALLINT        NULL     COMMENT 'Transmit power in dBm',
    encryption          ENUM('none','wpa2','wpa3','mixed') NOT NULL DEFAULT 'wpa2'
                            COMMENT 'Wireless encryption mode',
    channel_plan_id     BIGINT UNSIGNED NULL     COMMENT 'FK to ap_channel_plans (nullable)',
    antenna_gain_dbi    DECIMAL(4,1)    NULL     COMMENT 'Antenna gain in dBi',
    height_m            DECIMAL(5,1)    NULL     COMMENT 'Antenna height above ground in metres',
    polarization        ENUM('vertical','horizontal','dual','cross') NULL
                            COMMENT 'Antenna polarization',
    max_clients         SMALLINT        NULL     COMMENT 'Maximum subscriber connections per sector',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ap_sector_configs_organization_id (organization_id),
    KEY idx_ap_sector_configs_device_id (device_id),
    KEY idx_ap_sector_configs_channel_plan_id (channel_plan_id),
    KEY idx_ap_sector_configs_deleted_at (deleted_at),
    CONSTRAINT fk_ap_sector_configs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ap_sector_configs_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ap_sector_configs_channel_plan FOREIGN KEY (channel_plan_id)
        REFERENCES ap_channel_plans (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AP/PTP wireless RF configuration per sector device';

-- ---------------------------------------------------------------------------
-- Table: wireless_client_sessions (§9.1)
-- Purpose: Append-only CPE client state snapshots per AP poll.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wireless_client_sessions (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL     COMMENT 'Tenant organization',
    device_id           BIGINT UNSIGNED NOT NULL COMMENT 'AP device that observed this client',
    client_device_id    BIGINT UNSIGNED NULL     COMMENT 'CPE device record (NULL if unknown)',
    mac_address         VARCHAR(17)     NOT NULL COMMENT 'Client MAC address (AA:BB:CC:DD:EE:FF)',
    ip_address          VARCHAR(45)     NULL     COMMENT 'Client IP address (IPv4 or IPv6)',
    signal_dbm          SMALLINT        NULL     COMMENT 'Received signal level in dBm',
    noise_floor_dbm     SMALLINT        NULL     COMMENT 'Noise floor at AP in dBm',
    snr_db              SMALLINT        NULL     COMMENT 'Signal-to-noise ratio in dB',
    ccq_pct             SMALLINT        NULL     COMMENT 'Client Connection Quality percentage (0–100)',
    tx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Transmit rate in Mbps',
    rx_rate_mbps        DECIMAL(8,2)    NULL     COMMENT 'Receive rate in Mbps',
    distance_m          INT             NULL     COMMENT 'Distance from AP in metres',
    connected_at        DATETIME        NULL     COMMENT 'Session association time (NULL if unknown)',
    last_seen_at        DATETIME        NOT NULL COMMENT 'Timestamp of this observation',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_wcs_organization_id (organization_id),
    KEY idx_wcs_device_id (device_id),
    KEY idx_wcs_client_device_id (client_device_id),
    KEY idx_wcs_mac_address (mac_address),
    KEY idx_wcs_last_seen_at (last_seen_at),
    CONSTRAINT fk_wcs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_wcs_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_wcs_client_device FOREIGN KEY (client_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Append-only CPE client state snapshots per AP poll';

-- ---------------------------------------------------------------------------
-- Table: ap_command_jobs (§9.1)
-- Purpose: Remote AP command jobs for power/frequency/reboot adjustments.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_command_jobs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL     COMMENT 'Tenant organization',
    device_id       BIGINT UNSIGNED NOT NULL COMMENT 'Target AP/PTP device',
    command_type    ENUM('set_tx_power','set_frequency','set_channel_width','reboot','other')
                        NOT NULL DEFAULT 'other'
                        COMMENT 'Type of remote command to execute',
    target_value    VARCHAR(255)    NULL     COMMENT 'Target value for the command (e.g. new frequency)',
    status          ENUM('pending','queued','in_progress','completed','failed','cancelled')
                        NOT NULL DEFAULT 'pending',
    scheduled_at    DATETIME        NULL     COMMENT 'When the command should execute (NULL = immediate)',
    started_at      DATETIME        NULL     COMMENT 'When execution started',
    completed_at    DATETIME        NULL     COMMENT 'When execution completed or failed',
    result_output   TEXT            NULL     COMMENT 'Device response / stdout',
    error_message   TEXT            NULL     COMMENT 'Error detail on failure',
    created_by      BIGINT UNSIGNED NULL     COMMENT 'User who created this job (no FK — soft ref)',
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ap_command_jobs_organization_id (organization_id),
    KEY idx_ap_command_jobs_device_id (device_id),
    KEY idx_ap_command_jobs_status (status),
    KEY idx_ap_command_jobs_scheduled_at (scheduled_at),
    KEY idx_ap_command_jobs_deleted_at (deleted_at),
    CONSTRAINT fk_ap_command_jobs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ap_command_jobs_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Remote AP command jobs for power/frequency/reboot adjustments';

-- ---------------------------------------------------------------------------
-- Table: wireless_channel_interference (§9.1)
-- Purpose: Detected RF channel interference records per sector/site.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wireless_channel_interference (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL     COMMENT 'Tenant organization',
    ap_sector_config_id BIGINT UNSIGNED NULL     COMMENT 'AP sector where interference was detected',
    site_id             BIGINT UNSIGNED NULL     COMMENT 'Site where interference was detected',
    detected_at         DATETIME        NOT NULL COMMENT 'When interference was observed',
    frequency_mhz       INT             NULL     COMMENT 'Affected frequency in MHz',
    channel_width_mhz   SMALLINT        NULL     COMMENT 'Affected channel width in MHz',
    interference_level  ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
    conflicting_ap_mac  VARCHAR(17)     NULL     COMMENT 'MAC of the conflicting AP if known',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_wci_organization_id (organization_id),
    KEY idx_wci_ap_sector_config_id (ap_sector_config_id),
    KEY idx_wci_site_id (site_id),
    KEY idx_wci_detected_at (detected_at),
    KEY idx_wci_interference_level (interference_level),
    KEY idx_wci_deleted_at (deleted_at),
    CONSTRAINT fk_wci_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_wci_ap_sector_config FOREIGN KEY (ap_sector_config_id)
        REFERENCES ap_sector_configs (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_wci_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Detected RF channel interference records per sector/site';

-- ---------------------------------------------------------------------------
-- Table: link_planning_calcs (§9.2)
-- Purpose: Saved link budget calculator runs — stores inputs and computed
--          FSPL, Fresnel zone radius, clearance, and link budget.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS link_planning_calcs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL,
    site_a_id           BIGINT UNSIGNED NULL     COMMENT 'FK to sites (site A endpoint)',
    site_b_id           BIGINT UNSIGNED NULL     COMMENT 'FK to sites (site B endpoint)',
    lat_a               DECIMAL(10,8)   NULL,
    lon_a               DECIMAL(11,8)   NULL,
    lat_b               DECIMAL(10,8)   NULL,
    lon_b               DECIMAL(11,8)   NULL,
    frequency_mhz       INT             NOT NULL COMMENT 'Operating frequency in MHz',
    tx_power_dbm        DECIMAL(6,2)    NULL,
    antenna_gain_a_dbi  DECIMAL(5,2)    NULL,
    antenna_gain_b_dbi  DECIMAL(5,2)    NULL,
    cable_loss_db       DECIMAL(5,2)    NULL DEFAULT 0,
    distance_km         DECIMAL(10,4)   NULL COMMENT 'Great-circle distance in km',
    fspl_db             DECIMAL(8,4)    NULL COMMENT 'Free-space path loss in dB',
    fresnel_radius_m    DECIMAL(8,4)    NULL COMMENT 'First Fresnel zone radius at midpoint in metres',
    clearance_required_m DECIMAL(8,4)  NULL COMMENT '0.6 * first Fresnel zone radius (minimum clearance)',
    link_budget_db      DECIMAL(8,4)    NULL COMMENT 'Estimated link budget = TxPower + GainA + GainB - FSPL - CableLoss',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_link_planning_calcs_org (organization_id),
    KEY idx_link_planning_calcs_deleted_at (deleted_at),
    CONSTRAINT fk_lpc_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_lpc_site_a FOREIGN KEY (site_a_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_lpc_site_b FOREIGN KEY (site_b_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Saved link budget calculator runs with computed FSPL, Fresnel zone, and link budget (§9.2)';

-- ---------------------------------------------------------------------------
-- Table: spectrum_scan_results (§9.3)
-- Purpose: AP spectrum scan results — raw scan_data JSON, peak interference,
--          and channel recommendation from wireless spectrum analysis.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spectrum_scan_results (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NULL,
    device_id               BIGINT UNSIGNED NOT NULL  COMMENT 'AP device that performed the scan',
    scan_type               ENUM('scheduled','manual','triggered') NOT NULL DEFAULT 'manual',
    frequency_start_mhz     INT             NOT NULL,
    frequency_end_mhz       INT             NOT NULL,
    channel_width_mhz       SMALLINT        NOT NULL DEFAULT 20,
    scan_data               JSON            NULL      COMMENT 'Raw spectrum data: [{freq_mhz: N, power_dbm: N}]',
    peak_interference_dbm   DECIMAL(7,2)    NULL,
    recommended_channel_mhz INT             NULL      COMMENT 'Clearest channel identified',
    status                  ENUM('pending','in_progress','completed','failed') NOT NULL DEFAULT 'pending',
    started_at              DATETIME        NULL,
    completed_at            DATETIME        NULL,
    error_message           TEXT            NULL,
    notes                   TEXT            NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at              DATETIME        DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_spectrum_scans_device (device_id),
    KEY idx_spectrum_scans_org (organization_id),
    KEY idx_spectrum_scans_status (status),
    KEY idx_spectrum_scans_deleted_at (deleted_at),
    CONSTRAINT fk_spectrum_scans_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_spectrum_scans_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AP spectrum scan results — raw scan_data JSON + recommendation (§9.3)';

-- ---------------------------------------------------------------------------
-- Table: settings
-- Purpose: App settings / key-value configuration store for system-wide
--          settings such as default tax rate, currency, invoice number prefix,
--          SMTP config, SNMP poll interval, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    setting_key   VARCHAR(100)     NOT NULL,
    setting_value TEXT             NULL,
    description   VARCHAR(255)     NULL,
    created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: tax_rules
-- Purpose: Tax rules per region and service type. Supports VAT, sales tax,
--          GST, and other regional tax configurations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_rules (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = applies to all tenants',
    name            VARCHAR(255)     NOT NULL,
    region          VARCHAR(100)     NULL     COMMENT 'State, province, or country the rule applies to',
    tax_type        ENUM('vat', 'sales_tax', 'gst', 'other') NOT NULL DEFAULT 'sales_tax',
    rate            DECIMAL(5, 4)    NOT NULL COMMENT 'Tax rate as a decimal, e.g. 0.0800 = 8%',
    is_default      BOOLEAN          NOT NULL DEFAULT FALSE COMMENT 'Default rule applied when no region match is found',
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_tax_rules_organization_id (organization_id),
    KEY idx_tax_rules_region (region),
    KEY idx_tax_rules_status (status),
    KEY idx_tax_rules_deleted_at (deleted_at),
    CONSTRAINT fk_tax_rules_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: client_balance_ledger
-- Purpose: Running account balance per client (prepaid / postpaid tracking).
--          Each row records a debit (invoice, usage deduction) or credit
--          (payment, top-up, credit note, adjustment) and maintains a running
--          balance per client. Supports both prepaid (balance = credit remaining)
--          and postpaid (balance = amount owed) billing models.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_balance_ledger (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id       BIGINT UNSIGNED  NOT NULL,
    balance_type    ENUM('prepaid', 'postpaid') NOT NULL DEFAULT 'postpaid'
                        COMMENT 'prepaid = client pays in advance (positive balance = available credit); postpaid = client pays after usage (positive balance = amount owed)',
    entry_type      ENUM('invoice', 'payment', 'credit_note', 'adjustment', 'topup', 'usage_deduction', 'debit', 'credit') NOT NULL
                        COMMENT 'invoice/usage_deduction/debit = debit entries; payment/topup/credit_note/adjustment/credit = credit entries',
    reference_id    BIGINT UNSIGNED  NULL     COMMENT 'Polymorphic ID of the invoice, payment, credit_note, or related entity',
    description     VARCHAR(255)     NULL,
    amount          DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Convenience field used by billingService; mirrors the debit or credit value',
    currency        VARCHAR(3)       NULL     COMMENT 'ISO 4217 currency code for the entry (e.g. MXN, USD)',
    reference_type  VARCHAR(50)      NULL     COMMENT 'Polymorphic type tag for reference_id (invoice, payment, etc.)',
    debit           DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount charged (increases balance owed / decreases prepaid credit)',
    credit          DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount credited (decreases balance owed / increases prepaid credit)',
    running_balance DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Client account balance after this entry',
    entry_date      DATE             NOT NULL DEFAULT (CURRENT_DATE) COMMENT 'Accounting date of this ledger entry',
    created_by      BIGINT UNSIGNED  NULL     COMMENT 'User who created this entry; NULL = system',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ledger_organization_id (organization_id),
    KEY idx_ledger_client_id (client_id),
    KEY idx_ledger_client_balance_date (client_id, balance_type, entry_date),
    KEY idx_ledger_entry_date (entry_date),
    KEY idx_ledger_entry_type (entry_type),
    KEY idx_ledger_balance_type (balance_type),
    CONSTRAINT fk_ledger_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ledger_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ledger_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: email_logs
-- Purpose: Email / SMS / WhatsApp send log for auditing. Records every message
--          sent to a client or internal user with delivery status tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_logs (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    client_id        BIGINT UNSIGNED  NULL     COMMENT 'Client recipient; NULL for internal messages',
    user_id          BIGINT UNSIGNED  NULL     COMMENT 'Internal user recipient; NULL for client messages',
    channel          ENUM('email', 'sms', 'whatsapp', 'other') NOT NULL DEFAULT 'email',
    recipient        VARCHAR(255)     NOT NULL COMMENT 'Email address or phone number',
    subject          VARCHAR(255)     NULL,
    body             TEXT             NULL,
    template         VARCHAR(100)     NULL     COMMENT 'Template name used to render the message',
    template_id      BIGINT UNSIGNED  NULL     COMMENT 'Template used to render this message; NULL = ad-hoc / legacy',
    campaign_message_id BIGINT UNSIGNED NULL   COMMENT 'Campaign message this send belongs to; NULL = non-campaign send',
    reference_type   VARCHAR(50)      NULL     COMMENT 'Entity type the message relates to, e.g. invoice, ticket',
    reference_id     BIGINT UNSIGNED  NULL     COMMENT 'ID of the referenced entity',
    status           ENUM('queued', 'sent', 'delivered', 'failed', 'bounced') NOT NULL DEFAULT 'queued',
    error_message    TEXT             NULL     COMMENT 'Delivery error details when status = failed or bounced',
    sent_at          TIMESTAMP        NULL,
    opened_at        DATETIME         NULL     COMMENT 'Timestamp of first email open event',
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_email_logs_client_id (client_id),
    KEY idx_email_logs_status (status),
    KEY idx_email_logs_reference (reference_type, reference_id),
    KEY idx_email_logs_sent_at (sent_at),
    KEY idx_email_logs_template_id (template_id),
    KEY idx_email_logs_campaign_message (campaign_message_id),
    CONSTRAINT fk_email_logs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_email_logs_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_email_logs_template FOREIGN KEY (template_id)
        REFERENCES message_templates (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: scheduled_tasks
-- Purpose: App-level task queue for recurring and one-shot jobs such as
--          auto-suspending overdue clients, generating invoices, RADIUS sync,
--          and SNMP polling.  Supports distributed locking, retry logic,
--          priority ordering, and JSON payloads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id   BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = global / single-tenant deployment',
    task_name         VARCHAR(100)     NOT NULL COMMENT 'Unique machine-readable identifier, e.g. ''auto_suspend_overdue''',
    task_type         ENUM('auto_suspend', 'generate_invoice', 'radius_sync',
                          'snmp_poll', 'usage_rollup', 'cleanup',
                          'notification', 'backup', 'maintenance',
                          'webhook_retry', 'other')
                                       NOT NULL DEFAULT 'other'
                                       COMMENT 'Category of the scheduled task',
    handler           VARCHAR(255)     NULL     COMMENT 'Fully-qualified class or function that executes this task',
    description       VARCHAR(255)     NULL,
    cron_expression   VARCHAR(50)      NULL     COMMENT 'Cron expression, e.g. ''0 2 * * *'' for daily at 02:00; NULL = one-shot task',
    payload           JSON             NULL     COMMENT 'Arbitrary parameters passed to the handler at runtime',
    priority          ENUM('low', 'normal', 'high', 'critical')
                                       NOT NULL DEFAULT 'normal'
                                       COMMENT 'Execution priority; higher-priority tasks are picked first',
    max_retries       TINYINT UNSIGNED NOT NULL DEFAULT 3
                                       COMMENT 'Maximum consecutive retry attempts on failure',
    retry_count       TINYINT UNSIGNED NOT NULL DEFAULT 0
                                       COMMENT 'Current consecutive failure count; reset to 0 on success',
    timeout_seconds   INT UNSIGNED     NOT NULL DEFAULT 300
                                       COMMENT 'Maximum allowed runtime in seconds; exceeded tasks are considered stuck',
    last_run_at       TIMESTAMP        NULL,
    next_run_at       TIMESTAMP        NULL,
    last_status       ENUM('success', 'failed', 'running', 'skipped', 'timed_out') NULL,
    last_error        TEXT             NULL,
    last_duration_ms  INT UNSIGNED     NULL     COMMENT 'Duration of the last run in milliseconds',
    locked_at         TIMESTAMP        NULL     COMMENT 'Set when a worker claims this task; NULL = available',
    locked_by         VARCHAR(255)     NULL     COMMENT 'Identifier of the worker/process that claimed this task',
    is_enabled        BOOLEAN          NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_scheduled_tasks_org_name (organization_id, task_name),
    KEY idx_scheduled_tasks_enabled_next (is_enabled, next_run_at),
    KEY idx_scheduled_tasks_task_type (task_type),
    KEY idx_scheduled_tasks_priority_next (priority, next_run_at)
        COMMENT 'Worker pick query: enabled + due + highest priority first',
    KEY idx_scheduled_tasks_locked (locked_at, timeout_seconds)
        COMMENT 'Identify stuck tasks: WHERE locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL timeout_seconds SECOND',
    CONSTRAINT fk_scheduled_tasks_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_scheduled_tasks_retry CHECK (retry_count <= max_retries)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: user_sessions
-- Purpose: Active session tracking for security audit. Stores user sessions
--          (hashed token, IP, user-agent, expiry) enabling "logout all devices"
--          and suspicious-login detection.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id        BIGINT UNSIGNED  NOT NULL,
    token_hash     VARCHAR(255)     NOT NULL COMMENT 'Hashed session or refresh token',
    token_family   VARCHAR(255)     NULL     COMMENT 'Family identifier for refresh token rotation reuse detection',
    ip_address     VARCHAR(45)      NULL,
    user_agent     VARCHAR(500)     NULL,
    expires_at     TIMESTAMP        NOT NULL,
    last_active_at TIMESTAMP        NULL,
    created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_user_sessions_token (token_hash),
    KEY idx_user_sessions_user_id (user_id),
    KEY idx_user_sessions_expires_at (expires_at),
    KEY idx_user_sessions_token_family (token_family),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: portal_refresh_tokens
-- Purpose: Refresh tokens for the client self-service portal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_refresh_tokens (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id   BIGINT UNSIGNED NOT NULL,
    token_hash  VARCHAR(64)     NOT NULL COMMENT 'SHA-256 hex of the opaque refresh token',
    expires_at  TIMESTAMP       NOT NULL,
    revoked_at  TIMESTAMP       NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_portal_refresh_tokens_hash (token_hash),
    KEY idx_portal_refresh_tokens_client (client_id),
    CONSTRAINT fk_portal_refresh_tokens_client
        FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tables: roles, permissions, role_permissions
-- Purpose: RBAC roles and permissions â€” flexible custom roles replacing the
--          rigid role ENUM on the users table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name        VARCHAR(50)      NOT NULL,
    description VARCHAR(255)     NULL,
    is_system   BOOLEAN          NOT NULL DEFAULT FALSE COMMENT 'System roles cannot be deleted',
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_name (name),
    KEY idx_roles_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name        VARCHAR(100)     NOT NULL COMMENT 'Permission slug, e.g. clients.view, invoices.create',
    description VARCHAR(255)     NULL,
    module      VARCHAR(50)      NULL     COMMENT 'Functional module, e.g. clients, billing, network',
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_permissions_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
    id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    role_id       BIGINT UNSIGNED  NOT NULL,
    permission_id BIGINT UNSIGNED  NOT NULL,
    created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_role_permissions (role_id, permission_id),
    KEY idx_role_permissions_permission_id (permission_id),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id)
        REFERENCES roles (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id)
        REFERENCES permissions (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: outages
-- Purpose: Planned and unplanned outage log. Tracks network-wide events
--          affecting many clients at once â€” per site and/or device with
--          start/end times, affected client count, root cause, and resolution
--          status. Feeds into SLA reporting.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outages (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    site_id                 BIGINT UNSIGNED  NULL     COMMENT 'Affected site; NULL if device-level only',
    device_id               BIGINT UNSIGNED  NULL     COMMENT 'Affected device; NULL if site-wide',
    outage_type             ENUM('planned', 'unplanned') NOT NULL DEFAULT 'unplanned',
    title                   VARCHAR(255)     NOT NULL,
    description             TEXT             NULL,
    severity                ENUM('minor', 'major', 'critical') NOT NULL DEFAULT 'major',
    started_at              TIMESTAMP        NOT NULL,
    resolved_at             TIMESTAMP        NULL,
    affected_clients_count  INT UNSIGNED     NULL,
    root_cause              TEXT             NULL,
    status                  ENUM('ongoing', 'resolved', 'post_mortem') NOT NULL DEFAULT 'ongoing',
    created_by              BIGINT UNSIGNED  NULL     COMMENT 'User who logged the outage; NULL = system',
    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_outages_site_id (site_id),
    KEY idx_outages_device_id (device_id),
    KEY idx_outages_status (status),
    KEY idx_outages_started_at (started_at),
    KEY idx_outages_deleted_at (deleted_at),
    CONSTRAINT fk_outages_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_outages_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_outages_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: vlans
-- Purpose: VLAN registry linked to sites. Tracks IEEE 802.1Q VLAN IDs per
--          site for network segmentation, service isolation, and capacity
--          planning. Referenced by contracts and devices.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vlans (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL COMMENT 'Tenant organization this VLAN belongs to; NULL = single-tenant deployment',
    site_id         BIGINT UNSIGNED  NOT NULL COMMENT 'Site this VLAN belongs to',
    vlan_id         SMALLINT UNSIGNED NOT NULL COMMENT 'IEEE 802.1Q VLAN ID (1-4094)',
    name            VARCHAR(255)     NOT NULL COMMENT 'Descriptive label, e.g. "Client-Data", "Management", "VoIP"',
    description     TEXT             NULL,
    status          ENUM('active', 'reserved', 'deprecated') NOT NULL DEFAULT 'active'
                        COMMENT 'active = in use; reserved = allocated but not yet deployed; deprecated = phasing out',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_vlans_site_vlan (site_id, vlan_id) COMMENT 'A VLAN ID must be unique within a site',
    KEY idx_vlans_organization_id (organization_id),
    KEY idx_vlans_site_id (site_id),
    KEY idx_vlans_status (status),
    KEY idx_vlans_deleted_at (deleted_at),
    CONSTRAINT fk_vlans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_vlans_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_vlans_vlan_id CHECK (vlan_id BETWEEN 1 AND 4094)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: tax_rates
-- Purpose: Master list of named tax configurations (e.g. "IVA 16%", "Exempt",
--          "Sales Tax 8%"). Referenced by invoices, quotes, and credit notes
--          so that rate changes only need to happen in one place.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_rates (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = applies to all tenants',
    name            VARCHAR(100)     NOT NULL COMMENT 'Human-readable label, e.g. "IVA 16%", "Exempt", "GST 5%"',
    rate            DECIMAL(5, 4)    NOT NULL COMMENT 'Tax rate as a decimal, e.g. 0.1600 = 16%',
    description     TEXT             NULL     COMMENT 'Optional explanation or legal reference',
    is_default      BOOLEAN          NOT NULL DEFAULT FALSE COMMENT 'Default rate applied to new invoices/quotes when none is selected',
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_tax_rates_organization_id (organization_id),
    KEY idx_tax_rates_status (status),
    KEY idx_tax_rates_is_default (is_default),
    KEY idx_tax_rates_deleted_at (deleted_at),
    CONSTRAINT fk_tax_rates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: message_templates
-- Purpose: Reusable message templates for emails, SMS, and WhatsApp.
--          Stores subject, body, and available placeholder variables so
--          operators can customise outbound communications (invoice
--          reminders, welcome messages, outage alerts, etc.) without
--          touching code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Owning tenant; NULL = global / system default',
    name            VARCHAR(100)     NOT NULL COMMENT 'Unique machine-readable name, e.g. invoice_reminder',
    channel         ENUM('email', 'sms', 'whatsapp', 'other') NOT NULL DEFAULT 'email',
    subject         VARCHAR(255)     NULL     COMMENT 'Email subject template (NULL for SMS/WhatsApp)',
    body            TEXT             NOT NULL COMMENT 'Template body â€” supports placeholder variables e.g. {{client_name}}',
    description     VARCHAR(255)     NULL     COMMENT 'Human-readable purpose of this template',
    variables       JSON             NULL     COMMENT 'List of available placeholder names, e.g. ["client_name","invoice_number"]',
    is_active       TINYINT(1)       NOT NULL DEFAULT 1,
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_message_templates_org_name_channel (organization_id, name, channel),
    KEY idx_message_templates_channel (channel),
    KEY idx_message_templates_is_active (is_active),
    KEY idx_message_templates_deleted_at (deleted_at),
    CONSTRAINT fk_message_templates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: schema_migrations
-- Purpose: Migration state tracking. Records which migration files have been
--          applied so the deploy script can skip already-run files.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    filename   VARCHAR(255)     NOT NULL COMMENT 'Migration filename, e.g. 001_create_users_table.sql',
    applied_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_schema_migrations_filename (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: api_tokens
-- Purpose: API keys for external integrations (third-party billing,
--          monitoring tools, etc.). Each token belongs to a user, has a
--          hashed secret, optional scopes, and an optional expiry date.
--          Supports revocation and last-used tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_tokens (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED  NOT NULL COMMENT 'User who owns this token',
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    name            VARCHAR(100)     NOT NULL COMMENT 'Human-readable label, e.g. "Grafana read-only"',
    token_hash      VARCHAR(255)     NOT NULL COMMENT 'SHA-256 hash of the API token (plain-text never stored)',
    scopes          JSON             NULL     COMMENT 'Flat JSON array of permission slugs, e.g. ["clients.read","invoices.read"]; NULL = all scopes',
    last_used_at    TIMESTAMP        NULL     COMMENT 'Last time this token was used for authentication',
    last_used_ip    VARCHAR(45)      NULL     COMMENT 'IP address of last use',
    expires_at      TIMESTAMP        NULL     COMMENT 'Optional expiry; NULL = never expires',
    revoked_at      TIMESTAMP        NULL     COMMENT 'Set when token is revoked; non-NULL = inactive',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_api_tokens_hash (token_hash),
    KEY idx_api_tokens_user_id (user_id),
    KEY idx_api_tokens_organization_id (organization_id),
    KEY idx_api_tokens_expires_at (expires_at),
    KEY idx_api_tokens_valid (revoked_at, expires_at) COMMENT 'Optimises WHERE revoked_at IS NULL AND expires_at > NOW()',
    KEY idx_api_tokens_deleted_at (deleted_at),
    CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_api_tokens_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: promotions
-- Purpose: Coupon codes, promotional pricing, and referral discounts.
--          Supports percentage and fixed-amount discounts applied to
--          contracts or invoices.  Each promotion has an optional coupon
--          code, validity window, and usage limits.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promotions (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Owning tenant; NULL = single-tenant deployment',
    name            VARCHAR(150)     NOT NULL COMMENT 'Internal label, e.g. "Summer 2026 â€“ 20% off"',
    code            VARCHAR(50)      NULL     COMMENT 'Coupon code entered by client or staff; NULL = auto-applied / no code',
    description     TEXT             NULL     COMMENT 'Public-facing description shown on invoices or sign-up pages',
    discount_type   ENUM('percentage', 'fixed_amount')
                                     NOT NULL DEFAULT 'percentage'
                                     COMMENT 'percentage = % off the line total; fixed_amount = flat monetary deduction',
    discount_value  DECIMAL(10, 2)   NOT NULL COMMENT 'Percentage (0.00-100.00) or fixed amount depending on discount_type',
    promotion_type  ENUM('coupon', 'promotional', 'referral')
                                     NOT NULL DEFAULT 'coupon'
                                     COMMENT 'coupon = redeemable code; promotional = time-limited pricing; referral = credited via referrer/referee',
    applies_to      ENUM('contract', 'invoice', 'plan')
                                     NOT NULL DEFAULT 'invoice'
                                     COMMENT 'What entity the discount targets',
    max_uses        INT UNSIGNED     NULL     COMMENT 'Total redemption limit across all clients; NULL = unlimited',
    max_uses_per_client INT UNSIGNED NULL     COMMENT 'Per-client redemption cap; NULL = unlimited',
    times_used      INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT 'Running counter of total redemptions',
    min_order_value DECIMAL(10, 2)   NULL     COMMENT 'Minimum invoice/contract value required to apply this promotion; NULL = no minimum',
    duration_months TINYINT UNSIGNED NULL     COMMENT 'Number of billing cycles the discount applies (e.g. 3 = first 3 months); NULL = one-time or perpetual',
    starts_at       TIMESTAMP        NULL     COMMENT 'Promotion validity start; NULL = immediately valid',
    ends_at         TIMESTAMP        NULL     COMMENT 'Promotion validity end; NULL = no expiry',
    is_active       TINYINT(1)       NOT NULL DEFAULT 1,
    created_by      BIGINT UNSIGNED  NULL     COMMENT 'Staff member who created this promotion',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_promotions_org_code (organization_id, code),
    KEY idx_promotions_organization_id (organization_id),
    KEY idx_promotions_promotion_type (promotion_type),
    KEY idx_promotions_is_active (is_active),
    KEY idx_promotions_dates (starts_at, ends_at) COMMENT 'Optimises WHERE starts_at <= NOW() AND (ends_at IS NULL OR ends_at >= NOW())',
    KEY idx_promotions_code (code),
    KEY idx_promotions_deleted_at (deleted_at),
    CONSTRAINT fk_promotions_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_promotions_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_promotions_discount_value CHECK (discount_value > 0),
    CONSTRAINT chk_promotions_ends_after_starts CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: service_areas
-- Purpose: Geographic service areas (regions / markets) used for sales
--          territory assignment and network planning.  Each area has a
--          named boundary stored as a MySQL POLYGON geometry with SRID
--          4326 (WGS 84) and an optional link to the owning site (POP /
--          data center) that serves the region.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_areas (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Tenant organization; NULL = single-tenant deployment',
    site_id         BIGINT UNSIGNED  NULL     COMMENT 'Primary site (POP / tower) serving this area; NULL = unassigned',
    name            VARCHAR(150)     NOT NULL COMMENT 'Human-readable label, e.g. "Downtown Metro", "North Rural"',
    description     TEXT             NULL     COMMENT 'Notes about terrain, demographics, or expansion plans',
    boundary        POLYGON          NOT NULL /*!80003 SRID 4326 */
                                     COMMENT 'WGS 84 polygon that defines the outer boundary of this service area',
    color           VARCHAR(7)       NULL     COMMENT 'Hex colour for map rendering, e.g. "#3B82F6"',
    status          ENUM('planned', 'active', 'retired')
                                     NOT NULL DEFAULT 'planned'
                                     COMMENT 'planned = future build-out; active = currently served; retired = decommissioned',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    SPATIAL KEY spx_service_areas_boundary (boundary),
    KEY idx_service_areas_organization_id (organization_id),
    KEY idx_service_areas_site_id (site_id),
    KEY idx_service_areas_status (status),
    KEY idx_service_areas_deleted_at (deleted_at),
    CONSTRAINT fk_service_areas_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_service_areas_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: coverage_zones
-- Purpose: Coverage zones within a service area â€” finer-grained polygons
--          that describe the actual network reach, technology type, and
--          maximum available speed.  Used on public coverage-check pages
--          and for internal capacity planning.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coverage_zones (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    service_area_id BIGINT UNSIGNED  NOT NULL COMMENT 'Parent service area this zone belongs to',
    name            VARCHAR(150)     NOT NULL COMMENT 'Label, e.g. "FTTH Zone A", "Fixed-Wireless Sector 3"',
    description     TEXT             NULL     COMMENT 'Additional notes (equipment used, limitations, etc.)',
    zone_type       ENUM('fiber', 'fixed_wireless', 'dsl', 'cable', 'satellite', 'lte', '5g', 'other')
                                     NOT NULL DEFAULT 'fiber'
                                     COMMENT 'Access technology available in this zone',
    boundary        POLYGON          NOT NULL /*!80003 SRID 4326 */
                                     COMMENT 'WGS 84 polygon defining the zone boundary',
    max_download_mbps INT UNSIGNED   NULL     COMMENT 'Maximum advertised download speed in Mbps',
    max_upload_mbps   INT UNSIGNED   NULL     COMMENT 'Maximum advertised upload speed in Mbps',
    color           VARCHAR(7)       NULL     COMMENT 'Hex colour for map rendering, e.g. "#10B981"',
    status          ENUM('planned', 'under_construction', 'active', 'degraded', 'retired')
                                     NOT NULL DEFAULT 'planned'
                                     COMMENT 'planned = design phase; under_construction = build in progress; active = live; degraded = reduced capacity; retired = decommissioned',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    SPATIAL KEY spx_coverage_zones_boundary (boundary),
    KEY idx_coverage_zones_service_area_id (service_area_id),
    KEY idx_coverage_zones_zone_type (zone_type),
    KEY idx_coverage_zones_status (status),
    KEY idx_coverage_zones_deleted_at (deleted_at),
    CONSTRAINT fk_coverage_zones_service_area FOREIGN KEY (service_area_id)
        REFERENCES service_areas (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: sla_definitions
-- Purpose: SLA (Service Level Agreement) terms per plan â€” uptime guarantees,
--          response / resolution time commitments, compensation rules, and
--          maintenance-window exclusions.
-- ---------------------------------------------------------------------------
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
    compensation_value      DECIMAL(10, 2)   NULL     COMMENT 'Compensation amount â€” percentage of monthly fee or fixed currency amount, depending on compensation_type',
    exclude_maintenance     TINYINT(1)       NOT NULL DEFAULT 1
                                             COMMENT '1 = planned maintenance windows are excluded from uptime calculation',
    priority                ENUM('low', 'medium', 'high', 'critical')
                                             NOT NULL DEFAULT 'medium'
                                             COMMENT 'Default incident priority level under this SLA',
    status                  ENUM('active', 'inactive')
                                             NOT NULL DEFAULT 'active',
    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_sla_definitions_plan_id (plan_id),
    KEY idx_sla_definitions_status (status),
    KEY idx_sla_definitions_deleted_at (deleted_at),
    CONSTRAINT fk_sla_definitions_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: device_config_backups
-- Purpose: Versioned configuration snapshots per device â€” MikroTik exports,
--          RouterOS backups, Cisco running-config, and similar captures with
--          SHA-256 checksums for change detection and deduplication.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_config_backups (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    device_id       BIGINT UNSIGNED  NOT NULL COMMENT 'Device this config snapshot belongs to',
    version         INT UNSIGNED     NOT NULL DEFAULT 1
                                     COMMENT 'Monotonically increasing version number per device',
    config_type     ENUM('mikrotik_export', 'mikrotik_compact', 'mikrotik_backup',
                         'running_config', 'startup_config', 'full_backup', 'other')
                                     NOT NULL DEFAULT 'running_config'
                                     COMMENT 'Format / flavor of the captured configuration',
    content         LONGTEXT         NOT NULL COMMENT 'Full configuration text',
    file_size       INT UNSIGNED     NOT NULL DEFAULT 0
                                     COMMENT 'Size of the config content in bytes',
    checksum        VARCHAR(64)      NOT NULL COMMENT 'SHA-256 hash of content for change detection and deduplication',
    change_summary  TEXT             NULL     COMMENT 'Human-readable summary of what changed since the previous version',
    capture_method  ENUM('manual', 'scheduled', 'pre_change', 'post_change')
                                     NOT NULL DEFAULT 'manual'
                                     COMMENT 'How the backup was triggered',
    captured_by_user_id BIGINT UNSIGNED NULL  COMMENT 'User who initiated the capture; NULL = system / automated',
    notes           TEXT             NULL     COMMENT 'Free-form operator notes',
    diff_from_previous LONGTEXT      NULL     COMMENT 'Unified diff vs previous version (migration 262; NULL for first backup)',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_device_config_backups_device_version (device_id, version),
    KEY idx_device_config_backups_device_id (device_id),
    KEY idx_device_config_backups_config_type (config_type),
    KEY idx_device_config_backups_capture_method (capture_method),
    KEY idx_device_config_backups_checksum (checksum),
    KEY idx_device_config_backups_created_at (created_at),
    KEY idx_device_config_backups_deleted_at (deleted_at),
    CONSTRAINT fk_device_config_backups_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_device_config_backups_user FOREIGN KEY (captured_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: client_mx_profiles
-- Purpose: One-to-one Mexico extension for clients. Required (enforced at the
--          app layer) when clients.locale = 'MX' AND at least one of the
--          client's contracts has facturar = TRUE. Stores SAT-specific identity
--          fields that CFDI 4.0 mandates: RFC, razon_social, regimen_fiscal,
--          and codigo_postal_fiscal must match the SAT taxpayer registry exactly.
--          The facturar flag lives on contracts (per-contract), so the same
--          client can have some contracts generating individual CFDIs and others
--          going to the factura pÃºblica aggregate (venta al pÃºblico en general).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_mx_profiles (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id               BIGINT UNSIGNED NOT NULL
                                COMMENT 'References clients(id) â€” one profile per client',
    rfc                     VARCHAR(13)     NOT NULL
                                COMMENT 'Registro Federal de Contribuyentes â€” 12 chars for companies, 13 for individuals; XAXX010101000 for pÃºblico en general',
    rfc_unique_check        VARCHAR(13)     AS (CASE WHEN rfc = 'XAXX010101000' THEN NULL ELSE rfc END) STORED
                                COMMENT 'Generated column for conditional uniqueness â€” NULL for pÃºblico en general (allows duplicates), non-NULL for real RFCs (enforces uniqueness)',
    curp                    VARCHAR(18)     NULL
                                COMMENT 'Clave Ãšnica de Registro de PoblaciÃ³n â€” personal clients only',
    razon_social            VARCHAR(300)    NOT NULL
                                COMMENT 'Legal name exactly as registered with SAT â€” must match for CFDI validation',
    regimen_fiscal          VARCHAR(3)      NOT NULL
                                COMMENT 'SAT fiscal regime code from c_RegimenFiscal (e.g. 601, 612, 626)',
    codigo_postal_fiscal    VARCHAR(5)      NOT NULL
                                COMMENT 'Fiscal ZIP code as registered with SAT â€” required on CFDI 4.0 receptor node',
    uso_cfdi_default        VARCHAR(4)      NULL
                                COMMENT 'Default CFDI use code from c_UsoCFDI (e.g. G03, S01) â€” pre-filled on new invoices',
    colonia                 VARCHAR(150)    NULL
                                COMMENT 'Neighborhood â€” required for Mexican addresses on CFDI',
    municipio               VARCHAR(150)    NULL
                                COMMENT 'Municipality â€” required for Mexican addresses on CFDI',
    exterior_number         VARCHAR(20)     NULL
                                COMMENT 'Street exterior number',
    interior_number         VARCHAR(20)     NULL
                                COMMENT 'Suite / interior number',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_client_mx_profiles_client_id (client_id),
    UNIQUE KEY uq_client_mx_profiles_rfc (rfc_unique_check),
    KEY idx_client_mx_profiles_rfc (rfc),
    KEY idx_client_mx_profiles_regimen_fiscal (regimen_fiscal),
    KEY idx_client_mx_profiles_deleted_at (deleted_at),
    CONSTRAINT fk_client_mx_profiles_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: organization_mx_profiles
-- Purpose: One-to-one Mexico extension for organizations. Required (enforced
--          at the app layer) when organizations.locale = 'MX'. Stores the CSD
--          digital seal certificate, PAC stamping credentials, CFDI series/folio
--          numbering, and SAT identity fields for the CFDI issuer node.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_mx_profiles (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NOT NULL
                                COMMENT 'References organizations(id) â€” one profile per organization',

    -- SAT taxpayer identity
    rfc                     VARCHAR(13)     NOT NULL
                                COMMENT 'RFC of the ISP as the CFDI issuer',
    razon_social            VARCHAR(300)    NOT NULL
                                COMMENT 'Legal name of the ISP exactly as registered with SAT',
    regimen_fiscal          VARCHAR(3)      NOT NULL
                                COMMENT 'SAT fiscal regime code for the issuer (e.g. 601, 621)',
    codigo_postal_fiscal    VARCHAR(5)      NOT NULL
                                COMMENT 'Fiscal ZIP code of the ISP as registered with SAT',

    -- CSD (Certificado de Sello Digital) for signing CFDIs
    csd_certificate_number  VARCHAR(30)     NULL
                                COMMENT 'SAT-assigned certificate serial number',
    csd_certificate_pem     TEXT            NULL
                                COMMENT 'CSD public certificate in PEM format (.cer)',
    csd_private_key_enc     TEXT            NULL
                                COMMENT 'CSD private key encrypted at rest (.key) â€” app handles encryption',
    csd_valid_from          DATE            NULL
                                COMMENT 'CSD certificate validity start date',
    csd_valid_to            DATE            NULL
                                COMMENT 'CSD certificate expiry date â€” alerts should fire before this date',

    -- PAC (Proveedor Autorizado de CertificaciÃ³n) integration
    pac_provider            VARCHAR(50)     NULL
                                COMMENT 'PAC provider name (e.g. Finkok, TimbraSoft, SW Sapien)',
    pac_username            VARCHAR(255)    NULL
                                COMMENT 'PAC API username',
    pac_password_enc        VARCHAR(500)    NULL
                                COMMENT 'PAC API password encrypted at rest â€” app handles encryption',
    pac_environment         ENUM('sandbox', 'production') NOT NULL DEFAULT 'sandbox'
                                COMMENT 'sandbox = PAC test environment; production = live stamping',

    -- CFDI series & folio auto-numbering
    cfdi_serie_ingreso      VARCHAR(10)     NOT NULL DEFAULT 'A'
                                COMMENT 'Series prefix for CFDI tipo I (ingreso / invoice)',
    cfdi_serie_egreso       VARCHAR(10)     NOT NULL DEFAULT 'E'
                                COMMENT 'Series prefix for CFDI tipo E (egreso / credit note)',
    cfdi_serie_pago         VARCHAR(10)     NOT NULL DEFAULT 'P'
                                COMMENT 'Series prefix for CFDI tipo P (pago / payment complement)',
    cfdi_folio_next         BIGINT UNSIGNED NOT NULL DEFAULT 1
                                COMMENT 'Next available folio number â€” incremented atomically by the app on each issue',

    -- Mexican fiscal address
    colonia                 VARCHAR(150)    NULL
                                COMMENT 'Neighborhood',
    municipio               VARCHAR(150)    NULL
                                COMMENT 'Municipality',
    exterior_number         VARCHAR(20)     NULL
                                COMMENT 'Street exterior number',
    interior_number         VARCHAR(20)     NULL
                                COMMENT 'Suite / interior number',

    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_mx_profiles_org_id (organization_id),
    UNIQUE KEY uq_organization_mx_profiles_rfc (rfc),
    KEY idx_organization_mx_profiles_pac_environment (pac_environment),
    KEY idx_organization_mx_profiles_deleted_at (deleted_at),
    CONSTRAINT fk_organization_mx_profiles_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: sat_regimen_fiscal
-- Purpose: SAT catalog c_RegimenFiscal â€” fiscal regime codes used on CFDI 4.0
--          issuer and receptor nodes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_regimen_fiscal (
    code        VARCHAR(3)      NOT NULL
                    COMMENT 'SAT c_RegimenFiscal code (e.g. 601, 612, 626)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    applies_to  ENUM('personal', 'company', 'both') NOT NULL DEFAULT 'both'
                    COMMENT 'Whether the regime applies to individuals, moral persons, or both',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_regimen_fiscal_applies_to (applies_to),
    KEY idx_sat_regimen_fiscal_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_RegimenFiscal â€” fiscal regime codes for CFDI 4.0';

-- ---------------------------------------------------------------------------
-- Table: sat_uso_cfdi
-- Purpose: SAT catalog c_UsoCFDI â€” permitted use codes for the CFDI receptor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_uso_cfdi (
    code        VARCHAR(4)      NOT NULL
                    COMMENT 'SAT c_UsoCFDI code (e.g. G03, S01, P01)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    applies_to  ENUM('personal', 'company', 'both') NOT NULL DEFAULT 'both'
                    COMMENT 'Whether the use code applies to individuals, moral persons, or both',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_uso_cfdi_applies_to (applies_to),
    KEY idx_sat_uso_cfdi_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_UsoCFDI â€” permitted use codes for CFDI 4.0 receptor';

-- ---------------------------------------------------------------------------
-- Table: sat_forma_pago
-- Purpose: SAT catalog c_FormaPago â€” how a payment was or will be made.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_forma_pago (
    code        VARCHAR(2)      NOT NULL
                    COMMENT 'SAT c_FormaPago code (e.g. 01, 03, 28)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_forma_pago_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_FormaPago â€” how a payment was or will be made';

-- ---------------------------------------------------------------------------
-- Table: sat_metodo_pago
-- Purpose: SAT catalog c_MetodoPago â€” PUE or PPD payment timing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_metodo_pago (
    code        VARCHAR(3)      NOT NULL
                    COMMENT 'SAT c_MetodoPago code: PUE (pago en una sola exhibiciÃ³n) or PPD (pago en parcialidades o diferido)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_metodo_pago_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_MetodoPago â€” PUE or PPD payment timing';

-- ---------------------------------------------------------------------------
-- Table: sat_tipo_comprobante
-- Purpose: SAT catalog c_TipoDeComprobante â€” CFDI document type.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_tipo_comprobante (
    code        VARCHAR(1)      NOT NULL
                    COMMENT 'SAT c_TipoDeComprobante: I=ingreso, E=egreso, P=pago, T=traslado, N=nomina',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_tipo_comprobante_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_TipoDeComprobante â€” CFDI document type';

-- ---------------------------------------------------------------------------
-- Table: sat_moneda
-- Purpose: SAT catalog c_Moneda (subset) â€” currencies accepted in CFDI 4.0.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_moneda (
    code        VARCHAR(3)      NOT NULL
                    COMMENT 'ISO 4217 / SAT c_Moneda currency code (e.g. MXN, USD, EUR, XXX)',
    description VARCHAR(100)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    decimals    TINYINT UNSIGNED NOT NULL DEFAULT 2
                    COMMENT 'Number of decimal places allowed for amounts in this currency',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_moneda_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_Moneda â€” currencies accepted in CFDI 4.0';

-- ---------------------------------------------------------------------------
-- Seed data: SAT CFDI 4.0 catalog tables (migration 069)
-- Uses INSERT IGNORE for idempotent re-runs.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO sat_regimen_fiscal (code, description, applies_to, status) VALUES
('601', 'General de Ley Personas Morales',                                          'company',  'active'),
('603', 'Personas Morales con Fines no Lucrativos',                                 'company',  'active'),
('605', 'Sueldos y Salarios e Ingresos Asimilados a Salarios',                      'personal', 'active'),
('606', 'Arrendamiento',                                                             'personal', 'active'),
('608', 'DemÃ¡s ingresos',                                                            'personal', 'active'),
('610', 'Residentes en el Extranjero sin Establecimiento Permanente en MÃ©xico',      'both',     'active'),
('612', 'Personas FÃ­sicas con Actividades Empresariales y Profesionales',            'personal', 'active'),
('614', 'Ingresos por intereses',                                                    'personal', 'active'),
('616', 'Sin obligaciones fiscales',                                                 'personal', 'active'),
('620', 'Sociedades Cooperativas de ProducciÃ³n que optan por diferir sus ingresos',  'company',  'active'),
('621', 'IncorporaciÃ³n Fiscal',                                                      'personal', 'active'),
('622', 'Actividades AgrÃ­colas, Ganaderas, SilvÃ­colas y Pesqueras',                 'company',  'active'),
('623', 'Opcional para Grupos de Sociedades',                                        'company',  'active'),
('624', 'Coordinados',                                                               'company',  'active'),
('625', 'RÃ©gimen de las Actividades Empresariales con ingresos a travÃ©s de Plataformas TecnolÃ³gicas', 'personal', 'active'),
('626', 'RÃ©gimen Simplificado de Confianza',                                         'both',     'active'),
-- Additional regimes (migration 096)
('607', 'RÃ©gimen de EnajenaciÃ³n o AdquisiciÃ³n de Bienes',                          'personal', 'active'),
('609', 'ConsolidaciÃ³n',                                                             'company',  'active'),
('611', 'Ingresos por Dividendos (y en general por las Sociedades y Asociaciones Civiles)', 'personal', 'active'),
('615', 'RÃ©gimen de los ingresos por obtenciÃ³n de premios',                         'personal', 'active');

INSERT IGNORE INTO sat_uso_cfdi (code, description, applies_to, status) VALUES
('G01', 'AdquisiciÃ³n de mercancias',                                        'both',     'active'),
('G02', 'Devoluciones, descuentos o bonificaciones',                        'both',     'active'),
('G03', 'Gastos en general',                                                'both',     'active'),
('I01', 'Construcciones',                                                   'both',     'active'),
('I02', 'Mobilario y equipo de oficina por inversiones',                    'both',     'active'),
('I03', 'Equipo de transporte',                                             'both',     'active'),
('I04', 'Equipo de computo y accesorios',                                   'both',     'active'),
('I08', 'Otra maquinaria y equipo',                                         'both',     'active'),
('D01', 'Honorarios mÃ©dicos, dentales y gastos hospitalarios',              'personal', 'active'),
('D02', 'Gastos mÃ©dicos por incapacidad o discapacidad',                    'personal', 'active'),
('D03', 'Gastos funerales',                                                 'personal', 'active'),
('D04', 'Donativos',                                                        'personal', 'active'),
('P01', 'Por definir',                                                      'both',     'active'),
('S01', 'Sin efectos fiscales',                                             'both',     'active'),
('CP01', 'Pagos',                                                           'both',     'active'),
-- Additional uso CFDI codes (migration 096)
('D05', 'Primas por seguros de gastos mÃ©dicos',                                                             'personal', 'active'),
('D06', 'Gastos de transportaciÃ³n escolar obligatoria',                                                     'personal', 'active'),
('D07', 'DepÃ³sitos en cuentas para el ahorro, primas que tengan como base planes de pensiones',             'personal', 'active'),
('D08', 'Pagos por servicios educativos (colegiaturas)',                                                    'personal', 'active'),
('D09', 'Aportaciones voluntarias al SAR',                                                                  'personal', 'active'),
('D10', 'Primas por seguros de gastos mÃ©dicos mayores',                                                     'personal', 'active');

INSERT IGNORE INTO sat_forma_pago (code, description, status) VALUES
('01', 'Efectivo',                                                          'active'),
('02', 'Cheque nominativo',                                                 'active'),
('03', 'Transferencia electrÃ³nica de fondos',                               'active'),
('04', 'Tarjeta de crÃ©dito',                                                'active'),
('05', 'Monedero electrÃ³nico',                                              'active'),
('06', 'Dinero electrÃ³nico',                                                'active'),
('08', 'Vales de despensa',                                                 'active'),
('12', 'DaciÃ³n en pago',                                                    'active'),
('13', 'Pago por subrogaciÃ³n',                                              'active'),
('14', 'Pago por consignaciÃ³n',                                             'active'),
('15', 'CondonaciÃ³n',                                                       'active'),
('17', 'CompensaciÃ³n',                                                      'active'),
('23', 'NovaciÃ³n',                                                          'active'),
('24', 'ConfusiÃ³n',                                                         'active'),
('25', 'RemisiÃ³n de deuda',                                                 'active'),
('26', 'PrescripciÃ³n o caducidad',                                          'active'),
('27', 'A satisfacciÃ³n del acreedor',                                       'active'),
('28', 'Tarjeta de dÃ©bito',                                                 'active'),
('29', 'Tarjeta de servicios',                                              'active'),
('30', 'AplicaciÃ³n de anticipos',                                           'active'),
('31', 'Intermediario pagos',                                               'active'),
('99', 'Por definir',                                                       'active');

INSERT IGNORE INTO sat_metodo_pago (code, description, status) VALUES
('PUE', 'Pago en una sola exhibiciÃ³n',              'active'),
('PPD', 'Pago en parcialidades o diferido',         'active');

INSERT IGNORE INTO sat_tipo_comprobante (code, description, status) VALUES
('I', 'Ingreso',    'active'),
('E', 'Egreso',     'active'),
('P', 'Pago',       'active'),
('T', 'Traslado',   'active'),
('N', 'NÃ³mina',     'active');

INSERT IGNORE INTO sat_moneda (code, description, decimals, status) VALUES
('MXN', 'Peso Mexicano',                    2, 'active'),
('USD', 'DÃ³lar americano',                  2, 'active'),
('EUR', 'Euro',                             2, 'active'),
('XXX', 'Los cÃ³digos asignados para las transacciones en que no intervenga ninguna moneda',      2, 'active');

-- ---------------------------------------------------------------------------
-- Table: sat_clave_prod_serv
-- Purpose: SAT catalog c_ClaveProdServ â€” product and service classification
--          codes required on every concept (line item) in a CFDI 4.0 document.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_clave_prod_serv (
    code        VARCHAR(8)      NOT NULL
                    COMMENT 'SAT c_ClaveProdServ code (e.g. 81161700 for internet access services)',
    description VARCHAR(500)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active'
                    COMMENT 'Whether this code is currently valid in the SAT catalog',

    PRIMARY KEY (code),
    KEY idx_sat_clave_prod_serv_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_ClaveProdServ â€” product and service classification codes for CFDI 4.0 concepts';

-- ---------------------------------------------------------------------------
-- Table: sat_clave_unidad
-- Purpose: SAT catalog c_ClaveUnidad â€” unit-of-measure codes required on
--          every concept (line item) in a CFDI 4.0 document.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_clave_unidad (
    code        VARCHAR(10)     NOT NULL
                    COMMENT 'SAT c_ClaveUnidad code (e.g. E48 for service unit, H87 for piece)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish and/or English',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active'
                    COMMENT 'Whether this code is currently valid in the SAT catalog',

    PRIMARY KEY (code),
    KEY idx_sat_clave_unidad_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_ClaveUnidad â€” unit-of-measure codes for CFDI 4.0 concepts';

-- ---------------------------------------------------------------------------
-- Seed data: SAT c_ClaveProdServ and c_ClaveUnidad (migration 082)
-- ISP-relevant subset. Uses INSERT IGNORE for idempotent re-runs.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO sat_clave_prod_serv (code, description, status) VALUES
('81161700', 'Servicios de acceso a Internet',                   'active'),
('81161500', 'Servicios de telefonÃ­a y voz sobre IP (VoIP)',     'active'),
('81112200', 'Soporte tÃ©cnico',                                  'active'),
('81112100', 'Mantenimiento y actualizaciÃ³n de software',        'active'),
('43231500', 'Equipo de redes y telecomunicaciones',             'active'),
('43222600', 'Enrutadores y conmutadores de red (routers/switches)', 'active'),
('01010101', 'No aplica',                                        'active');

INSERT IGNORE INTO sat_clave_unidad (code, description, status) VALUES
('E48', 'Unidad de servicio / Service unit',    'active'),
('ACT', 'Actividad / Activity',                 'active'),
('HUR', 'Hora / Hour',                          'active'),
('MON', 'Mes / Month',                          'active'),
('H87', 'Pieza / Piece',                        'active'),
('MTR', 'Metro / Meter',                        'active');

-- ---------------------------------------------------------------------------
-- Table: cfdi_documents
-- Purpose: Core CFDI 4.0 fiscal document records. One row per stamped (or
--          draft) electronic fiscal document issued by an organization to a
--          client. Polymorphic source linkage ensures at most one of invoice_id,
--          credit_note_id, or payment_id is set per document.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_documents (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- Issuer & receiver references
    organization_id         BIGINT UNSIGNED NOT NULL
                                COMMENT 'Organization (ISP) that issued this CFDI',
    client_id               BIGINT UNSIGNED NOT NULL
                                COMMENT 'Client (receptor) for this CFDI',

    -- SAT folio fiscal (UUID assigned by PAC after stamping)
    uuid                    CHAR(36)        NULL     UNIQUE
                                COMMENT 'Folio fiscal UUID assigned by the PAC after successful stamping; NULL while in draft',

    -- Series and folio (issuer-assigned numbering)
    serie                   VARCHAR(10)     NULL
                                COMMENT 'CFDI series prefix (e.g. A, E, P)',
    folio                   BIGINT UNSIGNED NULL
                                COMMENT 'Sequential folio number within the series',

    -- Document classification (FK to SAT catalog)
    tipo_comprobante        VARCHAR(1)      NOT NULL
                                COMMENT 'SAT c_TipoDeComprobante: I=ingreso, E=egreso, P=pago, T=traslado, N=nomina',
    uso_cfdi                VARCHAR(4)      NOT NULL
                                COMMENT 'SAT c_UsoCFDI â€” receptor intended use (e.g. G03, S01)',
    metodo_pago             VARCHAR(3)      NULL
                                COMMENT 'SAT c_MetodoPago: PUE or PPD',
    forma_pago              VARCHAR(2)      NULL
                                COMMENT 'SAT c_FormaPago: payment instrument code (e.g. 03, 28)',

    -- Currency
    moneda                  VARCHAR(3)      NOT NULL DEFAULT 'MXN'
                                COMMENT 'SAT c_Moneda currency code',
    tipo_cambio             DECIMAL(10, 4)  NULL
                                COMMENT 'Exchange rate to MXN when moneda != MXN; NULL when moneda = MXN',

    -- Export classification (mandatory in CFDI 4.0 even for domestic transactions)
    exportacion             ENUM('01','02','03') NOT NULL DEFAULT '01'
                                COMMENT 'SAT Exportacion: 01=No exporta, 02=ExportaciÃ³n definitiva, 03=ExportaciÃ³n temporal',

    -- Receiver snapshot (denormalized at stamp time â€” must match SAT records)
    receptor_rfc            VARCHAR(13)     NULL
                                COMMENT 'Receiver RFC captured at stamp time',
    receptor_nombre         VARCHAR(300)    NULL
                                COMMENT 'Receiver razon_social captured at stamp time',
    receptor_regimen        VARCHAR(3)      NULL
                                COMMENT 'Receiver regimen_fiscal captured at stamp time',
    receptor_cp             VARCHAR(5)      NULL
                                COMMENT 'Receiver codigo_postal_fiscal captured at stamp time',

    -- Amounts
    subtotal                DECIMAL(12, 2)  NOT NULL DEFAULT 0.00
                                COMMENT 'Sum of concept amounts before taxes',
    total_impuestos         DECIMAL(12, 2)  NOT NULL DEFAULT 0.00
                                COMMENT 'Total taxes (IVA, IEPS, etc.) transferred or withheld',
    total                   DECIMAL(12, 2)  NOT NULL DEFAULT 0.00
                                COMMENT 'Grand total: subtotal +/- taxes',

    -- XML & PDF storage
    xml_content             MEDIUMTEXT      NULL
                                COMMENT 'Full signed CFDI XML as returned by the PAC',
    pdf_url                 VARCHAR(500)    NULL
                                COMMENT 'URL or path to the generated PDF representation',

    -- PAC stamping metadata
    pac_provider            VARCHAR(50)     NULL
                                COMMENT 'PAC that stamped this CFDI (e.g. Finkok, TimbraSoft)',
    stamp_date              DATETIME        NULL
                                COMMENT 'FechaTimbrado from the PAC timbrado complement',
    certificate_number      VARCHAR(30)     NULL
                                COMMENT 'NoCertificadoSAT from the PAC timbrado complement',
    sat_seal                TEXT            NULL
                                COMMENT 'SelloSAT from the PAC timbrado complement',

    -- Signed XML / PDF archival storage (SAT requires 5-year XML retention)
    signed_xml              LONGTEXT        NULL
                                COMMENT 'Complete signed and stamped CFDI XML document as returned by PAC',
    xml_file_id             BIGINT UNSIGNED NULL
                                COMMENT 'Reference to XML file in files table for large-document or archival storage',
    pdf_file_id             BIGINT UNSIGNED NULL
                                COMMENT 'Reference to generated PDF representation in files table',

    -- SAT status lifecycle
    sat_status              ENUM('draft', 'vigente', 'cancelado', 'cancel_pending')
                                NOT NULL DEFAULT 'draft'
                                COMMENT 'draft=not yet stamped; vigente=valid; cancel_pending=cancellation requested; cancelado=SAT confirmed cancellation',

    -- Cancellation fields
    cancellation_reason     ENUM('01', '02', '03', '04') NULL
                                COMMENT 'SAT c_MotivoCancelacion: 01=error in invoice, 02=not issued, 03=not defined, 04=nominative substitution',
    cancellation_uuid       CHAR(36)        NULL
                                COMMENT 'UUID of the substitute CFDI (required for reason 04)',
    cancelled_at            DATETIME        NULL
                                COMMENT 'Timestamp when SAT confirmed cancellation',

    -- Source document linkage (polymorphic â€” at most one may be non-NULL)
    invoice_id              BIGINT UNSIGNED NULL
                                COMMENT 'Invoice this CFDI type-I belongs to; NULL for other types or drafts',
    credit_note_id          BIGINT UNSIGNED NULL
                                COMMENT 'Credit note this CFDI type-E belongs to; NULL for other types',
    payment_id              BIGINT UNSIGNED NULL
                                COMMENT 'Payment this CFDI type-P complement belongs to; NULL for other types',

    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_cfdi_documents_uuid (uuid),
    KEY idx_cfdi_documents_organization_id (organization_id),
    KEY idx_cfdi_documents_client_id (client_id),
    KEY idx_cfdi_documents_tipo_comprobante (tipo_comprobante),
    KEY idx_cfdi_documents_sat_status (sat_status),
    KEY idx_cfdi_documents_stamp_date (stamp_date),
    KEY idx_cfdi_documents_invoice_id (invoice_id),
    KEY idx_cfdi_documents_credit_note_id (credit_note_id),
    KEY idx_cfdi_documents_payment_id (payment_id),
    KEY idx_cfdi_documents_serie_folio (serie, folio),

    CONSTRAINT fk_cfdi_documents_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_tipo_comprobante FOREIGN KEY (tipo_comprobante)
        REFERENCES sat_tipo_comprobante (code) ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_uso_cfdi FOREIGN KEY (uso_cfdi)
        REFERENCES sat_uso_cfdi (code) ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_metodo_pago FOREIGN KEY (metodo_pago)
        REFERENCES sat_metodo_pago (code) ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_forma_pago FOREIGN KEY (forma_pago)
        REFERENCES sat_forma_pago (code) ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_moneda FOREIGN KEY (moneda)
        REFERENCES sat_moneda (code) ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_cfdi_documents_credit_note FOREIGN KEY (credit_note_id)
        REFERENCES credit_notes (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_cfdi_documents_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_cfdi_documents_xml_file FOREIGN KEY (xml_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_pdf_file FOREIGN KEY (pdf_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE,

    -- At most one source document may be linked per CFDI
    CONSTRAINT chk_cfdi_documents_single_source CHECK (
        (
            (invoice_id     IS NOT NULL AND credit_note_id IS NULL     AND payment_id IS NULL)
         OR (invoice_id     IS NULL     AND credit_note_id IS NOT NULL  AND payment_id IS NULL)
         OR (invoice_id     IS NULL     AND credit_note_id IS NULL      AND payment_id IS NOT NULL)
         OR (invoice_id     IS NULL     AND credit_note_id IS NULL      AND payment_id IS NULL)
        )
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: cfdi_related_documents
-- Purpose: CfdiRelacionados (CFDI 4.0) â€” tracks relationships between CFDIs,
--          e.g. credit note referencing original invoice, or substitution of
--          a cancelled document.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_related_documents (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cfdi_document_id    BIGINT UNSIGNED NOT NULL
                            COMMENT 'The CFDI that declares the relationship',
    related_uuid        CHAR(36)        NOT NULL
                            COMMENT 'UUID (folio fiscal) of the related CFDI',
    relationship_type   VARCHAR(2)      NOT NULL
                            COMMENT 'SAT c_TipoRelacion code (e.g. 01=nota de crÃ©dito, 04=sustituciÃ³n)',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_related_docs_cfdi_id (cfdi_document_id),
    KEY idx_cfdi_related_docs_related_uuid (related_uuid),
    KEY idx_cfdi_related_docs_relationship_type (relationship_type),
    CONSTRAINT fk_cfdi_related_docs_cfdi FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: cfdi_payment_complements
-- Purpose: Complemento de Pago 2.0 (Recibo ElectrÃ³nico de Pago) headers.
--          One row per payment event that settles one or more PPD invoices.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_payment_complements (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cfdi_document_id    BIGINT UNSIGNED NOT NULL
                            COMMENT 'Parent CFDI type-P document that carries this complement',

    -- Payment event details
    payment_date        DATE            NOT NULL
                            COMMENT 'Date the payment was received (FechaPago)',
    forma_pago          VARCHAR(2)      NOT NULL
                            COMMENT 'SAT c_FormaPago â€” how the payment was made (e.g. 03=transfer, 28=debit card)',
    moneda              VARCHAR(3)      NOT NULL DEFAULT 'MXN'
                            COMMENT 'SAT c_Moneda â€” currency the payment was received in',
    tipo_cambio         DECIMAL(10, 4)  NULL
                            COMMENT 'Exchange rate to MXN when moneda != MXN',
    amount              DECIMAL(12, 2)  NOT NULL
                            COMMENT 'Total amount of this payment event',
    operation_number    VARCHAR(100)    NULL
                            COMMENT 'Bank transaction or reference number for the payment',

    -- Payer bank details
    payer_rfc           VARCHAR(13)     NULL
                            COMMENT 'RFC of the payer (when available from bank data)',
    payer_bank_name     VARCHAR(100)    NULL
                            COMMENT 'Name of the payer bank',
    payer_account       VARCHAR(50)     NULL
                            COMMENT 'CLABE or account number of the payer',

    -- Beneficiary (ISP) bank details
    beneficiary_rfc     VARCHAR(13)     NULL
                            COMMENT 'RFC of the beneficiary (organization RFC)',
    beneficiary_account VARCHAR(50)     NULL
                            COMMENT 'CLABE or account number of the beneficiary',

    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_payment_complements_cfdi_id (cfdi_document_id),
    KEY idx_cfdi_payment_complements_payment_date (payment_date),
    KEY idx_cfdi_payment_complements_forma_pago (forma_pago),
    CONSTRAINT fk_cfdi_payment_complements_cfdi FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: cfdi_payment_complement_items
-- Purpose: DoctoRelacionado rows for Complemento de Pago 2.0. Each item links
--          one PPD invoice (by CFDI UUID) to a payment complement, tracking
--          the outstanding balance before and after the payment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_payment_complement_items (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    complement_id       BIGINT UNSIGNED NOT NULL
                            COMMENT 'Parent payment complement this item belongs to',

    -- Related CFDI being settled
    related_cfdi_uuid   CHAR(36)        NOT NULL
                            COMMENT 'UUID (folio fiscal) of the PPD invoice being paid',
    serie               VARCHAR(10)     NULL
                            COMMENT 'Series of the related CFDI (for display)',
    folio               VARCHAR(40)     NULL
                            COMMENT 'Folio of the related CFDI (for display)',

    -- Currency of the related document
    moneda_dr           VARCHAR(3)      NOT NULL DEFAULT 'MXN'
                            COMMENT 'SAT c_Moneda â€” currency of the document being paid (MonedaDR)',
    equivalencia_dr     DECIMAL(10, 4)  NOT NULL DEFAULT 1.0000
                            COMMENT 'Exchange rate between moneda_dr and the complement payment currency',

    -- Installment tracking
    num_parcialidad     INT UNSIGNED    NOT NULL DEFAULT 1
                            COMMENT 'Installment number for this payment (1 = first partial or full payment)',

    -- Balance tracking (required by Complemento de Pago 2.0)
    imp_saldo_ant       DECIMAL(12, 2)  NOT NULL
                            COMMENT 'Outstanding balance before this payment (ImpSaldoAnt)',
    imp_pagado          DECIMAL(12, 2)  NOT NULL
                            COMMENT 'Amount paid toward this document in this complement (ImpPagado)',
    imp_saldo_insoluto  DECIMAL(12, 2)  NOT NULL
                            COMMENT 'Remaining balance after this payment: imp_saldo_ant - imp_pagado (ImpSaldoInsoluto)',

    -- Tax object indicator for this related document (Complemento de Pago 2.0)
    objeto_imp_dr       ENUM('01','02','03') NOT NULL DEFAULT '02'
                            COMMENT 'SAT ObjetoImpDR on DoctoRelacionado: 01=No objeto, 02=SÃ­ objeto, 03=SÃ­ objeto y no obligado al desglose',

    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_pci_complement_id (complement_id),
    KEY idx_cfdi_pci_related_uuid (related_cfdi_uuid),
    CONSTRAINT fk_cfdi_pci_complement FOREIGN KEY (complement_id)
        REFERENCES cfdi_payment_complements (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: cfdi_payment_complement_item_taxes
-- Purpose: Per-DoctoRelacionado tax breakdown (ImpuestosP) for Complemento de
--          Pago 2.0.  Required by the SAT when objeto_imp_dr = '02' on the
--          parent cfdi_payment_complement_items row.  Each row corresponds to
--          one Traslado or Retencion node inside ImpuestosP.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_payment_complement_item_taxes (
    id                  BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    complement_item_id  BIGINT UNSIGNED     NOT NULL
                            COMMENT 'Parent DoctoRelacionado item this tax row belongs to',
    tax_type            ENUM('traslado','retencion') NOT NULL
                            COMMENT 'Whether this is a transferred tax (Traslado) or a withholding (Retencion)',
    impuesto            VARCHAR(3)          NOT NULL
                            COMMENT 'SAT tax code: 001=ISR, 002=IVA, 003=IEPS',
    tipo_factor         ENUM('Tasa','Cuota','Exento') NOT NULL DEFAULT 'Tasa'
                            COMMENT 'SAT TipoFactorP: Tasa=rate, Cuota=fixed amount per unit, Exento=exempt',
    tasa_o_cuota        DECIMAL(8,6)        NULL
                            COMMENT 'Tax rate or per-unit quota; NULL when tipo_factor = ''Exento''',
    base                DECIMAL(14,4)       NOT NULL
                            COMMENT 'Taxable base amount for this tax line (BaseP)',
    importe             DECIMAL(14,4)       NULL
                            COMMENT 'Computed tax amount (ImporteP); NULL when tipo_factor = ''Exento''',
    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_pcit_complement_item_id (complement_item_id),
    KEY idx_cfdi_pcit_tax_type (tax_type),
    KEY idx_cfdi_pcit_impuesto (impuesto),

    CONSTRAINT fk_cfdi_pcit_complement_item FOREIGN KEY (complement_item_id)
        REFERENCES cfdi_payment_complement_items (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT Complemento de Pago 2.0: per-DoctoRelacionado tax breakdown (ImpuestosP)';

-- ---------------------------------------------------------------------------
-- Table: cfdi_conceptos
-- Purpose: CFDI 4.0 concept (line item) rows â€” one per <Concepto> node inside
--          a cfdi_document. Captures SAT-required fields: product/service key,
--          unit key, quantity, description, unit price, line total, optional
--          discount, and the SAT ObjetoImp indicator.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_conceptos (
    id                  BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,

    -- Parent CFDI document
    cfdi_document_id    BIGINT UNSIGNED     NOT NULL
                            COMMENT 'CFDI document this line item belongs to',

    -- SAT-required product/service and unit classification
    clave_prod_serv     VARCHAR(8)          NOT NULL
                            COMMENT 'SAT c_ClaveProdServ code identifying the product or service (e.g. 81161700)',
    clave_unidad        VARCHAR(10)         NOT NULL
                            COMMENT 'SAT c_ClaveUnidad unit-of-measure code (e.g. E48 for service unit)',

    -- Optional internal identifier
    no_identificacion   VARCHAR(100)        NULL
                            COMMENT 'Internal SKU or product code assigned by the issuer; NULL if not applicable',

    -- Quantity, description, and pricing
    cantidad            DECIMAL(12, 4)      NOT NULL
                            COMMENT 'Quantity of units sold or delivered',
    descripcion         VARCHAR(1000)       NOT NULL
                            COMMENT 'Free-text description of the product or service as it appears on the CFDI',
    valor_unitario      DECIMAL(14, 4)      NOT NULL
                            COMMENT 'Unit price before taxes',
    importe             DECIMAL(14, 4)      NOT NULL
                            COMMENT 'Line total: cantidad Ã— valor_unitario (before discount)',
    descuento           DECIMAL(14, 4)      NULL
                            COMMENT 'Discount amount applied to this line; NULL when no discount',

    -- SAT tax object indicator (ObjetoImp)
    objeto_imp          ENUM('01', '02', '03') NOT NULL DEFAULT '02'
                            COMMENT 'SAT ObjetoImp: 01=No objeto de impuesto, 02=SÃ­ objeto de impuesto, 03=SÃ­ objeto del impuesto y no obligado al desglose',

    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_conceptos_cfdi_document_id (cfdi_document_id),
    KEY idx_cfdi_conceptos_clave_prod_serv (clave_prod_serv),

    CONSTRAINT fk_cfdi_conceptos_cfdi_document FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_conceptos_clave_prod_serv FOREIGN KEY (clave_prod_serv)
        REFERENCES sat_clave_prod_serv (code) ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_conceptos_clave_unidad FOREIGN KEY (clave_unidad)
        REFERENCES sat_clave_unidad (code) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CFDI 4.0 concept (line item) rows â€” one row per <Concepto> node inside a cfdi_document';

-- ---------------------------------------------------------------------------
-- Table: cfdi_concepto_impuestos
-- Purpose: Per-line tax breakdown for CFDI 4.0. SAT requires explicit
--          <Traslados> and <Retenciones> nodes inside each <Concepto> when
--          objeto_imp = '02'. Each row maps to one <Traslado> or <Retencion>
--          element for a specific concept.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_concepto_impuestos (
    id                  BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,

    -- Parent concept
    cfdi_concepto_id    BIGINT UNSIGNED     NOT NULL
                            COMMENT 'CFDI concept (line item) this tax row belongs to',

    -- Tax classification
    tax_type            ENUM('traslado', 'retencion') NOT NULL
                            COMMENT 'traslado = tax transferred to the buyer (IVA, IEPS); retencion = withholding retained from the supplier (ISR, IVA retencion)',
    impuesto            VARCHAR(3)          NOT NULL
                            COMMENT 'SAT tax code: 001=ISR, 002=IVA, 003=IEPS',
    tipo_factor         ENUM('Tasa', 'Cuota', 'Exento') NOT NULL DEFAULT 'Tasa'
                            COMMENT 'Rate type: Tasa=percentage rate, Cuota=fixed quota per unit, Exento=exempt (no tax)',

    -- Rate and amounts
    tasa_o_cuota        DECIMAL(8, 6)       NULL
                            COMMENT 'Tax rate or quota (e.g. 0.160000 for IVA 16 %); NULL when tipo_factor = Exento',
    base                DECIMAL(14, 4)      NOT NULL
                            COMMENT 'Taxable base amount for this line (importe - descuento of the parent concept)',
    importe             DECIMAL(14, 4)      NULL
                            COMMENT 'Calculated tax amount: base Ã— tasa_o_cuota; NULL when tipo_factor = Exento',

    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_ci_cfdi_concepto_id (cfdi_concepto_id),
    KEY idx_cfdi_ci_tax_type (tax_type),
    KEY idx_cfdi_ci_impuesto (impuesto),

    CONSTRAINT fk_cfdi_ci_cfdi_concepto FOREIGN KEY (cfdi_concepto_id)
        REFERENCES cfdi_conceptos (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-line tax breakdown for CFDI 4.0 â€” one row per <Traslado> or <Retencion> inside a <Concepto>';

-- ---------------------------------------------------------------------------
-- Table: concession_titles
-- Purpose: IFT/CRT concession title registry. Mexican ISPs must hold a valid
--          concession title to operate legally. Tracks title number, type,
--          authorized services, spectrum bands, validity dates, and status.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS concession_titles (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL
                            COMMENT 'Organization that holds this concession title',
    title_number        VARCHAR(100)    NOT NULL UNIQUE
                            COMMENT 'Official concession title number as issued by IFT/CRT',
    concession_type     ENUM('commercial', 'public', 'social', 'community', 'indigenous', 'private')
                            NOT NULL DEFAULT 'commercial'
                            COMMENT 'Type of concession as defined by the LFTR',
    services_authorized JSON            NOT NULL
                            COMMENT 'JSON array of authorized services (e.g. ["internet","voip","data"])',
    geographic_scope    TEXT            NULL
                            COMMENT 'Description of the authorized geographic area (states, municipalities)',
    spectrum_bands      JSON            NULL
                            COMMENT 'JSON array of spectrum bands assigned (if applicable)',
    granted_date        DATE            NOT NULL
                            COMMENT 'Date the concession was originally granted',
    expiration_date     DATE            NULL
                            COMMENT 'Concession expiry date; NULL = indefinite duration',
    renewal_filed_at    DATE            NULL
                            COMMENT 'Date the renewal application was submitted to IFT/CRT',
    regulatory_body     ENUM('IFT', 'CRT') NOT NULL DEFAULT 'CRT'
                            COMMENT 'IFT = Instituto Federal de Telecomunicaciones (pre-2025); CRT = ComisiÃ³n de RegulaciÃ³n de Telecomunicaciones (from 2025)',
    document_file_id    BIGINT UNSIGNED NULL
                            COMMENT 'Reference to the official title document in the files table',
    status              ENUM('active', 'expired', 'revoked', 'pending_renewal')
                            NOT NULL DEFAULT 'active'
                            COMMENT 'active=valid; expired=past expiry; revoked=cancelled by authority; pending_renewal=renewal in progress',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_concession_titles_title_number (title_number),
    KEY idx_concession_titles_organization_id (organization_id),
    KEY idx_concession_titles_status (status),
    KEY idx_concession_titles_regulatory_body (regulatory_body),
    KEY idx_concession_titles_expiration_date (expiration_date),
    KEY idx_concession_titles_deleted_at (deleted_at),
    CONSTRAINT fk_concession_titles_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_concession_titles_document FOREIGN KEY (document_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: contract_templates_mx
-- Purpose: IFT/CRT-registered Carta de AdhesiÃ³n templates. Mexican ISPs must
--          register their standard contract model with IFT/CRT. Contracts
--          reference the specific registered template via FK.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_templates_mx (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NOT NULL
                                COMMENT 'Organization that owns this registered template',
    template_name           VARCHAR(200)    NOT NULL
                                COMMENT 'Internal descriptive name for this template version',
    ift_registration_number VARCHAR(100)    NULL
                                COMMENT 'Official registration number issued by IFT/CRT when the template was approved',
    registered_at           DATE            NULL
                                COMMENT 'Date IFT/CRT officially registered this template',
    version                 VARCHAR(20)     NOT NULL DEFAULT '1.0'
                                COMMENT 'Internal version label (e.g. 1.0, 2.0, 2025-rev1)',
    template_body           LONGTEXT        NULL
                                COMMENT 'Full text of the registered contract template',
    document_file_id        BIGINT UNSIGNED NULL
                                COMMENT 'Uploaded PDF/Word of the registered template in the files table',
    status                  ENUM('draft', 'submitted', 'registered', 'expired', 'revoked')
                                NOT NULL DEFAULT 'draft'
                                COMMENT 'draft=being prepared; submitted=sent to IFT/CRT; registered=officially approved; expired=superseded; revoked=withdrawn',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_contract_templates_mx_organization_id (organization_id),
    KEY idx_contract_templates_mx_status (status),
    KEY idx_contract_templates_mx_registered_at (registered_at),
    KEY idx_contract_templates_mx_deleted_at (deleted_at),
    CONSTRAINT fk_contract_templates_mx_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_contract_templates_mx_document FOREIGN KEY (document_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: regulatory_filings
-- Purpose: Tracks periodic regulatory filings submitted to IFT/CRT. Records
--          each filing event, status, and optional links to an uploaded document
--          and a concession title.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regulatory_filings (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NOT NULL
                                COMMENT 'Organization responsible for this filing',
    concession_title_id     BIGINT UNSIGNED NULL
                                COMMENT 'Concession title this filing relates to; NULL = general organizational filing',
    filing_type             ENUM(
                                'annual_report',
                                'quarterly_stats',
                                'tariff_registration',
                                'qos_report',
                                'coverage_report',
                                'spectrum_usage',
                                'other'
                            ) NOT NULL
                                COMMENT 'annual_report=yearly LFTR report; quarterly_stats=subscriber/usage stats; tariff_registration=tariff change notification; qos_report=quality of service; coverage_report=geographic coverage update; spectrum_usage=spectrum use report',
    period_start            DATE            NULL
                                COMMENT 'Start date of the reporting period',
    period_end              DATE            NULL
                                COMMENT 'End date of the reporting period',
    filed_at                TIMESTAMP       NULL
                                COMMENT 'Timestamp when the filing was submitted to IFT/CRT',
    acknowledgement_number  VARCHAR(100)    NULL
                                COMMENT 'Official acknowledgement number assigned by IFT/CRT upon receipt',
    document_file_id        BIGINT UNSIGNED NULL
                                COMMENT 'Uploaded filing document in the files table',
    status                  ENUM('pending', 'filed', 'accepted', 'rejected', 'overdue')
                                NOT NULL DEFAULT 'pending'
                                COMMENT 'pending=not yet submitted; filed=submitted awaiting response; accepted=authority confirmed; rejected=returned for correction; overdue=deadline passed without filing',
    notes                   TEXT            NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_regulatory_filings_organization_id (organization_id),
    KEY idx_regulatory_filings_concession_title_id (concession_title_id),
    KEY idx_regulatory_filings_filing_type (filing_type),
    KEY idx_regulatory_filings_status (status),
    KEY idx_regulatory_filings_filed_at (filed_at),
    KEY idx_regulatory_filings_period_start (period_start),
    KEY idx_regulatory_filings_deleted_at (deleted_at),
    CONSTRAINT fk_regulatory_filings_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_regulatory_filings_concession_title FOREIGN KEY (concession_title_id)
        REFERENCES concession_titles (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_regulatory_filings_document FOREIGN KEY (document_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_regulatory_filings_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ift_statistical_reports
-- Purpose: Pre-aggregated IFT/CRT reporting snapshots per organization per
--          reporting period. Stores subscriber counts, speed metrics, coverage,
--          and revenue data for export and official filing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ift_statistical_reports (
    id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id             BIGINT UNSIGNED NOT NULL
                                    COMMENT 'Organization this report snapshot belongs to',

    -- Reporting period
    report_period               VARCHAR(10)     NOT NULL
                                    COMMENT 'Human-readable period identifier (e.g. 2026-Q1, 2026-06, 2026-01)',
    period_start                DATE            NOT NULL
                                    COMMENT 'First day of the reporting period',
    period_end                  DATE            NOT NULL
                                    COMMENT 'Last day of the reporting period',

    -- Concession linkage (IFT F2)
    concession_title_id         BIGINT UNSIGNED NULL
                                    COMMENT 'Concession/authorization title under which the service is provided (IFT F2)',

    -- Subscriber counts
    total_subscribers           INT UNSIGNED    NOT NULL DEFAULT 0
                                    COMMENT 'Total active subscribers at the end of the period',
    subscribers_by_speed_tier   JSON            NULL
                                    COMMENT 'JSON object: speed tier label => subscriber count (e.g. {"10Mbps":120,"50Mbps":300})',
    subscribers_by_state        JSON            NULL
                                    COMMENT 'JSON object: state code => subscriber count',
    subscribers_by_municipality JSON            NULL
                                    COMMENT 'JSON object: INEGI municipality code => subscriber count (IFT F5 breakdown)',
    subscribers_by_technology   JSON            NULL
                                    COMMENT 'JSON object: technology label => subscriber count (e.g. {"fiber":200,"wireless":220})',
    subscribers_by_customer_type JSON           NULL
                                    COMMENT 'JSON object: residential/business subscriber counts (IFT F11)',
    subscribers_by_payment_modality JSON        NULL
                                    COMMENT 'JSON object: pospago/prepago/empaquetado subscriber counts (IFT F12)',
    coverage_localities         JSON            NULL
                                    COMMENT 'JSON array of locality codes (INEGI AGEB / localidad) covered',

    -- Speed metrics
    avg_download_speed_mbps     DECIMAL(8, 2)   NULL
                                    COMMENT 'Average contracted download speed across all active subscribers (Mbps)',
    avg_upload_speed_mbps       DECIMAL(8, 2)   NULL
                                    COMMENT 'Average contracted upload speed across all active subscribers (Mbps)',

    -- Coverage
    coverage_municipalities     INT UNSIGNED    NULL
                                    COMMENT 'Number of municipalities with at least one active subscriber',

    -- Revenue (optional â€” may be omitted if reported separately)
    revenue_total               DECIMAL(14, 2)  NULL
                                    COMMENT 'Total gross revenue for the period in local currency; NULL if not included in this report',

    -- Filing linkage
    filed_at                    TIMESTAMP       NULL
                                    COMMENT 'Timestamp when this snapshot was submitted to IFT/CRT',
    filing_id                   BIGINT UNSIGNED NULL
                                    COMMENT 'Regulatory filing record this snapshot was submitted as part of',

    status                      ENUM('draft', 'final', 'filed')
                                    NOT NULL DEFAULT 'draft'
                                    COMMENT 'draft=being prepared; final=ready for submission; filed=submitted to regulator',
    notes                       TEXT            NULL
                                    COMMENT 'Free-form notes / filing comments for this snapshot',

    created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ift_statistical_reports_org_period (organization_id, report_period),
    KEY idx_ift_statistical_reports_organization_id (organization_id),
    KEY idx_ift_statistical_reports_status (status),
    KEY idx_ift_statistical_reports_period_start (period_start),
    KEY idx_ift_statistical_reports_filing_id (filing_id),
    KEY idx_ift_statistical_reports_deleted_at (deleted_at),
    KEY idx_ift_statistical_reports_concession_title_id (concession_title_id),
    CONSTRAINT fk_ift_statistical_reports_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ift_statistical_reports_filing FOREIGN KEY (filing_id)
        REFERENCES regulatory_filings (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ift_statistical_reports_concession_title FOREIGN KEY (concession_title_id)
        REFERENCES concession_titles (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_ift_statistical_reports_period CHECK (period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- MX Locale Enforcement Triggers (migration 087)
-- =============================================================================
-- Purpose: Prevent MX-specific records from being created for clients or
--          organizations whose locale is not 'MX'. These triggers enforce at
--          the database level what was previously only documented as app-layer
--          conventions, closing data-integrity gaps where global entities could
--          leak into Mexican regulatory reports and e-invoicing workflows.

DELIMITER $$

-- ---------------------------------------------------------------------------
-- 1. client_mx_profiles â€” require clients.locale = 'MX'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_client_mx_profiles_bi
BEFORE INSERT ON client_mx_profiles
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'client_mx_profiles requires the referenced client to have locale = ''MX''';
    END IF;
END$$

CREATE TRIGGER trg_client_mx_profiles_bu
BEFORE UPDATE ON client_mx_profiles
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.client_id != OLD.client_id THEN
        SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'client_mx_profiles requires the referenced client to have locale = ''MX''';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- 2. organization_mx_profiles â€” require organizations.locale = 'MX'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_organization_mx_profiles_bi
BEFORE INSERT ON organization_mx_profiles
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'organization_mx_profiles requires the referenced organization to have locale = ''MX''';
    END IF;
END$$

CREATE TRIGGER trg_organization_mx_profiles_bu
BEFORE UPDATE ON organization_mx_profiles
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.organization_id != OLD.organization_id THEN
        SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'organization_mx_profiles requires the referenced organization to have locale = ''MX''';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- 3. cfdi_documents â€” require clients.locale = 'MX'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_cfdi_documents_bi
BEFORE INSERT ON cfdi_documents
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'cfdi_documents requires the referenced client to have locale = ''MX''';
    END IF;
END$$

CREATE TRIGGER trg_cfdi_documents_bu
BEFORE UPDATE ON cfdi_documents
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.client_id != OLD.client_id THEN
        SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'cfdi_documents requires the referenced client to have locale = ''MX''';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- 4. concession_titles â€” require organizations.locale = 'MX'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_concession_titles_bi
BEFORE INSERT ON concession_titles
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'concession_titles requires the referenced organization to have locale = ''MX''';
    END IF;
END$$

CREATE TRIGGER trg_concession_titles_bu
BEFORE UPDATE ON concession_titles
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.organization_id != OLD.organization_id THEN
        SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'concession_titles requires the referenced organization to have locale = ''MX''';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- 5. contract_templates_mx â€” require organizations.locale = 'MX'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_contract_templates_mx_bi
BEFORE INSERT ON contract_templates_mx
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'contract_templates_mx requires the referenced organization to have locale = ''MX''';
    END IF;
END$$

CREATE TRIGGER trg_contract_templates_mx_bu
BEFORE UPDATE ON contract_templates_mx
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.organization_id != OLD.organization_id THEN
        SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'contract_templates_mx requires the referenced organization to have locale = ''MX''';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- 6. regulatory_filings â€” require organizations.locale = 'MX'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_regulatory_filings_bi
BEFORE INSERT ON regulatory_filings
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'regulatory_filings requires the referenced organization to have locale = ''MX''';
    END IF;
END$$

CREATE TRIGGER trg_regulatory_filings_bu
BEFORE UPDATE ON regulatory_filings
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.organization_id != OLD.organization_id THEN
        SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'regulatory_filings requires the referenced organization to have locale = ''MX''';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- 7. ift_statistical_reports â€” require organizations.locale = 'MX'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_ift_statistical_reports_bi
BEFORE INSERT ON ift_statistical_reports
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
    IF v_locale IS NULL OR v_locale != 'MX' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'ift_statistical_reports requires the referenced organization to have locale = ''MX''';
    END IF;
END$$

CREATE TRIGGER trg_ift_statistical_reports_bu
BEFORE UPDATE ON ift_statistical_reports
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.organization_id != OLD.organization_id THEN
        SELECT locale INTO v_locale FROM organizations WHERE id = NEW.organization_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'ift_statistical_reports requires the referenced organization to have locale = ''MX''';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- 8. contracts â€” require clients.locale = 'MX' when
--               contract_template_mx_id IS NOT NULL
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_contracts_mx_template_bi
BEFORE INSERT ON contracts
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.contract_template_mx_id IS NOT NULL THEN
        SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'contracts.contract_template_mx_id requires the referenced client to have locale = ''MX''';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_contracts_mx_template_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.contract_template_mx_id IS NOT NULL THEN
        SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'contracts.contract_template_mx_id requires the referenced client to have locale = ''MX''';
        END IF;
    END IF;
END$$

-- =============================================================================
-- Locale Downgrade Guard Triggers (migration 088)
-- =============================================================================
-- Purpose: Prevent changing clients.locale or organizations.locale from 'MX'
--          to 'global' when MX-dependent records still exist. Without these
--          guards, an operator could accidentally break the integrity guarantees
--          established by the enforcement triggers above.

-- ---------------------------------------------------------------------------
-- clients â€” prevent locale downgrade from 'MX' to 'global'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_clients_locale_downgrade_bu
BEFORE UPDATE ON clients
FOR EACH ROW
BEGIN
    DECLARE v_has_mx_profile BOOLEAN DEFAULT FALSE;
    DECLARE v_has_cfdi       BOOLEAN DEFAULT FALSE;

    IF OLD.locale = 'MX' AND NEW.locale != 'MX' THEN
        SELECT EXISTS(SELECT 1 FROM client_mx_profiles WHERE client_id = OLD.id)
        INTO v_has_mx_profile;

        IF v_has_mx_profile THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change client locale from ''MX'': client_mx_profiles record exists. Delete the MX profile first.';
        END IF;

        SELECT EXISTS(SELECT 1 FROM cfdi_documents WHERE client_id = OLD.id)
        INTO v_has_cfdi;

        IF v_has_cfdi THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change client locale from ''MX'': cfdi_documents records exist for this client.';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- organizations â€” prevent locale downgrade from 'MX' to 'global'
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_organizations_locale_downgrade_bu
BEFORE UPDATE ON organizations
FOR EACH ROW
BEGIN
    DECLARE v_has_records BOOLEAN DEFAULT FALSE;

    IF OLD.locale = 'MX' AND NEW.locale != 'MX' THEN
        -- Check organization_mx_profiles
        SELECT EXISTS(SELECT 1 FROM organization_mx_profiles WHERE organization_id = OLD.id)
        INTO v_has_records;

        IF v_has_records THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': organization_mx_profiles record exists.';
        END IF;

        -- Check concession_titles
        SELECT EXISTS(SELECT 1 FROM concession_titles WHERE organization_id = OLD.id)
        INTO v_has_records;

        IF v_has_records THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': concession_titles records exist.';
        END IF;

        -- Check contract_templates_mx
        SELECT EXISTS(SELECT 1 FROM contract_templates_mx WHERE organization_id = OLD.id)
        INTO v_has_records;

        IF v_has_records THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': contract_templates_mx records exist.';
        END IF;

        -- Check regulatory_filings
        SELECT EXISTS(SELECT 1 FROM regulatory_filings WHERE organization_id = OLD.id)
        INTO v_has_records;

        IF v_has_records THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': regulatory_filings records exist.';
        END IF;

        -- Check ift_statistical_reports
        SELECT EXISTS(SELECT 1 FROM ift_statistical_reports WHERE organization_id = OLD.id)
        INTO v_has_records;

        IF v_has_records THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': ift_statistical_reports records exist.';
        END IF;
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Table: factura_publica_invoices
-- Purpose: Factura pÃºblica (venta al pÃºblico en general) periodic aggregation
--          documents.  When MX-locale contracts have facturar = FALSE, their
--          invoices are aggregated into a periodic factura pÃºblica per the SAT
--          InformacionGlobal node fields (Periodicidad, Meses, AÃ±o).  One row
--          per organization per period.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factura_publica_invoices (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,

    -- Issuer
    organization_id         BIGINT UNSIGNED  NOT NULL
                                COMMENT 'Organization (ISP) issuing this factura pÃºblica',

    -- Link to the stamped CFDI record (NULL while accumulating / draft)
    cfdi_document_id        BIGINT UNSIGNED  NULL
                                COMMENT 'Stamped CFDI document record; NULL while the factura pÃºblica is still in draft',

    -- SAT InformacionGlobal node fields
    periodicidad            ENUM('01', '02', '03', '04', '05') NOT NULL
                                COMMENT 'SAT c_Periodicidad: 01=Diario, 02=Semanal, 03=Quincenal, 04=Mensual, 05=Bimestral',
    meses                   VARCHAR(2)       NOT NULL
                                COMMENT 'SAT c_Meses: 01-12=individual month, 13=Ene-Feb, 14=Mar-Abr, 15=May-Jun, 16=Jul-Ago, 17=Sep-Oct, 18=Nov-Dic',
    anio                    SMALLINT UNSIGNED NOT NULL
                                COMMENT 'Fiscal year for the InformacionGlobal node (e.g. 2026)',

    -- Aggregated totals (denormalized for quick reads)
    subtotal                DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Sum of all pÃºblico en general invoice subtotals in this period',
    total_impuestos         DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Total transferred taxes for the period',
    total                   DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Grand total: subtotal + total_impuestos',

    -- Lifecycle
    status                  ENUM('draft', 'stamped', 'cancelled') NOT NULL DEFAULT 'draft'
                                COMMENT 'draft=accumulating invoices; stamped=factura pÃºblica issued via PAC; cancelled=voided',

    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_factura_publica_invoices_period (organization_id, periodicidad, meses, anio),
    KEY idx_factura_publica_invoices_cfdi_document_id (cfdi_document_id),
    KEY idx_factura_publica_invoices_status (status),
    KEY idx_factura_publica_invoices_anio_meses (anio, meses),

    CONSTRAINT fk_factura_publica_invoices_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_factura_publica_invoices_cfdi_document FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE SET NULL ON UPDATE CASCADE,

    -- Meses must be a valid SAT c_Meses code (01-18)
    CONSTRAINT chk_factura_publica_invoices_meses CHECK (
        meses IN ('01','02','03','04','05','06','07','08','09','10','11','12',
                  '13','14','15','16','17','18')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Factura pÃºblica (venta al pÃºblico en general) â€” periodic aggregation of non-facturar sales per SAT CFDI 4.0 InformacionGlobal';

-- ---------------------------------------------------------------------------
-- Table: factura_publica_invoice_items
-- Purpose: Junction table linking individual invoices from contracts with
--          facturar = FALSE to their parent factura pÃºblica.  Each invoice
--          may belong to at most one factura pÃºblica document.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factura_publica_invoice_items (
    id                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    factura_publica_invoice_id      BIGINT UNSIGNED NOT NULL
                                        COMMENT 'Parent factura pÃºblica document this invoice is aggregated into',
    invoice_id                      BIGINT UNSIGNED NOT NULL
                                        COMMENT 'Individual invoice from a contract with facturar = FALSE',

    created_at                      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_factura_publica_invoice_items_invoice (invoice_id),
    KEY idx_factura_publica_invoice_items_parent_id (factura_publica_invoice_id),

    CONSTRAINT fk_factura_publica_invoice_items_parent FOREIGN KEY (factura_publica_invoice_id)
        REFERENCES factura_publica_invoices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_factura_publica_invoice_items_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Links individual invoices to their parent factura pÃºblica â€” each invoice belongs to at most one factura pÃºblica';

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- Function: fn_predominant_forma_pago
-- Migration: 091_add_factura_publica_stamping_safeguards
-- Purpose: Returns the SAT FormaPago code (VARCHAR 2) that accounts for the
--          largest share of payments linked to the given factura pÃºblica.
--          Defaults to '99' (Por definir) when no payments exist or when two
--          or more codes tie for the highest total.
--          Call at stamp time to populate cfdi_documents.forma_pago.
-- ---------------------------------------------------------------------------
DELIMITER $$

CREATE FUNCTION fn_predominant_forma_pago(
    p_factura_publica_invoice_id BIGINT UNSIGNED
)
RETURNS VARCHAR(2)
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_forma_pago VARCHAR(2) DEFAULT '99';
    DECLARE v_max_total  DECIMAL(14, 2);
    DECLARE v_tie_count  INT DEFAULT 0;

    -- Step 1: Find the highest payment total across all FormaPago codes.
    SELECT MAX(group_total)
    INTO   v_max_total
    FROM (
        SELECT SUM(p.amount) AS group_total
        FROM   factura_publica_invoice_items fpi
        JOIN   payments p ON p.invoice_id = fpi.invoice_id
        WHERE  fpi.factura_publica_invoice_id = p_factura_publica_invoice_id
          AND  p.sat_forma_pago IS NOT NULL
        GROUP  BY p.sat_forma_pago
    ) grouped;

    IF v_max_total IS NULL THEN
        RETURN '99';
    END IF;

    -- Step 2: Count how many codes share the maximum total (tie detection).
    SELECT COUNT(*) INTO v_tie_count
    FROM (
        SELECT   p.sat_forma_pago
        FROM     factura_publica_invoice_items fpi
        JOIN     payments p ON p.invoice_id = fpi.invoice_id
        WHERE    fpi.factura_publica_invoice_id = p_factura_publica_invoice_id
          AND    p.sat_forma_pago IS NOT NULL
        GROUP BY p.sat_forma_pago
        HAVING   SUM(p.amount) = v_max_total
    ) tied;

    IF v_tie_count != 1 THEN
        RETURN '99';
    END IF;

    -- Step 3: Retrieve the unique winning code.
    SELECT   p.sat_forma_pago
    INTO     v_forma_pago
    FROM     factura_publica_invoice_items fpi
    JOIN     payments p ON p.invoice_id = fpi.invoice_id
    WHERE    fpi.factura_publica_invoice_id = p_factura_publica_invoice_id
      AND    p.sat_forma_pago IS NOT NULL
    GROUP BY p.sat_forma_pago
    HAVING   SUM(p.amount) = v_max_total
    LIMIT 1;

    RETURN v_forma_pago;
END$$

-- ---------------------------------------------------------------------------
-- Trigger: trg_factura_publica_invoices_bu
-- Migration: 091_add_factura_publica_stamping_safeguards
-- Purpose: Prevents factura_publica_invoices.status from being set to
--          'stamped' when any linked invoice is not 'paid'.
--          Raises SQLSTATE '45000' on violation.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_factura_publica_invoices_bu
BEFORE UPDATE ON factura_publica_invoices
FOR EACH ROW
BEGIN
    DECLARE v_unpaid_count INT DEFAULT 0;

    IF NEW.status = 'stamped' AND OLD.status != 'stamped' THEN
        SELECT COUNT(*) INTO v_unpaid_count
        FROM   factura_publica_invoice_items fpi
        JOIN   invoices i ON i.id = fpi.invoice_id
        WHERE  fpi.factura_publica_invoice_id = NEW.id
          AND  i.status != 'paid';

        IF v_unpaid_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot stamp factura pÃºblica: all linked invoices must have status = ''paid''. Remove or pay unpaid invoices before stamping.';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- Trigger: trg_factura_publica_invoice_items_bi
-- Migration: 091_add_factura_publica_stamping_safeguards
-- Purpose: Prevents inserting a row into factura_publica_invoice_items when
--          the referenced invoice does not have status = 'paid'.
--          Raises SQLSTATE '45000' on violation.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_factura_publica_invoice_items_bi
BEFORE INSERT ON factura_publica_invoice_items
FOR EACH ROW
BEGIN
    DECLARE v_invoice_status VARCHAR(20);

    SELECT status INTO v_invoice_status
    FROM   invoices
    WHERE  id = NEW.invoice_id;

    IF v_invoice_status IS NULL OR v_invoice_status != 'paid' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot add invoice to factura pÃºblica: invoice must have status = ''paid''.';
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Seed: CSD expiry monitoring scheduled task (migration 100)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, payload, priority, max_retries, timeout_seconds,
     is_enabled)
VALUES
    (NULL,
     'csd_expiry_monitor',
     'notification',
     'App\\Tasks\\Mx\\CsdExpiryMonitorTask',
     'Checks organization_mx_profiles.csd_valid_to and sends an alert when a CSD is within 30 days of expiration.',
     '0 8 * * *',
     JSON_OBJECT(
         'warning_days',    30,
         'critical_days',   7,
         'notification_channels', JSON_ARRAY('email', 'in_app')
     ),
     'high',
     3,
     120,
     TRUE);

-- ---------------------------------------------------------------------------
-- Triggers: contracts.facturar guard (migration 097)
-- Purpose: Prevent facturar = TRUE on contracts for non-MX clients.
-- ---------------------------------------------------------------------------
DELIMITER $$

CREATE TRIGGER trg_contracts_facturar_bi
BEFORE INSERT ON contracts
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.facturar = TRUE THEN
        SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'contracts.facturar can only be TRUE when the client has locale = ''MX''';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_contracts_facturar_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    DECLARE v_locale VARCHAR(10);
    IF NEW.facturar = TRUE AND (OLD.facturar = FALSE OR OLD.client_id != NEW.client_id) THEN
        SELECT locale INTO v_locale FROM clients WHERE id = NEW.client_id;
        IF v_locale IS NULL OR v_locale != 'MX' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'contracts.facturar can only be TRUE when the client has locale = ''MX''';
        END IF;
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Table: payment_gateways
-- Purpose: Configuration table for payment gateway providers (Stripe, Conekta,
--          OpenPay, MercadoPago, PayPal, manual, etc.) per organization.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_gateways (
    id                       BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id          BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization that owns this gateway config',
    name                     VARCHAR(100)     NOT NULL                    COMMENT 'Friendly label, e.g. "Conekta ProducciÃ³n"',
    provider                 ENUM('stripe','conekta','openpay','mercadopago','paypal','manual','other')
                                              NOT NULL                    COMMENT 'Payment provider identifier',
    environment              ENUM('sandbox','production')
                                              NOT NULL DEFAULT 'sandbox'  COMMENT 'Gateway environment',
    public_key               VARCHAR(500)     NULL                        COMMENT 'Provider public/publishable key (not secret)',
    secret_key_encrypted     TEXT             NOT NULL                    COMMENT 'Encrypted secret/private API key',
    webhook_secret_encrypted TEXT             NULL                        COMMENT 'Encrypted webhook signing secret',
    is_default               TINYINT(1)       NOT NULL DEFAULT 0          COMMENT 'TRUE = default gateway for this organization',
    status                   ENUM('active','inactive')
                                              NOT NULL DEFAULT 'active'   COMMENT 'Gateway status',
    config_json              JSON             NULL                        COMMENT 'Provider-specific extra settings (e.g. merchant IDs, endpoint overrides)',
    created_at               TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_payment_gateways_organization_id (organization_id),
    KEY idx_payment_gateways_provider (provider),
    KEY idx_payment_gateways_status (status),
    KEY idx_payment_gateways_deleted_at (deleted_at),
    CONSTRAINT fk_payment_gateways_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payment_transactions
-- Purpose: Raw gateway transaction log for every payment attempt. Records the
--          provider's reference ID, status, raw request/response payloads, and
--          webhook data for auditing and reconciliation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_transactions (
    id                        BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    payment_id                BIGINT UNSIGNED  NULL                        COMMENT 'Link to internal payment record; NULL while the gateway attempt is pending',
    payment_gateway_id        BIGINT UNSIGNED  NOT NULL                    COMMENT 'Gateway used for this transaction',
    client_id                 BIGINT UNSIGNED  NOT NULL                    COMMENT 'Client being charged',
    organization_id           BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization',
    gateway_reference_id      VARCHAR(255)     NOT NULL                    COMMENT 'Provider-assigned transaction / charge ID',
    amount                    DECIMAL(12, 2)   NOT NULL                    COMMENT 'Attempted charge amount',
    currency                  VARCHAR(3)       NOT NULL DEFAULT 'MXN'      COMMENT 'ISO 4217 currency code',
    gateway_status            ENUM('pending','succeeded','failed','refunded','disputed','cancelled')
                                               NOT NULL DEFAULT 'pending'  COMMENT 'Status as reported by the gateway',
    gateway_response_code     VARCHAR(50)      NULL                        COMMENT 'Provider-specific result/error code',
    gateway_response_message  TEXT             NULL                        COMMENT 'Human-readable message from the provider',
    raw_request               JSON             NULL                        COMMENT 'Outbound API request body (PII/card data must be scrubbed before storage)',
    raw_response              JSON             NULL                        COMMENT 'Full response body received from the provider',
    webhook_payload           JSON             NULL                        COMMENT 'Incoming webhook payload that triggered a status update',
    idempotency_key           VARCHAR(255)     NULL                        COMMENT 'Client-supplied idempotency key to prevent duplicate charges',
    created_at                TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_transactions_idempotency_key (idempotency_key),
    KEY idx_payment_transactions_payment_id (payment_id),
    KEY idx_payment_transactions_gateway_id (payment_gateway_id),
    KEY idx_payment_transactions_client_id (client_id),
    KEY idx_payment_transactions_organization_id (organization_id),
    KEY idx_payment_transactions_gateway_reference_id (gateway_reference_id),
    KEY idx_payment_transactions_gateway_status (gateway_status),
    CONSTRAINT fk_payment_transactions_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payment_transactions_gateway FOREIGN KEY (payment_gateway_id)
        REFERENCES payment_gateways (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_transactions_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_transactions_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payment_retries
-- Purpose: Tracks failed payment charges and schedules automatic retry
--          attempts with exponential backoff (4h â†’ 24h â†’ 72h, max 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_retries (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization',
    transaction_id        BIGINT UNSIGNED  NOT NULL                    COMMENT 'Original failed payment_transactions record',
    client_id             BIGINT UNSIGNED  NOT NULL                    COMMENT 'Client being charged',
    invoice_id            BIGINT UNSIGNED  NULL                        COMMENT 'Invoice the charge is for (if known)',
    recurring_profile_id  BIGINT UNSIGNED  NULL                        COMMENT 'Recurring payment profile used for retry (if applicable)',
    amount                DECIMAL(12, 2)   NOT NULL                    COMMENT 'Amount to retry charging',
    currency              VARCHAR(3)       NOT NULL DEFAULT 'MXN'      COMMENT 'ISO 4217 currency code',
    attempt_number        TINYINT UNSIGNED NOT NULL DEFAULT 0          COMMENT 'Number of retry attempts executed so far',
    max_attempts          TINYINT UNSIGNED NOT NULL DEFAULT 3          COMMENT 'Maximum retry attempts allowed',
    status                ENUM('pending','processing','succeeded','exhausted','cancelled')
                                           NOT NULL DEFAULT 'pending'  COMMENT 'Current retry schedule status',
    last_error            TEXT             NULL                        COMMENT 'Error message from the most recent retry attempt',
    last_attempt_at       TIMESTAMP        NULL                        COMMENT 'When the last retry attempt was executed',
    next_retry_at         TIMESTAMP        NULL                        COMMENT 'Scheduled time for the next retry attempt',
    completed_at          TIMESTAMP        NULL                        COMMENT 'When the retry schedule completed (succeeded or exhausted)',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_payment_retries_organization_id (organization_id),
    KEY idx_payment_retries_transaction_id (transaction_id),
    KEY idx_payment_retries_client_id (client_id),
    KEY idx_payment_retries_invoice_id (invoice_id),
    KEY idx_payment_retries_status_next_retry (status, next_retry_at),
    CONSTRAINT fk_payment_retries_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_retries_transaction FOREIGN KEY (transaction_id)
        REFERENCES payment_transactions (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_retries_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_retries_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_payment_retries_attempts CHECK (attempt_number <= max_attempts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: recurring_payment_profiles
-- Purpose: Stored card / token per client for autopay (recurring charges).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurring_payment_profiles (
    id                  BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    client_id           BIGINT UNSIGNED     NOT NULL                   COMMENT 'Client this autopay profile belongs to',
    payment_gateway_id  BIGINT UNSIGNED     NOT NULL                   COMMENT 'Gateway that issued the stored token',
    token_reference     VARCHAR(500)        NOT NULL                   COMMENT 'Gateway customer ID or card token',
    card_brand          VARCHAR(20)         NULL                       COMMENT 'Card network: visa, mastercard, amex, etc.',
    card_last_four      CHAR(4)             NULL                       COMMENT 'Last four digits of the card number',
    card_exp_month      TINYINT UNSIGNED    NULL                       COMMENT 'Card expiry month (1â€“12)',
    card_exp_year       SMALLINT UNSIGNED   NULL                       COMMENT 'Card expiry year (4-digit)',
    is_default          TINYINT(1)          NOT NULL DEFAULT 0         COMMENT 'TRUE = preferred profile for autopay',
    status              ENUM('active','expired','revoked')
                                            NOT NULL DEFAULT 'active'  COMMENT 'Profile lifecycle status',
    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_recurring_profiles_client_id (client_id),
    KEY idx_recurring_profiles_gateway_id (payment_gateway_id),
    KEY idx_recurring_profiles_status (status),
    KEY idx_recurring_payment_profiles_deleted_at (deleted_at),
    CONSTRAINT fk_recurring_profiles_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_recurring_profiles_gateway FOREIGN KEY (payment_gateway_id)
        REFERENCES payment_gateways (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payment_retries
    ADD CONSTRAINT fk_payment_retries_profile FOREIGN KEY (recurring_profile_id)
        REFERENCES recurring_payment_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: suspension_rules
-- Purpose: Configurable suspension rules per organization â€” defines when and
--          how overdue clients should be notified, suspended, or disconnected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suspension_rules (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL                         COMMENT 'Tenant organization that owns this rule',
    name                VARCHAR(150)     NOT NULL                         COMMENT 'Descriptive rule name, e.g. "SuspensiÃ³n 30 dÃ­as"',
    days_past_due       INT UNSIGNED     NOT NULL                         COMMENT 'Number of days overdue before this rule triggers',
    grace_period_days   INT UNSIGNED     NOT NULL DEFAULT 0               COMMENT 'Additional grace days after trigger before action is executed',
    action              ENUM('auto_suspend','notify_only','auto_disconnect','soft_suspend')
                                         NOT NULL                         COMMENT 'Action to perform when rule fires',
    soft_suspend_download_kbps INT UNSIGNED NULL DEFAULT 128              COMMENT 'Throttled download speed (kbps) applied during soft suspension; NULL = inherit plan default',
    soft_suspend_upload_kbps   INT UNSIGNED NULL DEFAULT 128              COMMENT 'Throttled upload speed (kbps) applied during soft suspension; NULL = inherit plan default',
    notify_before_days  INT UNSIGNED     NULL                             COMMENT 'Send a warning notification this many days before suspension; NULL = no advance notice',
    apply_to_plan_ids   JSON             NULL                             COMMENT 'JSON array of plan IDs this rule applies to; NULL = applies to all plans',
    is_active           TINYINT(1)       NOT NULL DEFAULT 1               COMMENT 'FALSE = rule is disabled and will not be evaluated',
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_suspension_rules_organization_id (organization_id),
    KEY idx_suspension_rules_is_active (is_active),
    KEY idx_suspension_rules_deleted_at (deleted_at),
    CONSTRAINT fk_suspension_rules_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: suspension_logs
-- Purpose: History of suspend / unsuspend / disconnect / reconnect events per
--          contract. Captures the triggering rule, performer, RADIUS CoA
--          outcome, and linked invoice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suspension_logs (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    contract_id          BIGINT UNSIGNED  NOT NULL                   COMMENT 'Contract affected by this suspension event',
    client_id            BIGINT UNSIGNED  NOT NULL                   COMMENT 'Client that owns the contract',
    suspension_rule_id   BIGINT UNSIGNED  NULL                       COMMENT 'Rule that triggered the action; NULL = manual action',
    action               ENUM('suspended','unsuspended','disconnected','reconnected')
                                          NOT NULL                   COMMENT 'Lifecycle action performed',
    reason               TEXT             NULL                       COMMENT 'Free-text explanation of why the action was taken',
    triggered_by         ENUM('system','manual')
                                          NOT NULL                   COMMENT 'Whether the action was triggered automatically or by a user',
    performed_by_user_id BIGINT UNSIGNED  NULL                       COMMENT 'User who performed the action; NULL = system-triggered',
    radius_coa_sent      TINYINT(1)       NOT NULL DEFAULT 0         COMMENT 'TRUE if a RADIUS Change-of-Authorization packet was dispatched',
    radius_coa_response  TEXT             NULL                       COMMENT 'Raw RADIUS CoA response or error message',
    related_invoice_id   BIGINT UNSIGNED  NULL                       COMMENT 'Invoice that caused the suspension (most overdue invoice)',
    suspended_at         TIMESTAMP        NOT NULL                   COMMENT 'Timestamp when the suspend/disconnect action was applied',
    restored_at          TIMESTAMP        NULL                       COMMENT 'Timestamp when service was restored; NULL if still suspended',
    created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_suspension_logs_contract_id (contract_id),
    KEY idx_suspension_logs_client_id (client_id),
    KEY idx_suspension_logs_rule_id (suspension_rule_id),
    KEY idx_suspension_logs_performed_by (performed_by_user_id),
    KEY idx_suspension_logs_related_invoice (related_invoice_id),
    KEY idx_suspension_logs_action (action),
    CONSTRAINT fk_suspension_logs_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_suspension_logs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_suspension_logs_rule FOREIGN KEY (suspension_rule_id)
        REFERENCES suspension_rules (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_suspension_logs_user FOREIGN KEY (performed_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_suspension_logs_invoice FOREIGN KEY (related_invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: csd_certificates
-- Purpose: CSD (Certificado de Sello Digital) storage per organization for SAT
--          CFDI 4.0 stamping (timbrado). Holds PEM-encoded public certificate
--          and encrypted private key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS csd_certificates (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL                   COMMENT 'Organization this CSD belongs to',
    certificate_number    VARCHAR(20)      NOT NULL                   COMMENT 'NoCertificado value from the .cer file (20-digit SAT serial)',
    rfc                   VARCHAR(13)      NOT NULL                   COMMENT 'RFC of the certificate holder (must match organization_mx_profiles.rfc)',
    issuer_name           VARCHAR(300)     NULL                       COMMENT 'Certificate issuer DN as stored in the .cer',
    serial_number         VARCHAR(100)     NULL                       COMMENT 'X.509 serial number in hex',
    valid_from            DATETIME         NOT NULL                   COMMENT 'Certificate notBefore date/time',
    valid_to              DATETIME         NOT NULL                   COMMENT 'Certificate notAfter date/time â€” used for expiry monitoring',
    cer_pem               TEXT             NOT NULL                   COMMENT 'PEM-encoded public certificate (.cer converted to PEM)',
    key_pem_encrypted     TEXT             NOT NULL                   COMMENT 'Application-encrypted PEM-encoded private key (.key)',
    passphrase_encrypted  TEXT             NULL                       COMMENT 'Application-encrypted passphrase for the private key, if applicable',
    fingerprint_sha256    VARCHAR(64)      NOT NULL                   COMMENT 'SHA-256 fingerprint of the public certificate for deduplication',
    is_active             TINYINT(1)       NOT NULL DEFAULT 1         COMMENT 'TRUE = this certificate is in use for stamping',
    status                ENUM('active','expired','revoked')
                                           NOT NULL DEFAULT 'active'  COMMENT 'Certificate lifecycle status',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_csd_certificate_number (certificate_number),
    UNIQUE KEY uq_csd_fingerprint (fingerprint_sha256),
    KEY idx_csd_organization_active (organization_id, is_active),
    KEY idx_csd_valid_to (valid_to),
    KEY idx_csd_certificates_deleted_at (deleted_at),
    CONSTRAINT fk_csd_certificates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: pac_providers
-- Purpose: PAC (Proveedor Autorizado de CertificaciÃ³n) provider credentials and
--          endpoint configuration per organization. Supports multiple PAC vendors
--          with sandbox/production environments.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pac_providers (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL                     COMMENT 'Tenant organization that owns this PAC config',
    provider_name         ENUM('finkok','sw_sapien','digicel','comercio_digital','facturapi','other')
                                           NOT NULL                     COMMENT 'PAC vendor identifier',
    label                 VARCHAR(100)     NOT NULL                     COMMENT 'Friendly name, e.g. "Finkok ProducciÃ³n"',
    environment           ENUM('sandbox','production')
                                           NOT NULL DEFAULT 'sandbox'   COMMENT 'PAC environment',
    api_url               VARCHAR(500)     NOT NULL                     COMMENT 'Base URL for the PAC API endpoint',
    username_encrypted    VARCHAR(500)     NULL                         COMMENT 'Encrypted PAC account username (if applicable)',
    password_encrypted    VARCHAR(500)     NULL                         COMMENT 'Encrypted PAC account password (if applicable)',
    api_key_encrypted     VARCHAR(500)     NULL                         COMMENT 'Encrypted API key (if applicable)',
    token_encrypted       TEXT             NULL                         COMMENT 'Encrypted bearer token or JWT (if applicable)',
    is_default            TINYINT(1)       NOT NULL DEFAULT 0           COMMENT 'TRUE = default PAC for this organization',
    status                ENUM('active','inactive')
                                           NOT NULL DEFAULT 'active'    COMMENT 'PAC config status',
    last_stamp_at         TIMESTAMP        NULL                         COMMENT 'Timestamp of the most recent successful stamp via this PAC',
    last_error            TEXT             NULL                         COMMENT 'Last error message received from the PAC',
    config_json           JSON             NULL                         COMMENT 'Provider-specific extra settings (timeouts, wsdl overrides, etc.)',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_pac_providers_org_provider_env (organization_id, provider_name, environment),
    KEY idx_pac_providers_organization_id (organization_id),
    KEY idx_pac_providers_status (status),
    KEY idx_pac_providers_deleted_at (deleted_at),
    CONSTRAINT fk_pac_providers_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: webhooks
-- Purpose: Outbound webhook registrations per organization. Defines target URL,
--          HMAC signing secret, event subscriptions, and delivery parameters.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhooks (
    id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id   BIGINT UNSIGNED  NOT NULL                     COMMENT 'Tenant organization that owns this webhook',
    url               VARCHAR(2048)    NOT NULL                     COMMENT 'Target URL to POST events to',
    secret_encrypted  VARCHAR(500)     NULL                         COMMENT 'Encrypted HMAC signing secret for payload verification',
    events            JSON             NOT NULL                     COMMENT 'JSON array of event names to subscribe to, e.g. ["invoice.created","payment.received"]',
    is_active         TINYINT(1)       NOT NULL DEFAULT 1           COMMENT 'FALSE = webhook is paused and deliveries will not be attempted',
    description       TEXT             NULL                         COMMENT 'Optional human-readable description of this webhook',
    max_retries       TINYINT UNSIGNED NOT NULL DEFAULT 5           COMMENT 'Maximum number of delivery retry attempts on failure',
    timeout_seconds   TINYINT UNSIGNED NOT NULL DEFAULT 30          COMMENT 'HTTP request timeout in seconds per attempt',
    created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_webhooks_organization_id (organization_id),
    KEY idx_webhooks_is_active (is_active),
    KEY idx_webhooks_deleted_at (deleted_at),
    CONSTRAINT fk_webhooks_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: webhook_deliveries
-- Purpose: Delivery log for outbound webhooks. Records each attempt with HTTP
--          status, response body, response time, retry count, and outcome.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id                BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    webhook_id        BIGINT UNSIGNED     NOT NULL                    COMMENT 'Webhook registration this delivery belongs to',
    event_name        VARCHAR(100)        NOT NULL                    COMMENT 'Event type that triggered this delivery, e.g. "invoice.created"',
    payload           JSON                NOT NULL                    COMMENT 'Full event payload sent in the request body',
    http_status_code  SMALLINT UNSIGNED   NULL                        COMMENT 'HTTP status code returned by the target endpoint',
    response_body     TEXT                NULL                        COMMENT 'Response body from the target endpoint (truncated if large)',
    response_time_ms  INT UNSIGNED        NULL                        COMMENT 'Round-trip HTTP request time in milliseconds',
    attempt_number    TINYINT UNSIGNED    NOT NULL DEFAULT 1          COMMENT 'Which attempt this row represents (1 = first try)',
    status            ENUM('pending','success','failed','retrying','dead_letter')
                                          NOT NULL DEFAULT 'pending'  COMMENT 'Delivery outcome status',
    next_retry_at     TIMESTAMP           NULL                        COMMENT 'Scheduled time for the next retry attempt; NULL = no retry pending',
    delivered_at      TIMESTAMP           NULL                        COMMENT 'Timestamp of a successful delivery; NULL if not yet succeeded',
    created_at        TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_webhook_deliveries_webhook_id (webhook_id),
    KEY idx_webhook_deliveries_event_name (event_name),
    KEY idx_webhook_deliveries_status (status),
    KEY idx_webhook_deliveries_next_retry_at (next_retry_at),
    KEY idx_webhook_deliveries_status_created (status, created_at),
    KEY idx_webhook_deliveries_dead_letter (status, webhook_id),
    CONSTRAINT fk_webhook_deliveries_webhook FOREIGN KEY (webhook_id)
        REFERENCES webhooks (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: firerelay_nodes
-- Purpose: Registry of nodes in a FireRelay cluster (migration 130)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS firerelay_nodes (
    id              VARCHAR(64)   NOT NULL COMMENT 'Unique node identifier (e.g. node2)',
    name            VARCHAR(255)  NOT NULL DEFAULT '' COMMENT 'Human-readable name',
    api_url         VARCHAR(512)  NOT NULL COMMENT 'Base URL of the node API',
    status          ENUM('active', 'draining', 'maintenance', 'offline')
                                NOT NULL DEFAULT 'active'
                                COMMENT 'Current lifecycle state',
    client_count    INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'Last reported client count',
    device_count    INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'Last reported device count',
    cpu_percent     DECIMAL(5, 2) NULL COMMENT 'Last reported CPU usage %',
    memory_percent  DECIMAL(5, 2) NULL COMMENT 'Last reported memory usage %',
    disk_percent    DECIMAL(5, 2) NULL COMMENT 'Last reported disk usage %',
    db_size_mb      INT UNSIGNED  NULL COMMENT 'Last reported database size in MB',
    uptime_seconds  BIGINT UNSIGNED NULL COMMENT 'Last reported uptime in seconds',
    last_seen_at    DATETIME      NULL COMMENT 'Timestamp of last successful health check',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY idx_firerelay_nodes_api_url (api_url),
    KEY idx_firerelay_nodes_status (status),
    KEY idx_firerelay_nodes_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: firerelay_client_routing
-- Purpose: Maps each client_id to owning FireRelay node (migration 131)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS firerelay_client_routing (
    client_id   BIGINT UNSIGNED NOT NULL COMMENT 'The client ID',
    node_id     VARCHAR(64)     NOT NULL COMMENT 'Which node owns this client',
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (client_id),
    KEY idx_firerelay_client_routing_node (node_id),
    KEY idx_firerelay_client_routing_deleted_at (deleted_at),
    CONSTRAINT fk_firerelay_routing_node FOREIGN KEY (node_id)
        REFERENCES firerelay_nodes (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: webhook_events
-- Purpose: Inbound payment gateway webhook event log (migration 132)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
    id                  BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED   NULL                        COMMENT 'Resolved tenant org (NULL if not yet matched)',
    provider            VARCHAR(50)       NOT NULL                    COMMENT 'Gateway provider name: stripe, conekta, etc.',
    provider_event_id   VARCHAR(255)      NOT NULL                    COMMENT 'Unique event ID assigned by the provider',
    event_type          VARCHAR(100)      NOT NULL                    COMMENT 'Provider event type, e.g. payment_intent.succeeded',
    payload             JSON              NOT NULL                    COMMENT 'Full raw event payload from the provider',
    status              ENUM('received', 'processing', 'processed', 'failed', 'ignored')
                                          NOT NULL DEFAULT 'received' COMMENT 'Processing status',
    error_message       TEXT              NULL                        COMMENT 'Error details if processing failed',
    transaction_id      BIGINT UNSIGNED   NULL                        COMMENT 'Linked payment_transactions record after reconciliation',
    processed_at        TIMESTAMP         NULL                        COMMENT 'When the event was fully processed',
    created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_webhook_events_provider_event (provider, provider_event_id),
    KEY idx_webhook_events_organization_id (organization_id),
    KEY idx_webhook_events_status (status),
    KEY idx_webhook_events_event_type (event_type),
    KEY idx_webhook_events_transaction_id (transaction_id),
    KEY idx_webhook_events_created_at (created_at),
    CONSTRAINT fk_webhook_events_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_webhook_events_transaction FOREIGN KEY (transaction_id)
        REFERENCES payment_transactions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: idempotency_keys
-- Purpose: Idempotency key cache for charge requests (migration 133)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id                  BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    idempotency_key     VARCHAR(255)      NOT NULL                    COMMENT 'Client-supplied unique key for the charge request',
    organization_id     BIGINT UNSIGNED   NOT NULL                    COMMENT 'Tenant organization',
    status              ENUM('pending', 'completed', 'failed')
                                          NOT NULL DEFAULT 'pending'  COMMENT 'Processing status of the original request',
    response_code       SMALLINT UNSIGNED NOT NULL DEFAULT 200        COMMENT 'HTTP status code of the cached response',
    response_body       JSON              NOT NULL                    COMMENT 'Cached response body to return on replay',
    expires_at          TIMESTAMP         NOT NULL                    COMMENT 'Key expiry; after this time the key may be reused',
    created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_idempotency_keys_org_key (organization_id, idempotency_key),
    KEY idx_idempotency_keys_expires_at (expires_at),
    CONSTRAINT fk_idempotency_keys_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: alert_rules
-- Purpose: Configurable monitoring alert rules per organization (migration 134)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_rules (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    organization_id   BIGINT UNSIGNED NOT NULL,
    name              VARCHAR(200)    NOT NULL,
    description       TEXT            NULL,
    metric            VARCHAR(50)     NOT NULL COMMENT 'cpu_usage, memory_usage, signal_strength, latency_ms, packet_loss, uptime, if_in_octets, if_out_octets',
    operator          VARCHAR(5)      NOT NULL DEFAULT '>' COMMENT '>, >=, <, <=, ==',
    threshold         DECIMAL(10, 2)  NOT NULL,
    device_id         BIGINT UNSIGNED NULL COMMENT 'NULL = all devices',
    duration_minutes  INT UNSIGNED    NOT NULL DEFAULT 5 COMMENT 'Evaluation window in minutes',
    severity          ENUM('info', 'warning', 'major', 'critical') NOT NULL DEFAULT 'major',
    auto_create_outage BOOLEAN        NOT NULL DEFAULT FALSE,
    auto_create_ticket BOOLEAN        NOT NULL DEFAULT FALSE
      COMMENT 'When TRUE, automatically open a ticket on threshold breach',
    notification_channels JSON        NULL COMMENT '["email","sms","sse","webhook"]',
    escalation_chain_id BIGINT UNSIGNED NULL COMMENT 'Escalation chain for this rule (migration 260)',
    flap_detection_enabled TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Enable flapping detection (migration 260)',
    flap_count_threshold TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT 'State changes within window to mark flapping (migration 260)',
    flap_window_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15 COMMENT 'Flap detection window in minutes (migration 260)',
    baseline_enabled  TINYINT(1)        NOT NULL DEFAULT 0 COMMENT 'Enable dynamic/baseline thresholds (migration 260)',
    baseline_lookback_hours SMALLINT UNSIGNED NOT NULL DEFAULT 24 COMMENT 'Baseline lookback period in hours (migration 260)',
    baseline_stddev_multiplier DECIMAL(4,2) NOT NULL DEFAULT 2.00 COMMENT 'Stddev multiplier over baseline (migration 260)',
    is_enabled        BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    INDEX idx_alert_rules_org (organization_id),
    INDEX idx_alert_rules_enabled (organization_id, is_enabled),
    KEY idx_alert_rules_deleted_at (deleted_at),
    CONSTRAINT fk_alert_rules_org FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: alert_events
-- Purpose: Triggered alert event history (migration 135)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_events (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    alert_rule_id   BIGINT UNSIGNED NOT NULL,
    organization_id BIGINT UNSIGNED NOT NULL,
    device_id       BIGINT UNSIGNED NULL,
    metric          VARCHAR(50)     NOT NULL,
    current_value   DECIMAL(12, 4)  NULL,
    threshold_value DECIMAL(12, 4)  NULL,
    status          ENUM('triggered', 'acknowledged', 'resolved') NOT NULL DEFAULT 'triggered',
    acknowledged_by BIGINT UNSIGNED NULL,
    acknowledged_at TIMESTAMP       NULL,
    resolved_at     TIMESTAMP       NULL,
    escalation_step INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Current escalation level reached (migration 260)',
    escalated_at    DATETIME        NULL COMMENT 'When the alert last escalated (migration 260)',
    flapping        TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Alert is currently flap-suppressed (migration 260)',
    suppressed      TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Suppressed by correlation or maintenance window (migration 260)',
    maintenance_window_id BIGINT UNSIGNED NULL COMMENT 'Maintenance window that suppressed this alert (migration 260)',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_alert_events_org (organization_id, created_at),
    INDEX idx_alert_events_rule (alert_rule_id),
    INDEX idx_alert_events_status (organization_id, status),
    CONSTRAINT fk_alert_events_rule FOREIGN KEY (alert_rule_id)
        REFERENCES alert_rules(id) ON DELETE CASCADE,
    CONSTRAINT fk_alert_events_org FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: organization_users
-- Purpose: Pivot table linking users to organizations with per-organization
--          roles. Allows a single user to belong to multiple tenant organizations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_users (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED  NOT NULL                                    COMMENT 'Organization this membership record belongs to',
    user_id          BIGINT UNSIGNED  NOT NULL                                    COMMENT 'User who is a member of this organization',
    role             ENUM('owner','admin','manager','technician','billing','readonly')
                                      NOT NULL DEFAULT 'readonly'                 COMMENT 'User role within this specific organization',
    is_primary_org   TINYINT(1)       NOT NULL DEFAULT 0                          COMMENT 'TRUE = this is the user''s primary/home organization',
    joined_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP          COMMENT 'When the user was added to the organization',
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_users_org_user (organization_id, user_id),
    KEY idx_organization_users_user_id (user_id),
    KEY idx_organization_users_role (role),
    KEY idx_organization_users_deleted_at (deleted_at),
    CONSTRAINT fk_organization_users_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_organization_users_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: plan_addons
-- Purpose: Catalog of plan add-ons available for sale per organization (static
--          IP, extra bandwidth, equipment rental, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_addons (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED  NOT NULL                     COMMENT 'Tenant organization that offers this add-on',
    name             VARCHAR(150)     NOT NULL                     COMMENT 'Display name, e.g. "IP EstÃ¡tica", "Renta de Router"',
    description      TEXT             NULL                         COMMENT 'Detailed description shown to billing agents or on the client portal',
    addon_type       ENUM('static_ip','extra_ip_block','extra_bandwidth','equipment_rental','voip','iptv','other')
                                      NOT NULL                     COMMENT 'Category of add-on for reporting and processing logic',
    price            DECIMAL(10, 2)   NOT NULL                     COMMENT 'Base price per billing cycle',
    billing_cycle    ENUM('monthly','one_time','yearly')
                                      NOT NULL DEFAULT 'monthly'   COMMENT 'How often this add-on is charged',
    is_taxable       TINYINT(1)       NOT NULL DEFAULT 1           COMMENT 'TRUE = tax rules apply to this add-on''s price',
    status           ENUM('active','inactive')
                                      NOT NULL DEFAULT 'active'    COMMENT 'Availability status',
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_plan_addons_organization_id (organization_id),
    KEY idx_plan_addons_addon_type (addon_type),
    KEY idx_plan_addons_status (status),
    KEY idx_plan_addons_deleted_at (deleted_at),
    CONSTRAINT fk_plan_addons_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: plan_throttle_logs
-- Purpose: Audit log for FUP throttle and restore actions per contract.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_throttle_logs (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    contract_id   BIGINT UNSIGNED NOT NULL,
    action        ENUM('throttle','restore') NOT NULL,
    reason        ENUM('fup','overage','manual') NOT NULL DEFAULT 'fup',
    throttle_download_mbps INT UNSIGNED NULL,
    throttle_upload_mbps   INT UNSIGNED NULL,
    coa_sent      TINYINT(1) NOT NULL DEFAULT 0,
    coa_response  VARCHAR(200) NULL,
    notes         TEXT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_plan_throttle_logs_contract_id (contract_id),
    KEY idx_plan_throttle_logs_organization_id (organization_id),
    KEY idx_plan_throttle_logs_created_at (created_at),
    CONSTRAINT fk_plan_throttle_logs_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: plan_speed_windows
-- Purpose: Time-based speed windows for plans (e.g., off-peak unlimited).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_speed_windows (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    plan_id             BIGINT UNSIGNED NOT NULL,
    organization_id     BIGINT UNSIGNED NULL,
    label               VARCHAR(100) NOT NULL,
    day_mask            TINYINT UNSIGNED NOT NULL DEFAULT 127 COMMENT 'bitmask: bit0=Sun,...,bit6=Sat; 127=all days',
    start_time          TIME NOT NULL,
    end_time            TIME NOT NULL,
    download_speed_mbps INT UNSIGNED NOT NULL,
    upload_speed_mbps   INT UNSIGNED NOT NULL,
    priority            TINYINT UNSIGNED NOT NULL DEFAULT 10 COMMENT 'Lower number = higher priority when windows overlap',
    status              ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_plan_speed_windows_plan_id (plan_id),
    KEY idx_plan_speed_windows_organization_id (organization_id),
    KEY idx_plan_speed_windows_status (status),
    CONSTRAINT fk_plan_speed_windows_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: contract_addons
-- Purpose: Add-ons attached to a specific client contract. References the
--          plan_addons catalog and stores quantity, price, and validity window.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_addons (
    id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    contract_id    BIGINT UNSIGNED  NOT NULL                    COMMENT 'Contract this add-on is assigned to',
    plan_addon_id  BIGINT UNSIGNED  NOT NULL                    COMMENT 'Add-on catalog entry being assigned',
    quantity       INT UNSIGNED     NOT NULL DEFAULT 1          COMMENT 'Number of units contracted',
    unit_price     DECIMAL(10, 2)   NOT NULL                    COMMENT 'Agreed per-unit price (may differ from catalog price)',
    start_date     DATE             NOT NULL                    COMMENT 'Date from which the add-on is active on this contract',
    end_date       DATE             NULL                        COMMENT 'Date the add-on expires; NULL = no fixed end date',
    notes          TEXT             NULL                        COMMENT 'Free-text notes about this add-on assignment',
    status         ENUM('active','cancelled','expired')
                                    NOT NULL DEFAULT 'active'   COMMENT 'Lifecycle status of the add-on on this contract',
    created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_contract_addons_contract_id (contract_id),
    KEY idx_contract_addons_plan_addon_id (plan_addon_id),
    KEY idx_contract_addons_status (status),
    KEY idx_contract_addons_deleted_at (deleted_at),
    CONSTRAINT fk_contract_addons_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contract_addons_plan_addon FOREIGN KEY (plan_addon_id)
        REFERENCES plan_addons (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: speed_tests
-- Purpose: Speed test results (client portal, technician, automated probe, or
--          external). Records download/upload throughput, latency, jitter,
--          and packet loss for SLA correlation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS speed_tests (
    id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    client_id        BIGINT UNSIGNED   NULL                      COMMENT 'Client who initiated or is associated with this test; NULL = probe-only',
    contract_id      BIGINT UNSIGNED   NULL                      COMMENT 'Contract (service) under test; NULL = not contract-specific',
    device_id        BIGINT UNSIGNED   NULL                      COMMENT 'CPE or probe device that ran the test; NULL = client browser test',
    test_source      ENUM('client_portal','technician','automated_probe','external')
                                        NOT NULL                  COMMENT 'How the test was initiated',
    server_location  VARCHAR(150)       NULL                      COMMENT 'Test server geographic location or identifier',
    download_mbps    DECIMAL(10, 3)     NOT NULL                  COMMENT 'Measured download speed in Mbps',
    upload_mbps      DECIMAL(10, 3)     NOT NULL                  COMMENT 'Measured upload speed in Mbps',
    latency_ms       DECIMAL(8, 2)      NULL                      COMMENT 'Round-trip latency in milliseconds',
    jitter_ms        DECIMAL(8, 2)      NULL                      COMMENT 'Latency jitter in milliseconds',
    packet_loss_pct  DECIMAL(5, 2)      NULL                      COMMENT 'Packet loss percentage (0.00â€“100.00)',
    ip_address       VARCHAR(45)        NULL                      COMMENT 'Public IP address observed during the test (IPv4 or IPv6)',
    notes            TEXT               NULL                      COMMENT 'Free-text observations or technician comments',
    tested_at        TIMESTAMP          NOT NULL                  COMMENT 'When the test measurement was taken',
    created_at       TIMESTAMP          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_speed_tests_client_id (client_id),
    KEY idx_speed_tests_contract_id (contract_id),
    KEY idx_speed_tests_device_id (device_id),
    KEY idx_speed_tests_tested_at (tested_at),
    KEY idx_speed_tests_test_source (test_source),
    KEY idx_speed_tests_deleted_at (deleted_at),
    CONSTRAINT fk_speed_tests_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_speed_tests_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_speed_tests_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ticket_sla_events
-- Purpose: SLA tracking events per support ticket. Records first-response time,
--          resolution time, escalations, and breach events. Pairs with
--          sla_definitions for contracted SLA target comparison.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_sla_events (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    ticket_id           BIGINT UNSIGNED  NOT NULL                   COMMENT 'Ticket this SLA event belongs to',
    sla_definition_id   BIGINT UNSIGNED  NULL                       COMMENT 'SLA definition that set the target; NULL = no formal SLA',
    event_type          ENUM('first_response','resolution','escalation','breach_warning','breach')
                                          NOT NULL                   COMMENT 'Type of SLA milestone or event',
    target_deadline     TIMESTAMP         NULL                       COMMENT 'Calculated deadline for this SLA target; NULL = informational event',
    actual_at           TIMESTAMP         NULL                       COMMENT 'Actual timestamp when the event occurred; NULL = not yet achieved',
    is_breached         TINYINT(1)        NOT NULL DEFAULT 0         COMMENT 'TRUE = the SLA target was missed',
    breached_by_minutes INT               NULL                       COMMENT 'Minutes by which the deadline was exceeded (positive = late); NULL = not breached',
    notes               TEXT              NULL                       COMMENT 'Optional context or explanation for the event',
    created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ticket_sla_events_ticket_id (ticket_id),
    KEY idx_ticket_sla_events_sla_definition_id (sla_definition_id),
    KEY idx_ticket_sla_events_event_type (event_type),
    KEY idx_ticket_sla_events_is_breached (is_breached),
    CONSTRAINT fk_ticket_sla_events_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_sla_events_sla_definition FOREIGN KEY (sla_definition_id)
        REFERENCES sla_definitions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: sms_logs
-- Purpose: SMS and WhatsApp notification logging per organization. Complements
--          email_logs for non-email channels.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_logs (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization that sent/received this message',
    client_id            BIGINT UNSIGNED  NULL                        COMMENT 'Client associated with this message; NULL = non-client recipient',
    phone_number         VARCHAR(20)      NOT NULL                    COMMENT 'Destination or source phone number in E.164 format',
    channel              ENUM('sms','whatsapp')
                                          NOT NULL                    COMMENT 'Delivery channel',
    direction            ENUM('outbound','inbound')
                                          NOT NULL DEFAULT 'outbound' COMMENT 'Message direction relative to the platform',
    template_id          BIGINT UNSIGNED  NULL                        COMMENT 'Message template used; NULL = ad-hoc message',
    campaign_message_id  BIGINT UNSIGNED  NULL                        COMMENT 'Campaign message this send belongs to; NULL = non-campaign send',
    message_body         TEXT             NOT NULL                    COMMENT 'Full text content of the message',
    provider             VARCHAR(50)      NULL                        COMMENT 'SMS/WhatsApp provider name (e.g. twilio, infobip, messagebird)',
    provider_message_id  VARCHAR(100)     NULL                        COMMENT 'Provider-assigned message identifier for status lookups',
    status               ENUM('queued','sent','delivered','failed','undelivered')
                                          NOT NULL DEFAULT 'queued'   COMMENT 'Delivery status',
    error_code           VARCHAR(20)      NULL                        COMMENT 'Provider-specific error code on failure',
    error_message        TEXT             NULL                        COMMENT 'Human-readable error description from the provider',
    cost                 DECIMAL(8, 5)    NULL                        COMMENT 'Per-message cost charged by the provider',
    sent_at              TIMESTAMP        NULL                        COMMENT 'Timestamp when the message was submitted to the provider',
    delivered_at         TIMESTAMP        NULL                        COMMENT 'Timestamp of confirmed delivery to the handset',
    created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_sms_logs_organization_id (organization_id),
    KEY idx_sms_logs_client_id (client_id),
    KEY idx_sms_logs_status (status),
    KEY idx_sms_logs_provider_message_id (provider_message_id),
    KEY idx_sms_logs_phone_number (phone_number),
    KEY idx_sms_logs_campaign_message (campaign_message_id),
    CONSTRAINT fk_sms_logs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_sms_logs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_sms_logs_template FOREIGN KEY (template_id)
        REFERENCES message_templates (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: revenue_summary
-- Purpose: Materialized revenue summary for MRR / churn / ARPU reporting.
--          Populated by a scheduled task, not a SQL VIEW. One row per
--          organization per calendar month per currency.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_summary (
    id                       BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    organization_id          BIGINT UNSIGNED   NOT NULL                    COMMENT 'Tenant organization this summary row belongs to',
    period_date              DATE              NOT NULL                    COMMENT 'First day of the calendar month this row summarizes',
    total_mrr                DECIMAL(14, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Monthly Recurring Revenue at end of period',
    total_clients_active     INT UNSIGNED      NOT NULL DEFAULT 0          COMMENT 'Number of clients with at least one active contract',
    total_contracts_active   INT UNSIGNED      NOT NULL DEFAULT 0          COMMENT 'Total active contracts at end of period',
    new_contracts            INT UNSIGNED      NOT NULL DEFAULT 0          COMMENT 'Contracts that started during this period',
    churned_contracts        INT UNSIGNED      NOT NULL DEFAULT 0          COMMENT 'Contracts that were cancelled or expired during this period',
    arpu                     DECIMAL(10, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Average Revenue Per User = total_mrr / total_clients_active',
    total_revenue            DECIMAL(14, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Total amount invoiced during this period',
    total_collected          DECIMAL(14, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Total payments received during this period',
    total_outstanding        DECIMAL(14, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Total unpaid invoice balance at end of period',
    currency                 VARCHAR(3)        NOT NULL DEFAULT 'MXN'      COMMENT 'ISO 4217 currency code for all amounts in this row',
    calculated_at            TIMESTAMP         NOT NULL                    COMMENT 'When the scheduled task last recalculated this row',
    created_at               TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_revenue_summary_org_period_currency (organization_id, period_date, currency),
    KEY idx_revenue_summary_period_date (period_date),
    CONSTRAINT fk_revenue_summary_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: network_health_snapshots
-- Purpose: Aggregated daily device uptime and link utilization snapshots.
--          Populated by the monitoring subsystem for trending, SLA compliance,
--          and capacity planning dashboards.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS network_health_snapshots (
    id                        BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    organization_id           BIGINT UNSIGNED   NULL                    COMMENT 'Tenant organization this snapshot belongs to; NULL = single-tenant deployment',
    device_id                 BIGINT UNSIGNED   NULL                    COMMENT 'Device this snapshot is for; NULL if link-only snapshot',
    network_link_id           BIGINT UNSIGNED   NULL                    COMMENT 'Network link this snapshot is for; NULL if device-only snapshot',
    snapshot_date             DATE              NOT NULL                COMMENT 'Calendar date this snapshot covers (one row per day)',
    uptime_pct                DECIMAL(5, 2)     NULL                    COMMENT 'Device/link uptime percentage for the day (0.00â€“100.00)',
    avg_latency_ms            DECIMAL(8, 2)     NULL                    COMMENT 'Average round-trip latency in milliseconds over the day',
    max_latency_ms            DECIMAL(8, 2)     NULL                    COMMENT 'Peak round-trip latency in milliseconds over the day',
    avg_throughput_in_mbps    DECIMAL(10, 3)    NULL                    COMMENT 'Average inbound throughput in Mbps over the day',
    avg_throughput_out_mbps   DECIMAL(10, 3)    NULL                    COMMENT 'Average outbound throughput in Mbps over the day',
    peak_throughput_in_mbps   DECIMAL(10, 3)    NULL                    COMMENT 'Peak inbound throughput in Mbps observed during the day',
    peak_throughput_out_mbps  DECIMAL(10, 3)    NULL                    COMMENT 'Peak outbound throughput in Mbps observed during the day',
    packet_loss_pct           DECIMAL(5, 2)     NULL                    COMMENT 'Average packet loss percentage for the day (0.00â€“100.00)',
    total_downtime_minutes    INT UNSIGNED      NOT NULL DEFAULT 0      COMMENT 'Total minutes of detected downtime during the day',
    created_at                TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_network_health_organization_id (organization_id),
    KEY idx_network_health_device_date (device_id, snapshot_date),
    KEY idx_network_health_link_date (network_link_id, snapshot_date),
    KEY idx_network_health_snapshot_date (snapshot_date),
    CONSTRAINT fk_network_health_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_network_health_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_network_health_link FOREIGN KEY (network_link_id)
        REFERENCES network_links (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: cfdi_cancellations
-- Purpose: SAT CFDI cancellation audit trail. Records every cancellation request
--          including reason code, replacement UUID, PAC response, and acuse XML.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cfdi_cancellations (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    cfdi_document_id      BIGINT UNSIGNED  NOT NULL                    COMMENT 'The CFDI document being cancelled',
    organization_id       BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization that issued the CFDI',
    uuid                  CHAR(36)         NOT NULL                    COMMENT 'UUID (folio fiscal) of the CFDI being cancelled',
    motivo                ENUM('01','02','03','04')
                                           NOT NULL                    COMMENT 'SAT cancellation reason: 01=CFDI con errores con relaciÃ³n, 02=CFDI con errores sin relaciÃ³n, 03=No se llevÃ³ a cabo la operaciÃ³n, 04=OperaciÃ³n nominativa relacionada en CFDI global',
    folio_sustitucion     CHAR(36)         NULL                        COMMENT 'UUID of the replacement CFDI; required when motivo=''01''',
    cancellation_status   ENUM('pending','accepted','rejected','cancelled_by_timeout')
                                           NOT NULL DEFAULT 'pending'  COMMENT 'SAT/PAC cancellation processing status',
    requested_at          TIMESTAMP        NOT NULL                    COMMENT 'Timestamp when the cancellation was submitted to the PAC/SAT',
    responded_at          TIMESTAMP        NULL                        COMMENT 'Timestamp when the SAT/PAC returned a final status',
    acuse_xml             LONGTEXT         NULL                        COMMENT 'Raw acuse (acknowledgement) XML returned by the SAT â€” required for fiscal records',
    acuse_fecha           DATETIME         NULL                        COMMENT 'FechaCancelacion from the SAT acuse XML',
    pac_provider_id       BIGINT UNSIGNED  NULL                        COMMENT 'PAC provider used to submit the cancellation; NULL if submitted directly',
    error_message         TEXT             NULL                        COMMENT 'Error description if the cancellation was rejected or failed',
    requested_by_user_id  BIGINT UNSIGNED  NULL                        COMMENT 'User who requested the cancellation; NULL = system-initiated',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_cancellations_uuid (uuid),
    KEY idx_cfdi_cancellations_cfdi_document_id (cfdi_document_id),
    KEY idx_cfdi_cancellations_organization_id (organization_id),
    KEY idx_cfdi_cancellations_status (cancellation_status),
    CONSTRAINT fk_cfdi_cancellations_cfdi_document FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_cancellations_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_cancellations_pac_provider FOREIGN KEY (pac_provider_id)
        REFERENCES pac_providers (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_cancellations_user FOREIGN KEY (requested_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: default roles and permissions (migration 119)
-- Purpose: Inserts the five built-in system roles (admin, billing, support,
--          technician, readonly) and all granular permission slugs required
--          for a functioning RBAC installation.  role_permissions rows map
--          each role to the permissions appropriate for its scope.
--          Uses INSERT IGNORE â€” safe to re-run.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO roles (name, description, is_system) VALUES
    ('admin',      'Full system access â€” can manage all resources and settings', TRUE),
    ('billing',    'Billing module access â€” invoices, payments, plans, and subscriptions', TRUE),
    ('support',    'Support access â€” clients, tickets, and related communications', TRUE),
    ('technician', 'Field / NOC technician â€” devices, jobs, network, and inventory', TRUE),
    ('readonly',   'Read-only observer â€” can view all resources but cannot modify anything', TRUE);

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('clients.view',         'View client list and profiles',          'clients'),
    ('clients.create',       'Create new clients',                     'clients'),
    ('clients.update',       'Edit existing client records',           'clients'),
    ('clients.delete',       'Delete or deactivate clients',           'clients'),
    ('contracts.view',       'View service contracts',                 'contracts'),
    ('contracts.create',     'Create new service contracts',           'contracts'),
    ('contracts.update',     'Modify existing contracts',              'contracts'),
    ('contracts.delete',     'Cancel or delete contracts',             'contracts'),
    ('invoices.view',        'View invoices',                          'billing'),
    ('invoices.create',      'Generate new invoices',                  'billing'),
    ('invoices.update',      'Edit draft invoices',                    'billing'),
    ('invoices.delete',      'Void or delete invoices',                'billing'),
    ('payments.view',        'View payment records',                   'billing'),
    ('payments.create',      'Record new payments',                    'billing'),
    ('payments.update',      'Edit payment records',                   'billing'),
    ('payments.delete',      'Delete payment records',                 'billing'),
    ('tickets.view',         'View support tickets',                   'support'),
    ('tickets.create',       'Open new support tickets',               'support'),
    ('tickets.update',       'Update and respond to tickets',          'support'),
    ('tickets.delete',       'Delete tickets',                         'support'),
    ('devices.view',         'View network devices',                   'network'),
    ('devices.create',       'Add new devices',                        'network'),
    ('devices.update',       'Edit device configuration',              'network'),
    ('devices.delete',       'Remove devices',                         'network'),
    ('plans.view',           'View service plans',                     'billing'),
    ('plans.create',         'Create new service plans',               'billing'),
    ('plans.update',         'Edit existing plans',                    'billing'),
    ('plans.delete',         'Delete plans',                           'billing'),
    ('jobs.view',            'View work orders',                       'jobs'),
    ('jobs.create',          'Create new work orders',                 'jobs'),
    ('jobs.update',          'Update work orders',                     'jobs'),
    ('jobs.delete',          'Delete work orders',                     'jobs'),
    ('expenses.view',        'View expense records',                   'expenses'),
    ('expenses.create',      'Submit new expenses',                    'expenses'),
    ('expenses.update',      'Edit expense records',                   'expenses'),
    ('expenses.approve',     'Approve or reject submitted expenses',   'expenses'),
    ('reports.view',         'Access reports and dashboards',          'reports'),
    ('reports.export',       'Export report data',                     'reports'),
    ('settings.view',        'View application settings',              'settings'),
    ('settings.update',      'Modify application settings',            'settings'),
    ('users.view',           'View user accounts',                     'users'),
    ('users.create',         'Create new user accounts',               'users'),
    ('users.update',         'Edit user accounts',                     'users'),
    ('users.delete',         'Delete or deactivate user accounts',     'users'),
    ('inventory.view',       'View inventory items and stock',         'inventory'),
    ('inventory.create',     'Add inventory items',                    'inventory'),
    ('inventory.update',     'Edit inventory items',                   'inventory'),
    ('inventory.transfer',   'Transfer stock between warehouses',      'inventory'),
    ('network.view',         'View network topology and resources',    'network'),
    ('network.create',       'Add network resources (NAS, IP pools)',  'network'),
    ('network.update',       'Edit network resources',                 'network'),
    ('network.delete',       'Remove network resources',               'network'),
    ('audit_logs.view',      'View the audit log',                     'audit'),
    ('organizations.view',   'View organization profile',              'organizations'),
    ('organizations.update', 'Edit organization settings',             'organizations');

-- admin gets every permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON TRUE WHERE r.name = 'admin';

-- billing role
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
ON p.name IN (
    'invoices.view','invoices.create','invoices.update','invoices.delete',
    'payments.view','payments.create','payments.update','payments.delete',
    'plans.view','plans.create','plans.update','plans.delete',
    'clients.view','contracts.view',
    'reports.view','reports.export',
    'settings.view','expenses.view','expenses.approve'
) WHERE r.name = 'billing';

-- support role
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
ON p.name IN (
    'clients.view','clients.create','clients.update',
    'contracts.view',
    'tickets.view','tickets.create','tickets.update','tickets.delete',
    'reports.view'
) WHERE r.name = 'support';

-- technician role
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
ON p.name IN (
    'devices.view','devices.create','devices.update','devices.delete',
    'jobs.view','jobs.create','jobs.update','jobs.delete',
    'network.view','network.create','network.update','network.delete',
    'inventory.view','inventory.create','inventory.update','inventory.transfer',
    'clients.view','contracts.view',
    'expenses.view','expenses.create'
) WHERE r.name = 'technician';

-- readonly gets every *.view and *.export permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
ON (p.name LIKE '%.view' OR p.name LIKE '%.export')
WHERE r.name = 'readonly';

-- ---------------------------------------------------------------------------
-- Seed: default application settings (migration 120)
-- Purpose: Populates the settings key-value store with sensible defaults for
--          a new installation.  Uses INSERT IGNORE â€” safe to re-run; existing
--          administrator-configured values are never overwritten.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES
    ('default_currency',             'USD',        'ISO 4217 currency code used as system default for new documents'),
    ('default_tax_rate',             '0.00',       'Default tax rate percentage applied to new invoices when no tax_rate_id is selected'),
    ('invoice_prefix',               'INV-',       'Prefix prepended to auto-generated invoice numbers'),
    ('quote_prefix',                 'QUT-',       'Prefix prepended to auto-generated quote numbers'),
    ('credit_note_prefix',           'CN-',        'Prefix prepended to auto-generated credit note numbers'),
    ('smtp_host',                    '',           'SMTP server hostname for outbound email'),
    ('smtp_port',                    '587',        'SMTP server port (25, 465, or 587)'),
    ('smtp_encryption',              'tls',        'SMTP encryption method: tls, ssl, or none'),
    ('smtp_username',                '',           'SMTP authentication username'),
    ('smtp_password',                '',           'SMTP authentication password (stored encrypted at app layer)'),
    ('snmp_default_poll_interval',   '300',        'Default SNMP polling interval in seconds'),
    ('snmp_default_community',       'public',     'Default SNMP community string for read-only access'),
    ('company_name',                 '',           'ISP company name shown on invoices and reports'),
    ('company_email',                '',           'Primary contact email address for the ISP'),
    ('company_phone',                '',           'Primary contact phone number for the ISP'),
    ('timezone',                     'UTC',        'Default timezone for date/time display (IANA timezone name)'),
    ('date_format',                  'YYYY-MM-DD', 'Display format for dates throughout the UI'),
    ('pagination_per_page',          '25',         'Default number of rows per page in list views'),
    ('session_timeout_minutes',      '60',         'Idle session timeout in minutes before the user is logged out'),
    ('max_login_attempts',           '5',          'Maximum consecutive failed login attempts before account lockout'),
    ('password_min_length',          '8',          'Minimum required password length for user accounts'),
    ('auto_suspend_enabled',         'false',      'Enable automatic contract suspension for overdue invoices'),
    ('auto_suspend_days_overdue',    '30',         'Number of days past due before a contract is automatically suspended'),
    ('auto_invoice_enabled',         'false',      'Enable automatic invoice generation from billing periods'),
    ('auto_invoice_days_before_due', '7',          'Generate invoices this many days before the billing period end date');

-- ---------------------------------------------------------------------------
-- Seed: default tax rates (migration 121)
-- Purpose: Inserts globally applicable default rates (organization_id = NULL)
--          covering the most common tax scenarios for a multi-country ISP.
--          Uses WHERE NOT EXISTS because tax_rates has no UNIQUE constraint
--          on name â€” fully idempotent on re-runs.
-- ---------------------------------------------------------------------------
INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT NULL, 'Tax Exempt', 0.0000,
       'Zero-rate â€” applies to tax-exempt services or clients', FALSE, 'active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE name = 'Tax Exempt' AND organization_id IS NULL);

INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT NULL, 'Standard Tax 8%', 0.0800,
       'Generic 8% sales / service tax for regions without a specific rate configured', FALSE, 'active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE name = 'Standard Tax 8%' AND organization_id IS NULL);

INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT NULL, 'IVA 16% (Mexico)', 0.1600,
       'Mexican IVA (Impuesto al Valor Agregado) 16% â€” standard rate for most ISP services in Mexico', FALSE, 'active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE name = 'IVA 16% (Mexico)' AND organization_id IS NULL);

INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT NULL, 'GST 5%', 0.0500,
       'Canadian GST (Goods and Services Tax) 5%', FALSE, 'active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE name = 'GST 5%' AND organization_id IS NULL);

-- ---------------------------------------------------------------------------
-- Seed: default suspension rule (migration 122)
-- Purpose: Seeds a default auto-suspend rule for the first organization.
--          organization_id IS NOT NULL so this seed targets org id = 1.
--          Uses WHERE NOT EXISTS for full idempotency.
-- ---------------------------------------------------------------------------
INSERT INTO suspension_rules
    (organization_id, name, days_past_due, grace_period_days, action, is_active)
SELECT 1,
       'Default: auto-suspend contracts 30 days past due with 5-day grace period',
       30, 5, 'auto_suspend', TRUE
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = 1)
  AND NOT EXISTS (
      SELECT 1 FROM suspension_rules
      WHERE  organization_id = 1
        AND  name = 'Default: auto-suspend contracts 30 days past due with 5-day grace period'
  );

-- ---------------------------------------------------------------------------
-- Seed: core automation scheduled tasks (migration 123)
-- Purpose: Inserts the five system-level automation jobs.  Uses INSERT IGNORE
--          â€” safe to re-run via the UNIQUE KEY on (organization_id, task_name).
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL, 'auto_generate_invoices', 'generate_invoice',
     'App\\Tasks\\Billing\\AutoGenerateInvoicesTask',
     'Auto-generates invoices from billing_periods for contracts approaching their next billing date.',
     '0 1 * * *', 'high', 3, 300, TRUE),

    (NULL, 'auto_suspend_overdue', 'auto_suspend',
     'App\\Tasks\\Billing\\AutoSuspendOverdueTask',
     'Suspends contracts that exceed the days-past-due threshold defined in suspension_rules.',
     '0 6 * * *', 'high', 3, 300, TRUE),

    (NULL, 'radius_sync', 'radius_sync',
     'App\\Tasks\\Network\\RadiusSyncTask',
     'Synchronises RADIUS subscriber accounts with the current state of active contracts.',
     '*/5 * * * *', 'normal', 3, 120, TRUE),

    (NULL, 'populate_revenue_summary', 'usage_rollup',
     'App\\Tasks\\Reporting\\PopulateRevenueSummaryTask',
     'Recalculates MRR, churn rate, and ARPU and writes the results into the revenue_summary materialized table.',
     '0 2 1 * *', 'normal', 3, 600, TRUE),

    (NULL, 'populate_network_health_snapshots', 'other',
     'App\\Tasks\\Network\\PopulateNetworkHealthSnapshotsTask',
     'Aggregates daily device uptime, latency, and link utilization into the network_health_snapshots table.',
     '0 4 * * *', 'normal', 3, 600, TRUE);

-- ---------------------------------------------------------------------------
-- Seed: alert evaluation scheduled task (migration 138)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES
    (NULL,
     'alert_evaluation',
     'Evaluate monitoring alert rules against current SNMP metrics',
     '*/5 * * * *',
     TRUE,
     'critical');

-- ---------------------------------------------------------------------------
-- Seed: recurring charge scheduled task (migration 139)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES
    (NULL,
     'process_recurring_charges',
     'Auto-charge active recurring payment profiles with pending invoices',
     '0 7 * * *',
     TRUE,
     'high');

-- ---------------------------------------------------------------------------
-- Seed: data retention scheduled task (migration 145)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (task_name, cron_expression, description, is_enabled, priority)
VALUES
    ('data_retention',
     '0 3 * * *',
     'Purge old audit logs, alert events, webhook deliveries, and expired idempotency keys',
     TRUE,
     'critical');

-- ---------------------------------------------------------------------------
-- Seed: payment retry scheduled task (migration 154)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (task_name, cron_expression, description, is_enabled, priority, organization_id)
VALUES
    ('retry_failed_charges',
     '0 * * * *',
     'Retry failed payment charges (up to 3 attempts over 72 hours with exponential backoff)',
     TRUE,
     5,
     NULL);

-- ---------------------------------------------------------------------------
-- Seed: billing cycle orchestrator scheduled task (migration 155)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'billing_cycle',
     'generate_invoice',
     'Full automated billing cycle: generate invoices â†’ email clients â†’ send suspension warnings â†’ suspend overdue contracts.',
     '0 2 * * *',
     'high',
     3,
     600,
     TRUE);

-- ---------------------------------------------------------------------------
-- Seed: database backup scheduled task (migration 156)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'database_backup',
     'maintenance',
     'Daily database backup: mysqldump â†’ gzip â†’ local storage/backups/ + upload to S3/B2 cloud storage. Retains last 7 local copies.',
     '0 3 * * *',
     'normal',
     2,
     1800,
     TRUE);

-- ---------------------------------------------------------------------------
-- Seed: SMS queue processor scheduled task (M5.3)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'sms_send',
     'notification',
     'Drain the SMS outbox: send queued sms_logs rows via the configured provider (Twilio or generic HTTP).',
     '* * * * *',
     'high',
     3,
     60,
     TRUE);

-- ---------------------------------------------------------------------------
-- Seed: RouterOS config backup pull scheduled task (migration 158)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'config_backup_pull',
     'maintenance',
     'Nightly RouterOS config backup pull: for each device with a firerelay_node_id and ip_address, sends a config.backup command via the FireRelay tunnel and stores the result in device_config_backups. Skips unchanged configs (same SHA-256 checksum).',
     '0 2 * * *',
     'normal',
     2,
     3600,
     TRUE);

-- ---------------------------------------------------------------------------
-- Seed: Webhook retry processor scheduled task (migration 162)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'webhook_retry',
     'webhook_retry',
     'Process due webhook retry deliveries â€” picks up retrying rows whose next_retry_at <= NOW(), makes one HTTP attempt per row, reschedules or dead-letters based on attempt count.',
     '*/5 * * * *',
     'normal',
     1,
     120,
     TRUE);

-- ---------------------------------------------------------------------------
-- Seed: quarterly_dr_drill scheduled task (migration 164)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'quarterly_dr_drill',
     'maintenance',
     'Quarterly automated DR drill: take a backup, verify size, run Phase-4 referential-integrity and financial-consistency checks, record pass/fail in dr_drill_logs. Phases 2-3 (drop + restore) remain manual per docs/dr-drill.md.',
     '0 2 1 1,4,7,10 *',   -- 02:00 on 1 Jan / 1 Apr / 1 Jul / 1 Oct
     'normal',
     1,
     3600,
     TRUE);

-- ---------------------------------------------------------------------------
-- ALTER: add currency to expenses (migration 124)
-- Purpose: Idempotent guard â€” adds expenses.currency only if migration 051
--          has not already applied it.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _schema_add_expenses_currency;

DELIMITER $$
CREATE PROCEDURE _schema_add_expenses_currency()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'expenses'
          AND  COLUMN_NAME  = 'currency'
    ) THEN
        ALTER TABLE expenses
            ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD'
            COMMENT 'ISO 4217 currency code' AFTER amount;
    END IF;
END$$
DELIMITER ;
CALL _schema_add_expenses_currency();
DROP PROCEDURE IF EXISTS _schema_add_expenses_currency;

-- ---------------------------------------------------------------------------
-- ALTER: add tax_rate_id to line-item tables (migration 125)
-- Purpose: Adds a per-line-item tax rate override FK column to invoice_items,
--          quote_items, and credit_note_items.  NULL = inherit from parent
--          document.  Wrapped in a procedure for safe re-runs.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _schema_add_tax_rate_id_line_items;

DELIMITER $$
CREATE PROCEDURE _schema_add_tax_rate_id_line_items()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'invoice_items'
          AND  COLUMN_NAME  = 'tax_rate_id'
    ) THEN
        ALTER TABLE invoice_items
            ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
            COMMENT 'Per-line-item tax rate override; NULL = inherit from parent invoice'
            AFTER unit_price,
            ADD KEY idx_invoice_items_tax_rate_id (tax_rate_id),
            ADD CONSTRAINT fk_invoice_items_tax_rate FOREIGN KEY (tax_rate_id)
                REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'quote_items'
          AND  COLUMN_NAME  = 'tax_rate_id'
    ) THEN
        ALTER TABLE quote_items
            ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
            COMMENT 'Per-line-item tax rate override; NULL = inherit from parent quote'
            AFTER unit_price,
            ADD KEY idx_quote_items_tax_rate_id (tax_rate_id),
            ADD CONSTRAINT fk_quote_items_tax_rate FOREIGN KEY (tax_rate_id)
                REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'credit_note_items'
          AND  COLUMN_NAME  = 'tax_rate_id'
    ) THEN
        ALTER TABLE credit_note_items
            ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL
            COMMENT 'Per-line-item tax rate override; NULL = inherit from parent credit note'
            AFTER unit_price,
            ADD KEY idx_credit_note_items_tax_rate_id (tax_rate_id),
            ADD CONSTRAINT fk_credit_note_items_tax_rate FOREIGN KEY (tax_rate_id)
                REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$
DELIMITER ;
CALL _schema_add_tax_rate_id_line_items();
DROP PROCEDURE IF EXISTS _schema_add_tax_rate_id_line_items;

-- ---------------------------------------------------------------------------
-- Triggers: payment allocation balance guards (migration 126)
-- Purpose: Prevent over-allocation of a payment and over-application to an
--          invoice at the database level.
-- ---------------------------------------------------------------------------
DELIMITER $$

DROP TRIGGER IF EXISTS trg_payment_alloc_payment_bi$$
CREATE TRIGGER trg_payment_alloc_payment_bi
BEFORE INSERT ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_payment_total DECIMAL(10,2);
    DECLARE v_already_alloc DECIMAL(10,2);
    SELECT amount INTO v_payment_total FROM payments WHERE id = NEW.payment_id;
    SELECT COALESCE(SUM(amount),0) INTO v_already_alloc
    FROM payment_allocations WHERE payment_id = NEW.payment_id;
    IF v_already_alloc + NEW.amount > v_payment_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed total payment amount';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_payment_alloc_payment_bu$$
CREATE TRIGGER trg_payment_alloc_payment_bu
BEFORE UPDATE ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_payment_total DECIMAL(10,2);
    DECLARE v_already_alloc DECIMAL(10,2);
    SELECT amount INTO v_payment_total FROM payments WHERE id = NEW.payment_id;
    SELECT COALESCE(SUM(amount),0) INTO v_already_alloc
    FROM payment_allocations WHERE payment_id = NEW.payment_id AND id != OLD.id;
    IF v_already_alloc + NEW.amount > v_payment_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed total payment amount';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_payment_alloc_invoice_bi$$
CREATE TRIGGER trg_payment_alloc_invoice_bi
BEFORE INSERT ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total DECIMAL(10,2);
    DECLARE v_already_alloc DECIMAL(10,2);
    SELECT total INTO v_invoice_total FROM invoices WHERE id = NEW.invoice_id;
    SELECT COALESCE(SUM(amount),0) INTO v_already_alloc
    FROM payment_allocations WHERE invoice_id = NEW.invoice_id;
    IF v_already_alloc + NEW.amount > v_invoice_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed invoice total';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_payment_alloc_invoice_bu$$
CREATE TRIGGER trg_payment_alloc_invoice_bu
BEFORE UPDATE ON payment_allocations
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total DECIMAL(10,2);
    DECLARE v_already_alloc DECIMAL(10,2);
    SELECT total INTO v_invoice_total FROM invoices WHERE id = NEW.invoice_id;
    SELECT COALESCE(SUM(amount),0) INTO v_already_alloc
    FROM payment_allocations WHERE invoice_id = NEW.invoice_id AND id != OLD.id;
    IF v_already_alloc + NEW.amount > v_invoice_total THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Payment allocation would exceed invoice total';
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- Trigger: inventory stock negative guard (migration 127)
-- Purpose: Prevent inventory_stock.quantity from going below zero.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_inventory_stock_negative_bu$$
CREATE TRIGGER trg_inventory_stock_negative_bu
BEFORE UPDATE ON inventory_stock
FOR EACH ROW
BEGIN
    IF NEW.quantity < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Inventory stock quantity cannot be negative';
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- Trigger: PPPoE contract RADIUS consistency (migration 128)
-- Purpose: Require at least one RADIUS account before activating a PPPoE
--          or PPPoE-dual contract.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_contracts_radius_consistency_bu$$
CREATE TRIGGER trg_contracts_radius_consistency_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    DECLARE v_radius_count INT;
    IF NEW.status = 'active'
       AND OLD.status != 'active'
       AND NEW.connection_type IN ('pppoe', 'pppoe_dual')
    THEN
        SELECT COUNT(*) INTO v_radius_count FROM radius WHERE contract_id = NEW.id;
        IF v_radius_count = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'PPPoE/PPPoE-dual contracts require at least one RADIUS account before activation';
        END IF;
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Triggers: credit note invoice total guard (migration 146)
-- Purpose: Prevents credit note total from exceeding the linked invoice total.
-- ---------------------------------------------------------------------------

DELIMITER $$

DROP TRIGGER IF EXISTS trg_credit_note_invoice_cap_bi$$
CREATE TRIGGER trg_credit_note_invoice_cap_bi
BEFORE INSERT ON credit_notes
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total   DECIMAL(10, 2);
    DECLARE v_already_credited DECIMAL(10, 2);

    IF NEW.invoice_id IS NOT NULL AND NEW.status != 'cancelled' THEN
        SELECT total INTO v_invoice_total
        FROM   invoices
        WHERE  id = NEW.invoice_id;

        SELECT COALESCE(SUM(total), 0) INTO v_already_credited
        FROM   credit_notes
        WHERE  invoice_id = NEW.invoice_id
          AND  status     != 'cancelled';

        IF v_already_credited + NEW.total > v_invoice_total THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Credit note total would exceed the linked invoice total';
        END IF;
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_credit_note_invoice_cap_bu$$
CREATE TRIGGER trg_credit_note_invoice_cap_bu
BEFORE UPDATE ON credit_notes
FOR EACH ROW
BEGIN
    DECLARE v_invoice_total   DECIMAL(10, 2);
    DECLARE v_already_credited DECIMAL(10, 2);

    IF NEW.invoice_id IS NOT NULL AND NEW.status != 'cancelled' THEN
        SELECT total INTO v_invoice_total
        FROM   invoices
        WHERE  id = NEW.invoice_id;

        SELECT COALESCE(SUM(total), 0) INTO v_already_credited
        FROM   credit_notes
        WHERE  invoice_id = NEW.invoice_id
          AND  status     != 'cancelled'
          AND  id         != OLD.id;

        IF v_already_credited + NEW.total > v_invoice_total THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Credit note total would exceed the linked invoice total';
        END IF;
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Triggers: audit log immutability (migration 147)
-- Purpose: Prevents modification or deletion of audit log records.
-- ---------------------------------------------------------------------------

DELIMITER $$

DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bu$$
CREATE TRIGGER trg_audit_logs_immutable_bu
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Audit logs are immutable and cannot be updated';
END$$

DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bd$$
CREATE TRIGGER trg_audit_logs_immutable_bd
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Audit logs are immutable and cannot be deleted';
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Triggers: CFDI document immutability (migration 148)
-- Purpose: Prevents modification of stamped (vigente) CFDI documents.
-- ---------------------------------------------------------------------------

DELIMITER $$

DROP TRIGGER IF EXISTS trg_cfdi_documents_immutable_bu$$
CREATE TRIGGER trg_cfdi_documents_immutable_bu
BEFORE UPDATE ON cfdi_documents
FOR EACH ROW
BEGIN
    IF OLD.sat_status = 'vigente' THEN
        IF NEW.subtotal           != OLD.subtotal
        OR NEW.total_impuestos    != OLD.total_impuestos
        OR NEW.total              != OLD.total
        OR NEW.tipo_comprobante   != OLD.tipo_comprobante
        OR NEW.uso_cfdi           != OLD.uso_cfdi
        OR (NEW.metodo_pago IS NULL) != (OLD.metodo_pago IS NULL)
        OR COALESCE(NEW.metodo_pago, '') != COALESCE(OLD.metodo_pago, '')
        OR (NEW.forma_pago IS NULL) != (OLD.forma_pago IS NULL)
        OR COALESCE(NEW.forma_pago, '') != COALESCE(OLD.forma_pago, '')
        OR NEW.moneda             != OLD.moneda
        OR COALESCE(NEW.receptor_rfc, '')    != COALESCE(OLD.receptor_rfc, '')
        OR COALESCE(NEW.receptor_nombre, '') != COALESCE(OLD.receptor_nombre, '')
        OR COALESCE(NEW.uuid, '')            != COALESCE(OLD.uuid, '')
        OR (NEW.xml_content IS NULL) != (OLD.xml_content IS NULL)
        OR COALESCE(NEW.xml_content, '') != COALESCE(OLD.xml_content, '')
        OR (NEW.signed_xml IS NULL) != (OLD.signed_xml IS NULL)
        OR COALESCE(NEW.signed_xml, '') != COALESCE(OLD.signed_xml, '')
        THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Stamped CFDI documents (vigente) cannot be modified; use the cancellation flow';
        END IF;
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Triggers: contract status FSM (migration 149)
-- Purpose: Enforces valid contract status transitions.
--          pending â†’ active | cancelled
--          active  â†’ expired | cancelled
--          expired, cancelled â†’ (terminal)
-- ---------------------------------------------------------------------------

DELIMITER $$

DROP TRIGGER IF EXISTS trg_contracts_status_fsm_bu$$
CREATE TRIGGER trg_contracts_status_fsm_bu
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    IF NEW.status != OLD.status THEN
        IF NOT (
               (OLD.status = 'pending'    AND NEW.status IN ('active', 'cancelled'))
            OR (OLD.status = 'active'     AND NEW.status IN ('expired', 'cancelled', 'suspended', 'terminated'))
            OR (OLD.status = 'suspended'  AND NEW.status IN ('active', 'cancelled', 'terminated'))
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Invalid contract status transition';
        END IF;
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Triggers: outage temporal logic (migration 150)
-- Purpose: Ensures outage resolved_at is always after started_at when set.
-- ---------------------------------------------------------------------------

DELIMITER $$

DROP TRIGGER IF EXISTS trg_outages_temporal_bi$$
CREATE TRIGGER trg_outages_temporal_bi
BEFORE INSERT ON outages
FOR EACH ROW
BEGIN
    IF NEW.resolved_at IS NOT NULL AND NEW.resolved_at <= NEW.started_at THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Outage resolved_at must be after started_at';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_outages_temporal_bu$$
CREATE TRIGGER trg_outages_temporal_bu
BEFORE UPDATE ON outages
FOR EACH ROW
BEGIN
    IF NEW.resolved_at IS NOT NULL AND NEW.resolved_at <= NEW.started_at THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Outage resolved_at must be after started_at';
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Indexes: composite indexes for common query patterns (migration 129)
-- Purpose: Performance indexes for billing, network, and reporting queries.
--          Each index is guarded via a stored procedure for safe re-runs.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _schema_add_composite_indexes;

DELIMITER $$
CREATE PROCEDURE _schema_add_composite_indexes()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices'
          AND INDEX_NAME='idx_invoices_currency_status'
    ) THEN
        CREATE INDEX idx_invoices_currency_status ON invoices (currency, status);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions'
          AND INDEX_NAME='idx_payment_transactions_gateway_id_status'
    ) THEN
        CREATE INDEX idx_payment_transactions_gateway_id_status
            ON payment_transactions (payment_gateway_id, gateway_status);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='expenses'
          AND INDEX_NAME='idx_expenses_currency'
    ) THEN
        CREATE INDEX idx_expenses_currency ON expenses (currency);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contracts'
          AND INDEX_NAME='idx_contracts_client_facturar'
    ) THEN
        CREATE INDEX idx_contracts_client_facturar ON contracts (client_id, facturar);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='suspension_logs'
          AND INDEX_NAME='idx_suspension_logs_contract_created'
    ) THEN
        CREATE INDEX idx_suspension_logs_contract_created
            ON suspension_logs (contract_id, created_at);
    END IF;
END$$
DELIMITER ;
CALL _schema_add_composite_indexes();
DROP PROCEDURE IF EXISTS _schema_add_composite_indexes;

-- ---------------------------------------------------------------------------
-- Tables: organization_sso_configs, organization_sso_group_mappings,
--         sso_auth_states  (migration 165 â€” P2.1 SSO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_sso_configs (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED NOT NULL                     COMMENT 'Owning tenant organization',
    provider_type         ENUM('saml', 'oidc') NOT NULL                COMMENT 'SSO protocol',
    is_enabled            TINYINT(1) NOT NULL DEFAULT 0,
    saml_entity_id        VARCHAR(500) NULL,
    saml_sso_url          VARCHAR(500) NULL,
    saml_slo_url          VARCHAR(500) NULL,
    saml_x509_cert        TEXT         NULL,
    saml_sign_requests    TINYINT(1) NOT NULL DEFAULT 0,
    saml_sp_private_key   TEXT         NULL                            COMMENT 'AES-256-GCM encrypted SP private key',
    oidc_issuer           VARCHAR(500) NULL,
    oidc_client_id        VARCHAR(255) NULL,
    oidc_client_secret    TEXT         NULL                            COMMENT 'AES-256-GCM encrypted client secret',
    oidc_scopes           VARCHAR(500) NULL DEFAULT 'openid profile email',
    attribute_mapping     JSON         NULL,
    idp_group_attribute   VARCHAR(255) NULL DEFAULT 'groups',
    auto_provision        TINYINT(1) NOT NULL DEFAULT 1,
    default_role          ENUM('admin','manager','technician','billing','readonly') NOT NULL DEFAULT 'readonly',
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_org_sso_config_org_type (organization_id, provider_type),
    KEY idx_sso_config_org_id (organization_id),
    CONSTRAINT fk_sso_config_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organization_sso_group_mappings (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sso_config_id         BIGINT UNSIGNED NOT NULL,
    idp_group             VARCHAR(255) NOT NULL,
    fireisp_role          ENUM('admin','manager','technician','billing','readonly') NOT NULL,
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_group_mapping_config_group (sso_config_id, idp_group),
    KEY idx_group_mapping_config_id (sso_config_id),
    CONSTRAINT fk_group_mapping_config FOREIGN KEY (sso_config_id)
        REFERENCES organization_sso_configs (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sso_auth_states (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    state                 VARCHAR(64) NOT NULL,
    nonce                 VARCHAR(64) NOT NULL,
    organization_id       BIGINT UNSIGNED NOT NULL,
    redirect_to           VARCHAR(2000) NULL,
    expires_at            DATETIME NOT NULL,
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sso_state (state),
    KEY idx_sso_state_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- Per-tenant resource quotas  (migration 166 â€” P2.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_quotas (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL,
    max_clients           INT UNSIGNED     NULL     COMMENT 'Max active clients; NULL = unlimited',
    max_devices           INT UNSIGNED     NULL     COMMENT 'Max active devices; NULL = unlimited',
    max_storage_mb        INT UNSIGNED     NULL     COMMENT 'Max total file storage in MB; NULL = unlimited',
    max_scheduled_tasks   INT UNSIGNED     NULL     COMMENT 'Max org-scoped scheduled tasks; NULL = unlimited',
    max_ai_tokens_month   INT UNSIGNED     NULL     COMMENT 'Max AI tokens consumed per calendar month; NULL = unlimited',
    ai_cost_month_usd     DECIMAL(12,6)    NULL     DEFAULT NULL
                                                    COMMENT 'Running monthly AI cost total (USD) â€” updated daily by aiCostRollupWorker',
    ai_cost_rollup_month  CHAR(7)          NULL     DEFAULT NULL
                                                    COMMENT 'YYYY-MM of the last rollup (used to detect month boundary)',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_quotas_org (organization_id),
    CONSTRAINT fk_organization_quotas_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Per-tenant database isolation configuration  (migration 167 â€” P2.6)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_database_configs (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL,
    isolation_mode        ENUM('shared', 'isolated') NOT NULL DEFAULT 'shared',
    db_host               VARCHAR(255)     NULL,
    db_port               INT UNSIGNED     NOT NULL DEFAULT 3306,
    db_name               VARCHAR(100)     NULL,
    db_user               VARCHAR(255)     NULL,
    db_password_encrypted TEXT             NULL,
    ssl_enabled           TINYINT(1)       NOT NULL DEFAULT 0,
    last_verified_at      TIMESTAMP        NULL,
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_database_configs_org (organization_id),
    KEY idx_organization_database_configs_mode (isolation_mode),
    CONSTRAINT fk_organization_database_configs_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Table: profeco_complaints (migration 168)
-- =============================================================================
-- Consumer complaints filed through Mexico's PROFECO CONCILIANET platform.
-- =============================================================================

CREATE TABLE IF NOT EXISTS profeco_complaints (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED  NOT NULL,
    ticket_id            BIGINT UNSIGNED  NULL     COMMENT 'Linked support ticket, if any',
    client_id            BIGINT UNSIGNED  NULL     COMMENT 'Linked client record, if any',
    folio_profeco        VARCHAR(50)      NULL     COMMENT 'Folio number assigned by PROFECO/CONCILIANET',
    consumer_name        VARCHAR(255)     NOT NULL COMMENT 'Consumer full name as it appears in the PROFECO filing',
    consumer_email       VARCHAR(255)     NULL,
    consumer_phone       VARCHAR(30)      NULL,
    service_type         ENUM('internet', 'telefonia', 'television', 'paquete')
                                          NOT NULL DEFAULT 'internet',
    category             ENUM('facturacion', 'calidad_servicio', 'contrato',
                               'suspension_indebida', 'cobros_no_autorizados',
                               'atencion_cliente', 'otro')
                                          NOT NULL DEFAULT 'otro',
    description          TEXT            NOT NULL COMMENT 'Consumer complaint description',
    resolution_requested TEXT            NULL     COMMENT 'What the consumer is asking for',
    company_response     TEXT            NULL     COMMENT 'Company formal response / position',
    status               ENUM('recibida', 'en_tramite', 'resuelta', 'archivada')
                                          NOT NULL DEFAULT 'recibida',
    reported_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          COMMENT 'Date PROFECO received the complaint',
    resolved_at          DATETIME        NULL,
    submitted_by         BIGINT UNSIGNED NULL     COMMENT 'Staff user who logged this entry',
    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at           DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_profeco_complaints_org         (organization_id),
    KEY idx_profeco_complaints_client      (client_id),
    KEY idx_profeco_complaints_ticket      (ticket_id),
    KEY idx_profeco_complaints_status      (status),
    KEY idx_profeco_complaints_reported_at (reported_at),
    KEY idx_profeco_complaints_folio       (folio_profeco),
    KEY idx_profeco_complaints_deleted_at  (deleted_at),
    CONSTRAINT fk_profeco_complaints_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_profeco_complaints_client
        FOREIGN KEY (client_id) REFERENCES clients (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_profeco_complaints_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_profeco_complaints_user
        FOREIGN KEY (submitted_by) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- AI Reply Assistant tables (migrations 169, 172)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: ai_providers â€” LLM provider registry (migration 169)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_providers (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    name                VARCHAR(100)     NOT NULL COMMENT 'Admin-visible display name, e.g. "OpenAI prod"',
    kind                ENUM('openai','azure_openai','anthropic','gemini','ollama','custom')
                                         NOT NULL DEFAULT 'openai',
    model               VARCHAR(100)     NOT NULL COMMENT 'e.g. gpt-4o-mini, claude-3-5-sonnet, llama3.1:8b',
    embedding_model     VARCHAR(100)     NULL     COMMENT 'Model used for text embeddings. NULL = use kind default (text-embedding-3-small / nomic-embed-text / embedding-001).',
    endpoint_url        VARCHAR(500)     NULL     COMMENT 'Required for azure_openai, ollama, and custom kinds',
    api_key_encrypted   TEXT             NULL     COMMENT 'AES-256-GCM encrypted API key (see src/utils/encryption.js)',
    extra_config        JSON             NULL     COMMENT 'Deployment ID, region, custom headers, etc.',
    temperature         DECIMAL(3,2)     NOT NULL DEFAULT 0.20,
    max_tokens          INT UNSIGNED     NOT NULL DEFAULT 800,
    timeout_ms          INT UNSIGNED     NOT NULL DEFAULT 20000,
    enabled             TINYINT(1)       NOT NULL DEFAULT 1,
    priority            INT              NOT NULL DEFAULT 100 COMMENT 'Lower value = higher priority in fallback chain',
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME         DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ai_providers_org           (organization_id),
    KEY idx_ai_providers_org_enabled   (organization_id, enabled),
    KEY idx_ai_providers_org_priority  (organization_id, priority),
    KEY idx_ai_providers_deleted_at    (deleted_at),

    CONSTRAINT fk_ai_providers_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ai_policies â€” per-org on/off switch + mode configuration (migration 169)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_policies (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED  NOT NULL,
    enabled                 TINYINT(1)       NOT NULL DEFAULT 0
                                              COMMENT 'Master on/off switch for the AI assistant',
    enabled_channels        JSON             NOT NULL
                                              DEFAULT (JSON_OBJECT('portal', FALSE, 'email', FALSE, 'whatsapp', FALSE, 'sms', FALSE))
                                              COMMENT '{"portal":true,"email":true,"whatsapp":false,"sms":false}',
    mode                    ENUM('draft_only','suggest','auto_send')
                                             NOT NULL DEFAULT 'draft_only',
    auto_send_confidence    DECIMAL(3,2)     NOT NULL DEFAULT 0.85
                                              COMMENT '0.00â€“1.00 confidence threshold for auto_send mode',
    default_locale          VARCHAR(10)      NOT NULL DEFAULT 'es-MX',
    tone                    ENUM('formal','neutral','friendly')
                                             NOT NULL DEFAULT 'formal',
    redact_pii_before_llm   TINYINT(1)       NOT NULL DEFAULT 1
                                              COMMENT 'Strip IP/MAC/phone/email/address before sending to LLM',
    active_provider_id      BIGINT UNSIGNED  NULL
                                              COMMENT 'Currently selected ai_providers.id',
    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_policies_org      (organization_id),
    KEY idx_ai_policies_org_enabled    (organization_id, enabled),

    CONSTRAINT fk_ai_policies_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ai_policies_provider
        FOREIGN KEY (active_provider_id) REFERENCES ai_providers (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ai_phrase_library â€” curated on-brand reply phrases (migration 169)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_phrase_library (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NOT NULL,
    locale          VARCHAR(10)      NOT NULL DEFAULT 'es-MX'
                                      COMMENT 'BCP-47 locale tag',
    category        VARCHAR(50)      NOT NULL
                                      COMMENT 'e.g. greeting, apology, outage_update, escalation, closing',
    text            TEXT             NOT NULL COMMENT 'Phrase text the LLM must use or draw from',
    is_required     TINYINT(1)       NOT NULL DEFAULT 0
                                      COMMENT 'If 1, draft is rejected when phrase is absent',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME         DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ai_phrases_org             (organization_id),
    KEY idx_ai_phrases_org_locale_cat  (organization_id, locale, category),
    KEY idx_ai_phrases_deleted_at      (deleted_at),

    CONSTRAINT fk_ai_phrases_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ai_forbidden_terms â€” output-level content guardrails (migration 169)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_forbidden_terms (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NOT NULL,
    locale          VARCHAR(10)      NOT NULL DEFAULT 'es-MX',
    term            VARCHAR(255)     NOT NULL COMMENT 'Term that must never appear in a draft',
    replacement     VARCHAR(255)     NULL     COMMENT 'Optional safe substitute the validator may suggest',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME         DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ai_forbidden_org           (organization_id),
    KEY idx_ai_forbidden_org_locale    (organization_id, locale),
    KEY idx_ai_forbidden_deleted_at    (deleted_at),

    CONSTRAINT fk_ai_forbidden_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ai_reply_logs â€” immutable audit trail for every AI action (migration 169)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_reply_logs (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    ticket_id           BIGINT UNSIGNED  NOT NULL,
    provider_id         BIGINT UNSIGNED  NULL     COMMENT 'ai_providers.id that produced this draft',
    classification      VARCHAR(50)      NULL     COMMENT 'Category assigned by classify step',
    confidence          DECIMAL(5,4)     NULL     COMMENT '0.0000â€“1.0000 LLM-reported confidence score',
    context_snapshot    JSON             NULL     COMMENT 'topology + health snapshot sent to LLM (no PII after redact)',
    prompt_hash         VARCHAR(64)      NULL     COMMENT 'SHA-256 of the rendered system prompt (for dedup / audit)',
    draft_text          TEXT             NULL     COMMENT 'Raw draft returned by LLM',
    final_text          TEXT             NULL     COMMENT 'Text actually sent to the client (may differ if edited)',
    action              ENUM('proposed','edited','sent','auto_sent','discarded','failed')
                                         NOT NULL DEFAULT 'proposed',
    reviewer_user_id    BIGINT UNSIGNED  NULL     COMMENT 'Staff user who sent/edited/discarded',
    prompt_tokens       INT UNSIGNED     NULL,
    completion_tokens   INT UNSIGNED     NULL,
    cost_usd            DECIMAL(10,6)    NULL,
    duration_ms         INT UNSIGNED     NULL,
    error               TEXT             NULL     COMMENT 'Error detail when action = failed',
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ai_reply_logs_org           (organization_id),
    KEY idx_ai_reply_logs_org_ticket    (organization_id, ticket_id),
    KEY idx_ai_reply_logs_ticket        (ticket_id),
    KEY idx_ai_reply_logs_provider      (provider_id),
    KEY idx_ai_reply_logs_action        (action),
    KEY idx_ai_reply_logs_created_at    (created_at),

    CONSTRAINT fk_ai_reply_logs_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ai_reply_logs_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ai_reply_logs_provider
        FOREIGN KEY (provider_id) REFERENCES ai_providers (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ai_reply_logs_reviewer
        FOREIGN KEY (reviewer_user_id) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: contract_topology_paths â€” topology path cache CPE â†’ edge (migration 169)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_topology_paths (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    contract_id BIGINT UNSIGNED  NOT NULL,
    path        JSON             NOT NULL
                                  COMMENT 'Ordered [{device_id,role,link_id,medium}] CPEâ†’edge',
    computed_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  COMMENT 'Timestamp of last computation; used for cache invalidation',

    PRIMARY KEY (id),
    UNIQUE KEY uq_contract_topology_paths_contract (contract_id),
    KEY idx_contract_topology_paths_computed_at (computed_at),

    CONSTRAINT fk_contract_topology_paths_contract
        FOREIGN KEY (contract_id) REFERENCES contracts (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Seed: AI Reply Assistant RBAC permissions (migration 171)
-- =============================================================================
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('ai.policy.read',     'View AI assistant policy, audit logs, and metrics',           'ai'),
    ('ai.policy.write',    'Configure AI assistant policy and master on/off switch',      'ai'),
    ('ai.providers.read',  'View registered AI LLM providers (no API keys returned)',     'ai'),
    ('ai.providers.write', 'Register, edit, delete, and test-connect AI providers',       'ai'),
    ('ai.phrases.read',    'View phrase library and forbidden-term list',                  'ai'),
    ('ai.phrases.write',   'Edit phrase library and forbidden-term list',                  'ai'),
    ('ai.reply.draft',     'Force-generate an AI draft reply for a support ticket',       'ai'),
    ('ai.reply.send',      'Send, edit, or discard an AI-generated reply draft',          'ai');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name LIKE 'ai.%'
WHERE  r.name = 'admin';

-- =============================================================================
-- Interaction Tracking â€” isp-platform-features.md Â§1.3 (migrations 196-197)
-- =============================================================================
-- =============================================================================
-- Migration 196: Interaction Tracking tables (client interactions, follow-up
--                reminders, satisfaction surveys, ticket escalations)
-- =============================================================================
-- Implements isp-platform-features.md Â§1.3 "Interaction Tracking":
--   â€¢ client_interactions   â€” manual interaction log (calls, visits, chats, â€¦);
--                              together with tickets, payments, email_logs and
--                              sms_logs it feeds the per-client activity
--                              timeline (interactionService.activityTimeline)
--   â€¢ follow_up_reminders    â€” scheduled follow-ups with automated due
--                              notifications (taskRunner: follow_up_reminders)
--   â€¢ satisfaction_surveys   â€” NPS / CSAT surveys, auto-dispatched when a
--                              ticket is resolved (taskRunner:
--                              dispatch_satisfaction_surveys)
--   â€¢ ticket_escalations     â€” escalation management for unresolved tickets,
--                              with hourly auto-escalation of stale tickets
--                              (taskRunner: auto_escalate_tickets)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: client_interactions â€” manual interaction log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_interactions (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED NULL
                         COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id        BIGINT UNSIGNED NOT NULL,
    user_id          BIGINT UNSIGNED NULL COMMENT 'Staff member (users.id) who logged the interaction',
    interaction_type ENUM('call','email','sms','visit','chat','other')
                         NOT NULL DEFAULT 'call' COMMENT 'Channel of the interaction',
    direction        ENUM('inbound','outbound')
                         NOT NULL DEFAULT 'inbound' COMMENT 'Direction relative to the ISP',
    subject          VARCHAR(300)    NOT NULL COMMENT 'Short summary line',
    notes            TEXT            NULL COMMENT 'Free-form detail of what was discussed',
    occurred_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                         COMMENT 'When the interaction took place',
    duration_minutes INT UNSIGNED    NULL COMMENT 'Call/visit duration in minutes',
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at       DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_client_interactions_organization_id (organization_id),
    KEY idx_client_interactions_client_occurred (client_id, occurred_at DESC),
    KEY idx_client_interactions_type (interaction_type),
    KEY idx_client_interactions_deleted_at (deleted_at),
    CONSTRAINT fk_client_interactions_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_client_interactions_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_client_interactions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: follow_up_reminders â€” scheduled follow-ups per client
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_up_reminders (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL
                        COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id       BIGINT UNSIGNED NOT NULL,
    interaction_id  BIGINT UNSIGNED NULL COMMENT 'Originating interaction, when the follow-up came from one',
    ticket_id       BIGINT UNSIGNED NULL COMMENT 'Related support ticket, if any',
    assigned_to     BIGINT UNSIGNED NULL COMMENT 'Staff member (users.id) responsible for the follow-up',
    title           VARCHAR(200)    NOT NULL COMMENT 'What needs to be followed up',
    notes           TEXT            NULL,
    priority        ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
    status          ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
    due_at          DATETIME        NOT NULL COMMENT 'When the follow-up is due',
    notified_at     DATETIME        NULL COMMENT 'When the due notification was sent (NULL = not yet notified)',
    completed_at    DATETIME        NULL,
    completed_by    BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_follow_up_reminders_organization_id (organization_id),
    KEY idx_follow_up_reminders_client_id (client_id),
    KEY idx_follow_up_reminders_assigned_status (assigned_to, status, due_at),
    KEY idx_follow_up_reminders_status_due (status, due_at),
    KEY idx_follow_up_reminders_deleted_at (deleted_at),
    CONSTRAINT fk_follow_up_reminders_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_interaction FOREIGN KEY (interaction_id)
        REFERENCES client_interactions (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_follow_up_reminders_completed_by FOREIGN KEY (completed_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: satisfaction_surveys â€” NPS / CSAT responses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL
                        COMMENT 'Tenant organization; NULL = single-tenant deployment',
    client_id       BIGINT UNSIGNED NOT NULL,
    ticket_id       BIGINT UNSIGNED NULL COMMENT 'Ticket that triggered the survey (resolution CSAT)',
    interaction_id  BIGINT UNSIGNED NULL COMMENT 'Interaction that triggered the survey, if any',
    survey_type     ENUM('nps','csat') NOT NULL DEFAULT 'csat'
                        COMMENT 'NPS scores 0-10; CSAT scores 1-5',
    channel         ENUM('email','sms','portal','in_person') NOT NULL DEFAULT 'email',
    status          ENUM('pending','sent','responded','expired') NOT NULL DEFAULT 'pending',
    score           TINYINT         NULL COMMENT 'NPS: 0-10, CSAT: 1-5; NULL until responded',
    comment         TEXT            NULL COMMENT 'Free-form respondent comment',
    sent_at         DATETIME        NULL,
    responded_at    DATETIME        NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_satisfaction_surveys_organization_id (organization_id),
    KEY idx_satisfaction_surveys_client_id (client_id),
    KEY idx_satisfaction_surveys_ticket_id (ticket_id),
    KEY idx_satisfaction_surveys_type_status (survey_type, status),
    KEY idx_satisfaction_surveys_responded_at (responded_at),
    KEY idx_satisfaction_surveys_deleted_at (deleted_at),
    CONSTRAINT fk_satisfaction_surveys_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_satisfaction_surveys_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_satisfaction_surveys_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_satisfaction_surveys_interaction FOREIGN KEY (interaction_id)
        REFERENCES client_interactions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ticket_escalations â€” escalation chain for unresolved tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_escalations (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED NULL
                         COMMENT 'Tenant organization; NULL = single-tenant deployment',
    ticket_id        BIGINT UNSIGNED NOT NULL,
    level            TINYINT UNSIGNED NOT NULL DEFAULT 1
                         COMMENT 'Escalation tier: 1 = L1 support, 2 = L2 tech, 3 = management',
    escalated_by     BIGINT UNSIGNED NULL COMMENT 'User who escalated; NULL = automatic (stale-ticket task)',
    escalated_to     BIGINT UNSIGNED NULL COMMENT 'User the ticket was escalated to',
    reason           VARCHAR(500)    NOT NULL COMMENT 'Why the ticket was escalated',
    status           ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
    acknowledged_at  DATETIME        NULL,
    resolved_at      DATETIME        NULL,
    resolution_notes TEXT            NULL,
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ticket_escalations_organization_id (organization_id),
    KEY idx_ticket_escalations_ticket_level (ticket_id, level),
    KEY idx_ticket_escalations_status (status),
    CONSTRAINT fk_ticket_escalations_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_escalations_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_escalations_escalated_by FOREIGN KEY (escalated_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ticket_escalations_escalated_to FOREIGN KEY (escalated_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: scheduled tasks driving the automated parts of Â§1.3
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES
    (NULL,
     'follow_up_reminders',
     'Notify assignees about follow-up reminders that have come due',
     '*/15 * * * *',
     TRUE,
     'normal'),
    (NULL,
     'dispatch_satisfaction_surveys',
     'Create and send CSAT surveys for recently resolved tickets',
     '0 * * * *',
     TRUE,
     'normal'),
    (NULL,
     'auto_escalate_tickets',
     'Escalate open tickets with no resolution after 48 hours',
     '30 * * * *',
     TRUE,
     'normal');

-- Migration: 197_seed_interaction_permissions
-- Description: Seeds the RBAC permissions for the Interaction Tracking module
--              (isp-platform-features.md Â§1.3) and assigns them to the default
--              system roles.
--
--              Permission slugs (module = 'interactions'):
--                interactions.view/create/update/delete
--                follow_ups.view/create/update/delete
--                surveys.view/create/update/delete
--                escalations.view/create/update
--
--              Uses INSERT IGNORE throughout so re-running on an existing
--              installation is safe.

-- -------------------------------------------------------------------------
-- 1. New permissions
-- -------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('interactions.view',   'View client interaction history and activity timelines', 'interactions'),
    ('interactions.create', 'Log client interactions (calls, visits, chats)',         'interactions'),
    ('interactions.update', 'Edit logged client interactions',                        'interactions'),
    ('interactions.delete', 'Delete logged client interactions',                      'interactions'),
    ('follow_ups.view',     'View follow-up reminders',                               'interactions'),
    ('follow_ups.create',   'Create follow-up reminders',                             'interactions'),
    ('follow_ups.update',   'Complete, reschedule, and edit follow-up reminders',     'interactions'),
    ('follow_ups.delete',   'Delete follow-up reminders',                             'interactions'),
    ('surveys.view',        'View satisfaction surveys and NPS/CSAT metrics',         'interactions'),
    ('surveys.create',      'Create and send satisfaction surveys',                   'interactions'),
    ('surveys.update',      'Record survey responses and edit surveys',               'interactions'),
    ('surveys.delete',      'Delete satisfaction surveys',                            'interactions'),
    ('escalations.view',    'View ticket escalations and escalation candidates',      'interactions'),
    ('escalations.create',  'Escalate tickets',                                       'interactions'),
    ('escalations.update',  'Acknowledge and resolve ticket escalations',             'interactions');

-- -------------------------------------------------------------------------
-- 2. Assign permissions to roles
-- -------------------------------------------------------------------------

-- admin: every interaction-tracking permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.module = 'interactions'
WHERE  r.name = 'admin';

-- support: full day-to-day interaction management (no hard deletes of surveys)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'interactions.view','interactions.create','interactions.update','interactions.delete',
           'follow_ups.view','follow_ups.create','follow_ups.update','follow_ups.delete',
           'surveys.view','surveys.create','surveys.update',
           'escalations.view','escalations.create','escalations.update'
       )
WHERE  r.name = 'support';

-- billing: view interaction history and survey metrics
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'interactions.view','follow_ups.view','surveys.view'
       )
WHERE  r.name = 'billing';

-- technician: view + work their own follow-ups, view escalations
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'interactions.view','follow_ups.view','follow_ups.update','escalations.view'
       )
WHERE  r.name = 'technician';

-- readonly: view-only across the module
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'interactions.view','follow_ups.view','surveys.view','escalations.view'
       )
WHERE  r.name = 'readonly';

-- =============================================================================
-- Migration 198: Communication tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: communication_campaigns â€” bulk campaign definition and aggregate stats
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
-- Table: campaign_messages â€” per-recipient message records for a campaign
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
-- Table: client_dnd_preferences â€” per-customer per-channel Do Not Disturb
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

-- =============================================================================
-- Migration 199: Communication module RBAC permissions
-- =============================================================================
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('campaigns.view',   'View communication campaigns and per-recipient delivery stats', 'communication'),
    ('campaigns.create', 'Create bulk email/SMS/WhatsApp campaigns',                      'communication'),
    ('campaigns.update', 'Edit and schedule communication campaigns',                     'communication'),
    ('campaigns.delete', 'Delete communication campaigns',                                'communication'),
    ('dnd.view',         'View client Do Not Disturb preferences',                        'communication'),
    ('dnd.update',       'Set and update client Do Not Disturb preferences',              'communication');

-- admin: every communication permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.module = 'communication'
WHERE  r.name = 'admin';

-- support: campaign management and DND management (no hard deletes)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'campaigns.view','campaigns.create','campaigns.update',
           'dnd.view','dnd.update'
       )
WHERE  r.name = 'support';

-- billing: full campaign management plus DND (billing team sends payment notices)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'campaigns.view','campaigns.create','campaigns.update','campaigns.delete',
           'dnd.view','dnd.update'
       )
WHERE  r.name = 'billing';

-- technician: view campaigns and DND preferences (read-only for field staff)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'campaigns.view',
           'dnd.view'
       )
WHERE  r.name = 'technician';

-- readonly: view-only across the module
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'campaigns.view',
           'dnd.view'
       )
WHERE  r.name = 'readonly';


-- =============================================================================
-- Migration 204: organization_invoice_settings â€” per-org invoice branding (Â§2.2B)
-- =============================================================================
CREATE TABLE IF NOT EXISTS organization_invoice_settings (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED NOT NULL,
    logo_url             VARCHAR(500)    NULL,
    header_color         VARCHAR(7)      NULL     DEFAULT '#1a5276',
    footer_legal         TEXT            NULL,
    payment_instructions TEXT            NULL,
    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_org_invoice_settings (organization_id),
    CONSTRAINT fk_org_invoice_settings_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Migration 206: late_fee_rules and invoice_late_fees tables (Â§2.2B)
-- =============================================================================
CREATE TABLE IF NOT EXISTS late_fee_rules (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    name                VARCHAR(255)     NOT NULL,
    fee_type            ENUM('flat','percent') NOT NULL DEFAULT 'flat',
    fee_amount          DECIMAL(10,2)    NOT NULL DEFAULT 0.00,
    grace_period_days   INT              NOT NULL DEFAULT 0,
    max_applications    INT              NULL,
    is_active           TINYINT(1)       NOT NULL DEFAULT 1,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_late_fee_rules_org (organization_id),
    CONSTRAINT fk_late_fee_rules_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_late_fees (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    invoice_id          BIGINT UNSIGNED  NOT NULL,
    late_fee_rule_id    BIGINT UNSIGNED  NOT NULL,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    amount              DECIMAL(10,2)    NOT NULL,
    applied_at          DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_by          BIGINT UNSIGNED  NULL,
    invoice_item_id     BIGINT UNSIGNED  NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_invoice_late_fees_invoice (invoice_id),
    KEY idx_invoice_late_fees_rule (late_fee_rule_id),
    KEY idx_invoice_late_fees_org (organization_id),
    CONSTRAINT fk_invoice_late_fees_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_invoice_late_fees_rule FOREIGN KEY (late_fee_rule_id) REFERENCES late_fee_rules (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_invoice_late_fees_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Migration 208: payment_reminder_settings and payment_reminder_logs (Â§2.2B)
-- =============================================================================
CREATE TABLE IF NOT EXISTS payment_reminder_settings (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    days_before_due     JSON             NULL,
    send_on_due         TINYINT(1)       NOT NULL DEFAULT 1,
    days_after_due      JSON             NULL,
    enabled             TINYINT(1)       NOT NULL DEFAULT 1,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_reminder_settings_org (organization_id),
    CONSTRAINT fk_payment_reminder_settings_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_reminder_logs (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    invoice_id          BIGINT UNSIGNED  NOT NULL,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    stage               VARCHAR(50)      NOT NULL,
    sent_at             DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    channel             ENUM('email','sms') NOT NULL DEFAULT 'email',
    PRIMARY KEY (id),
    UNIQUE KEY uq_reminder_log_dedup (invoice_id, stage, channel),
    KEY idx_reminder_log_invoice (invoice_id),
    KEY idx_reminder_log_org (organization_id),
    CONSTRAINT fk_payment_reminder_logs_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_payment_reminder_logs_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Migration 217: refund_requests â€” refund request workflow (Â§2.5.1)
-- =============================================================================
CREATE TABLE IF NOT EXISTS refund_requests (
    id                          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id             BIGINT UNSIGNED  NULL,
    client_id                   BIGINT UNSIGNED  NOT NULL,
    payment_id                  BIGINT UNSIGNED  NULL,
    invoice_id                  BIGINT UNSIGNED  NULL,
    amount                      DECIMAL(12,2)    NOT NULL,
    reason                      ENUM('overcharge','duplicate','cancellation','service_issue','other') NOT NULL,
    status                      ENUM('requested','under_review','approved','rejected','processed') NOT NULL DEFAULT 'requested',
    requested_by                BIGINT UNSIGNED  NULL    COMMENT 'users.id',
    reviewed_by                 BIGINT UNSIGNED  NULL,
    review_notes                TEXT             NULL,
    processed_at                DATETIME         NULL,
    refund_method               ENUM('original_method','credit_balance','manual') NULL,
    resulting_credit_note_id    BIGINT UNSIGNED  NULL,
    gateway_refund_reference    VARCHAR(200)     NULL,
    created_at                  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at                  DATETIME         NULL,
    PRIMARY KEY (id),
    KEY idx_refund_requests_organization_id (organization_id),
    KEY idx_refund_requests_client_id (client_id),
    KEY idx_refund_requests_payment_id (payment_id),
    KEY idx_refund_requests_invoice_id (invoice_id),
    KEY idx_refund_requests_status (status),
    KEY idx_refund_requests_deleted_at (deleted_at),
    CONSTRAINT fk_refund_requests_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Migration 219: billing_disputes and dispute_evidence tables (Â§2.5.2)
-- =============================================================================
CREATE TABLE IF NOT EXISTS billing_disputes (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED  NULL,
    client_id        BIGINT UNSIGNED  NOT NULL,
    invoice_id       BIGINT UNSIGNED  NULL,
    payment_id       BIGINT UNSIGNED  NULL,
    type             ENUM('billing_error','service_quality','unauthorized_charge','other') NOT NULL,
    status           ENUM('open','investigating','resolved_favor_client','resolved_favor_company','escalated') NOT NULL DEFAULT 'open',
    description      TEXT             NOT NULL,
    resolution_notes TEXT             NULL,
    opened_by        BIGINT UNSIGNED  NULL,
    resolved_by      BIGINT UNSIGNED  NULL,
    resolved_at      DATETIME         NULL,
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at       DATETIME         NULL,
    PRIMARY KEY (id),
    KEY idx_billing_disputes_organization_id (organization_id),
    KEY idx_billing_disputes_client_id (client_id),
    KEY idx_billing_disputes_status (status),
    KEY idx_billing_disputes_deleted_at (deleted_at),
    CONSTRAINT fk_billing_disputes_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispute_evidence (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL,
    dispute_id      BIGINT UNSIGNED  NOT NULL,
    filename        VARCHAR(255)     NOT NULL,
    stored_path     VARCHAR(500)     NOT NULL,
    mime_type       VARCHAR(100)     NULL,
    size_bytes      INT UNSIGNED     NULL,
    uploaded_by     BIGINT UNSIGNED  NULL,
    note            TEXT             NULL,
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_dispute_evidence_dispute_id (dispute_id),
    KEY idx_dispute_evidence_organization_id (organization_id),
    CONSTRAINT fk_dispute_evidence_dispute FOREIGN KEY (dispute_id)
        REFERENCES billing_disputes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dispute_evidence_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Migration 221: chargebacks and billing_adjustments tables (Â§2.5.3 / Â§2.5.4)
-- =============================================================================
CREATE TABLE IF NOT EXISTS chargebacks (
    id                        BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id           BIGINT UNSIGNED  NULL,
    payment_id                BIGINT UNSIGNED  NULL,
    gateway                   VARCHAR(50)      NULL    COMMENT 'stripe/conekta/etc',
    gateway_dispute_id        VARCHAR(200)     NULL,
    amount                    DECIMAL(12,2)    NOT NULL,
    currency                  VARCHAR(3)       NOT NULL DEFAULT 'USD',
    reason_code               VARCHAR(100)     NULL,
    status                    ENUM('received','evidence_submitted','won','lost','accepted') NOT NULL DEFAULT 'received',
    due_by                    DATE             NULL    COMMENT 'Deadline for evidence submission',
    outcome_notes             TEXT             NULL,
    linked_refund_request_id  BIGINT UNSIGNED  NULL,
    created_at                TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at                DATETIME         NULL,
    PRIMARY KEY (id),
    KEY idx_chargebacks_organization_id (organization_id),
    KEY idx_chargebacks_payment_id (payment_id),
    UNIQUE KEY uq_chargebacks_gateway_dispute_id (gateway_dispute_id),
    KEY idx_chargebacks_status (status),
    KEY idx_chargebacks_deleted_at (deleted_at),
    CONSTRAINT fk_chargebacks_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_adjustments (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL,
    client_id       BIGINT UNSIGNED  NOT NULL,
    entity_type     ENUM('invoice','payment','credit_note','balance') NOT NULL,
    entity_id       BIGINT UNSIGNED  NOT NULL,
    adjustment_type ENUM('late_fee_waiver','discount','correction','write_off','other') NOT NULL,
    amount_delta    DECIMAL(12,2)    NOT NULL COMMENT 'Positive = credit to client, negative = debit',
    reason          TEXT             NOT NULL,
    approved_by     BIGINT UNSIGNED  NULL,
    created_by      BIGINT UNSIGNED  NULL,
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_billing_adjustments_organization_id (organization_id),
    KEY idx_billing_adjustments_client_id (client_id),
    KEY idx_billing_adjustments_entity (entity_type, entity_id),
    CONSTRAINT fk_billing_adjustments_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radcheck
-- Purpose: Standard FreeRADIUS per-user check attributes (Cleartext-Password,
--          Auth-Type, TLS-Cert-Serial) — populated by radius_sync task (§3.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radcheck (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username  VARCHAR(64)     NOT NULL DEFAULT '',
    attribute VARCHAR(64)     NOT NULL DEFAULT '',
    op        CHAR(2)         NOT NULL DEFAULT '==',
    value     VARCHAR(253)    NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    KEY idx_radcheck_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radreply
-- Purpose: Standard FreeRADIUS per-user reply attributes — populated by radius_sync task
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radreply (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username  VARCHAR(64)     NOT NULL DEFAULT '',
    attribute VARCHAR(64)     NOT NULL DEFAULT '',
    op        CHAR(2)         NOT NULL DEFAULT '=',
    value     VARCHAR(253)    NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    KEY idx_radreply_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radusergroup
-- Purpose: Standard FreeRADIUS user → group membership
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radusergroup (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username  VARCHAR(64)     NOT NULL DEFAULT '',
    groupname VARCHAR(64)     NOT NULL DEFAULT '',
    priority  INT             NOT NULL DEFAULT 1,

    PRIMARY KEY (id),
    KEY idx_radusergroup_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radgroupcheck
-- Purpose: Standard FreeRADIUS per-group check attributes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radgroupcheck (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    groupname VARCHAR(64)     NOT NULL DEFAULT '',
    attribute VARCHAR(64)     NOT NULL DEFAULT '',
    op        CHAR(2)         NOT NULL DEFAULT '==',
    value     VARCHAR(253)    NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    KEY idx_radgroupcheck_groupname (groupname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radgroupreply
-- Purpose: Standard FreeRADIUS per-group reply attributes (vendor speed attrs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radgroupreply (
    id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    groupname VARCHAR(64)     NOT NULL DEFAULT '',
    attribute VARCHAR(64)     NOT NULL DEFAULT '',
    op        CHAR(2)         NOT NULL DEFAULT '=',
    value     VARCHAR(253)    NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    KEY idx_radgroupreply_groupname (groupname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: subscriber_certificates
-- Purpose: EAP-TLS subscriber certificate metadata registry (§3.1)
-- NOTE: FireISP is a metadata registry only — it does NOT generate or sign
--       certificates. Use an external CA (easy-rsa, step-ca, Vault PKI, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_certificates (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL
                            COMMENT 'Tenant organization; NULL = single-tenant deployment',
    radius_account_id   BIGINT UNSIGNED NULL
                            COMMENT 'Linked RADIUS account (radius.id)',
    client_id           BIGINT UNSIGNED NULL
                            COMMENT 'Linked subscriber (clients.id)',
    common_name         VARCHAR(255)    NOT NULL
                            COMMENT 'Certificate CN, typically the RADIUS username',
    serial_number       VARCHAR(100)    NOT NULL
                            COMMENT 'Certificate serial number (hex string)',
    fingerprint_sha256  VARCHAR(64)     NOT NULL
                            COMMENT 'SHA-256 fingerprint of the certificate (hex, no colons)',
    valid_from          DATETIME        NOT NULL,
    valid_until         DATETIME        NOT NULL,
    status              ENUM('active','revoked','expired')
                            NOT NULL DEFAULT 'active',
    revoked_at          DATETIME        NULL,
    revocation_reason   VARCHAR(255)    NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_subscriber_certificates_org_id (organization_id),
    KEY idx_subscriber_certificates_radius_account_id (radius_account_id),
    KEY idx_subscriber_certificates_client_id (client_id),
    KEY idx_subscriber_certificates_status (status),
    KEY idx_subscriber_certificates_valid_until (valid_until),
    CONSTRAINT fk_subscriber_certificates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_subscriber_certificates_radius_account FOREIGN KEY (radius_account_id)
        REFERENCES radius (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscriber_certificates_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: plan_access_windows (migration 226 — §3.2 item 12)
-- Purpose: Per-plan time-based access restriction windows.
--          Converted to FreeRADIUS Login-Time radcheck attribute by syncFreeradiusTables().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_access_windows (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    plan_id         BIGINT UNSIGNED NOT NULL,
    organization_id BIGINT UNSIGNED NULL,
    label           VARCHAR(100)    NOT NULL
                        COMMENT 'Human-readable label e.g. "Business hours"',
    day_mask        TINYINT UNSIGNED NOT NULL DEFAULT 127
                        COMMENT 'Bitmask: bit0=Sun, bit1=Mon, ..., bit6=Sat; 127=all days',
    start_time      TIME            NOT NULL,
    end_time        TIME            NOT NULL,
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_plan_access_windows_plan_id (plan_id),
    KEY idx_plan_access_windows_organization_id (organization_id),
    KEY idx_plan_access_windows_status (status),
    CONSTRAINT fk_plan_access_windows_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: organization_walled_garden_settings (migration 227 — §3.2 item 14)
-- Purpose: Per-org walled garden configuration for captive portal / unpaid subscriber handling.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_walled_garden_settings (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED NOT NULL,
    enabled               TINYINT(1)      NOT NULL DEFAULT 0,
    redirect_url          VARCHAR(500)    NULL,
    address_list_name     VARCHAR(100)    NOT NULL DEFAULT 'walled_garden',
    allowed_destinations  TEXT            NULL,
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_walled_garden_org (organization_id),
    CONSTRAINT fk_walled_garden_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: radius_account_routes (migration 228 — §3.2 item 15)
-- Purpose: Per-account static route injection; each row → one Framed-Route radreply attribute.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius_account_routes (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    radius_account_id   BIGINT UNSIGNED NOT NULL,
    organization_id     BIGINT UNSIGNED NULL,
    destination         VARCHAR(50)     NOT NULL
                            COMMENT 'Destination CIDR (e.g. 192.168.10.0/24)',
    gateway             VARCHAR(45)     NULL,
    metric              TINYINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_radius_account_routes_account_id (radius_account_id),
    KEY idx_radius_account_routes_org_id (organization_id),
    KEY idx_radius_account_routes_deleted_at (deleted_at),
    CONSTRAINT fk_radius_account_routes_account FOREIGN KEY (radius_account_id)
        REFERENCES radius (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: mac_move_events (migration 231 — §3.3 Phase C)
-- Purpose: Records MAC-address move events detected during RADIUS accounting
--          ingest (same username, different Calling-Station-Id or NAS).
--          No FK constraints — loose references for compliance resilience.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mac_move_events (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL
                        COMMENT 'Tenant organization; NULL = single-tenant (no FK)',
    username        VARCHAR(64)     NOT NULL  COMMENT 'RADIUS username',
    old_mac         VARCHAR(17)     NULL      COMMENT 'Previous Calling-Station-Id (raw)',
    new_mac         VARCHAR(17)     NULL      COMMENT 'New Calling-Station-Id detected',
    old_nas_id      BIGINT UNSIGNED NULL      COMMENT 'Previous NAS (loose ref to nas.id)',
    new_nas_id      BIGINT UNSIGNED NULL      COMMENT 'New NAS (loose ref to nas.id)',
    detected_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_mac_move_org         (organization_id),
    KEY idx_mac_move_username    (username),
    KEY idx_mac_move_detected_at (detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Columns added to connection_logs by migration 230 (§3.3 Phase C):
--   acct_session_id     VARCHAR(64)  NULL
--   nas_port_id         VARCHAR(100) NULL
--   called_station_id   VARCHAR(100) NULL
--   calling_station_id  VARCHAR(100) NULL
--   framed_ip           VARCHAR(45)  NULL
--   framed_ipv6_prefix  VARCHAR(64)  NULL
-- Applied via stored-procedure guards (ALTER TABLE IF NOT EXISTS equivalent).
-- See migration 230 for the exact DDL.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Columns added to nas by migration 232 (§3.4 Phase C):
--   coa_port           SMALLINT UNSIGNED NULL DEFAULT 3799
--   location           VARCHAR(200)      NULL
--   site_id            BIGINT UNSIGNED   NULL  (FK → sites ON DELETE SET NULL)
--   secondary_nas_id   BIGINT UNSIGNED   NULL  (self-ref FK ON DELETE SET NULL)
--   health_status      ENUM('unknown','up','down') NOT NULL DEFAULT 'unknown'
--   last_health_check_at DATETIME        NULL
-- Applied via stored-procedure guards. See migration 232.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Table: pppoe_service_profiles (migration 237 — §4 PPPoE Phase B)
-- Purpose: PPPoE AC / BNG service profiles — MTU, DNS, auth-method, rate-limit
--          override, MikroTik address-list/filter-id configuration.
--          Referenced by ip_pools.service_profile_id and radius.service_profile_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pppoe_service_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  name VARCHAR(100) NOT NULL,
  service_name VARCHAR(64) NULL COMMENT 'PPPoE AC service name sent in PADO; must match NAS pppoe-service-name',
  mtu SMALLINT UNSIGNED NOT NULL DEFAULT 1492,
  mru SMALLINT UNSIGNED NOT NULL DEFAULT 1492,
  auth_methods VARCHAR(100) NOT NULL DEFAULT 'pap,chap,mschapv2',
  dns_primary VARCHAR(45) NULL,
  dns_secondary VARCHAR(45) NULL,
  session_timeout_seconds INT NULL,
  idle_timeout_seconds INT NULL,
  rate_limit_override VARCHAR(100) NULL COMMENT 'Vendor rate string; when set replaces plan speed attribute for this profile subscribers',
  address_list VARCHAR(100) NULL COMMENT 'MikroTik firewall address-list name',
  filter_id VARCHAR(100) NULL COMMENT 'RFC 2865 Filter-Id attribute for firewall policy',
  ipv6cp_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Enable IPv6CP negotiation (migration 244)',
  delegated_prefix_len TINYINT UNSIGNED NULL COMMENT 'DHCPv6-PD prefix length to delegate e.g. 56, 60, 64 (migration 244)',
  dns_primary_v6 VARCHAR(45) NULL COMMENT 'Primary IPv6 DNS server (migration 244)',
  dns_secondary_v6 VARCHAR(45) NULL COMMENT 'Secondary IPv6 DNS server (migration 244)',
  nat64_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Enable NAT64 for this profile (migration 244)',
  dns64_prefix VARCHAR(50) NULL COMMENT 'DNS64 synthesis prefix e.g. 64:ff9b::/96 (migration 244)',
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_pppoe_service_profiles_org (organization_id),
  KEY idx_pppoe_service_profiles_status (status),
  KEY idx_pppoe_service_profiles_deleted (deleted_at),
  CONSTRAINT fk_pppoe_service_profiles_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Columns added to ip_pools by migration 237 (§4 PPPoE Phase B):
--   service_profile_id  BIGINT UNSIGNED NULL (FK → pppoe_service_profiles ON DELETE SET NULL)
-- Applied via stored-procedure guards. See migration 237.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Columns added to radius by migration 237 (§4 PPPoE Phase B):
--   service_profile_id  BIGINT UNSIGNED NULL (FK → pppoe_service_profiles ON DELETE SET NULL)
-- Applied via stored-procedure guards. See migration 237.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Table: radpostauth (migration 238 — §4 PPPoE Phase B)
-- Purpose: FreeRADIUS post-authentication log. Written directly by FreeRADIUS
--          via rlm_sql; read by FireISP for auth-failure diagnostics.
--          NO foreign keys — loose coupling for FreeRADIUS direct write access.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radpostauth (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL DEFAULT '',
  pass VARCHAR(64) NOT NULL DEFAULT '',
  reply VARCHAR(32) NOT NULL DEFAULT '',
  authdate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  nas_ip_address VARCHAR(45) NULL,
  calling_station_id VARCHAR(100) NULL,
  PRIMARY KEY (id),
  KEY idx_radpostauth_username (username),
  KEY idx_radpostauth_authdate (authdate),
  KEY idx_radpostauth_reply (reply)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: pppoe_event_logs (migration 239 — §4 PPPoE Phase B)
-- Purpose: PPPoE stage event log. Written by a syslog shipper; read by
--          FireISP for MTU diagnostics and LCP failure detection.
--          NO FK on organization_id or nas_id — loose coupling intentional.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pppoe_event_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  nas_id BIGINT UNSIGNED NULL,
  username VARCHAR(64) NULL,
  mac VARCHAR(17) NULL,
  stage ENUM('PADI','PADO','PADR','PADS','PADT','LCP','IPCP','IPV6CP','AUTH','OTHER') NOT NULL DEFAULT 'OTHER',
  severity ENUM('info','warning','error') NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  reason_code VARCHAR(50) NULL,
  logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pppoe_event_logs_org (organization_id),
  KEY idx_pppoe_event_logs_username (username),
  KEY idx_pppoe_event_logs_logged_at (logged_at),
  KEY idx_pppoe_event_logs_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: dhcp_servers (migration 241 — §5.1 DHCP Integration)
-- Purpose: DHCP server connection registry (ISC Kea, MikroTik).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dhcp_servers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `server_type` ENUM('kea','mikrotik') NOT NULL DEFAULT 'kea',
  `host` VARCHAR(255) NOT NULL,
  `port` INT UNSIGNED NOT NULL DEFAULT 8000,
  `api_url` VARCHAR(500) NULL,
  `api_token` TEXT NULL COMMENT 'Encrypted API token',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_dhcp_servers_org` (`organization_id`),
  INDEX `idx_dhcp_servers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: dhcp_static_reservations (migration 241 — §5.1 DHCP Integration)
-- Purpose: Static DHCP reservations binding MAC addresses to IP addresses.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dhcp_static_reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `dhcp_server_id` BIGINT UNSIGNED NULL,
  `pool_id` BIGINT UNSIGNED NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `mac_address` VARCHAR(17) NOT NULL,
  `hostname` VARCHAR(255) NULL,
  `client_id` BIGINT UNSIGNED NULL,
  `contract_id` BIGINT UNSIGNED NULL,
  `option82_circuit_id` VARCHAR(255) NULL COMMENT 'DHCP Option 82 circuit ID for subscriber binding',
  `option82_remote_id` VARCHAR(255) NULL COMMENT 'DHCP Option 82 remote ID for subscriber binding',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_dhcp_reservations_org` (`organization_id`),
  INDEX `idx_dhcp_reservations_mac` (`mac_address`),
  INDEX `idx_dhcp_reservations_ip` (`ip_address`),
  CONSTRAINT `fk_dhcp_reservations_server`
    FOREIGN KEY (`dhcp_server_id`) REFERENCES `dhcp_servers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_dhcp_reservations_pool`
    FOREIGN KEY (`pool_id`) REFERENCES `ip_pools` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_dhcp_reservations_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_dhcp_reservations_contract`
    FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: nat_pools (migration 242 — §5.1 NAT/CGNAT Management)
-- Purpose: CGNAT, 1:1 NAT, and PAT pool definitions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `nat_pools` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `nat_type` ENUM('cgnat','1to1','pat') NOT NULL DEFAULT 'cgnat',
  `external_ip_start` VARCHAR(45) NOT NULL,
  `external_ip_end` VARCHAR(45) NOT NULL,
  `internal_subnet` VARCHAR(50) NULL,
  `port_range_start` INT UNSIGNED NULL,
  `port_range_end` INT UNSIGNED NULL,
  `max_ports_per_subscriber` INT UNSIGNED NOT NULL DEFAULT 4096,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_nat_pools_org` (`organization_id`),
  INDEX `idx_nat_pools_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ptr_records (migration 242 — §5.1 PTR / Reverse DNS)
-- Purpose: Reverse DNS PTR record management.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ptr_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `ip_version` ENUM('ipv4','ipv6') NOT NULL DEFAULT 'ipv4',
  `hostname` VARCHAR(255) NOT NULL,
  `ttl` INT UNSIGNED NOT NULL DEFAULT 3600,
  `zone` VARCHAR(255) NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_ptr_records_org` (`organization_id`),
  INDEX `idx_ptr_records_ip` (`ip_address`),
  INDEX `idx_ptr_records_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ra_guard_policies (migration 243 — §5.2 IPv6 Management)
-- Purpose: RA Guard policy assignments to switch ports.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ra_guard_policies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `switch_id` BIGINT UNSIGNED NULL,
  `port_pattern` VARCHAR(100) NULL COMMENT 'Port pattern e.g. ge-0/0/*',
  `policy_type` ENUM('strict','loose') NOT NULL DEFAULT 'strict',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_ra_guard_org` (`organization_id`),
  CONSTRAINT `fk_ra_guard_switch`
    FOREIGN KEY (`switch_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Columns added to ip_pools by migration 243 (§5 IPv6):
--   dhcpv6_mode, ra_enabled, ra_managed_flag, ra_other_flag,
--   ra_lifetime_seconds, slaac_prefix, region_name
-- Applied via stored-procedure guards. See migration 243.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Column added to plans by migration 243 (§5 IPv6):
--   stack_type ENUM('ipv4_only','ipv6_only','dual_stack') NOT NULL DEFAULT 'dual_stack'
-- Applied via stored-procedure guard. See migration 243.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Columns added to pppoe_service_profiles by migration 244 (§5 Dual-Stack Sessions):
--   ipv6cp_enabled, delegated_prefix_len, dns_primary_v6, dns_secondary_v6,
--   nat64_enabled, dns64_prefix
-- Applied via stored-procedure guards. See migration 244.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Columns added to connection_logs by migration 244 (§5 Dual-Stack Sessions):
--   acct_output_octets_v6, acct_input_octets_v6, stack_type
-- (framed_ipv6_prefix already added by migration 230; radius IPv6 statics live
--  in the original 008 columns ipv6_address / ipv6_delegated_prefix.)
-- Applied via stored-procedure guards. NO FK — partitioned table. See migration 244.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Table: tunnel_6rd_configs (migration 245 — §5.4 IPv6 Transition Mechanisms)
-- Purpose: 6rd tunnel configuration for IPv6-over-IPv4 transition.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tunnel_6rd_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `border_relay_ip` VARCHAR(45) NOT NULL COMMENT 'IPv4 address of the 6rd Border Relay',
  `ipv6_prefix` VARCHAR(50) NOT NULL COMMENT 'Delegated 6rd IPv6 prefix',
  `ipv4_mask_len` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Number of IPv4 prefix bits shared by all CEs',
  `mtu` INT UNSIGNED NOT NULL DEFAULT 1480,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_6rd_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ds_lite_configs (migration 245 — §5.4 IPv6 Transition Mechanisms)
-- Purpose: DS-Lite AFTR configuration for IPv4-over-IPv6 tunneling.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ds_lite_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `aftr_address` VARCHAR(45) NOT NULL COMMENT 'IPv6 address of the AFTR (Address Family Transition Router)',
  `b4_address_range` VARCHAR(50) NULL COMMENT 'B4 element IPv6 address range',
  `mtu` INT UNSIGNED NOT NULL DEFAULT 1452,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_dslite_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: map_rules (migration 245 — §5.4 IPv6 Transition Mechanisms)
-- Purpose: MAP-E and MAP-T rule definitions for address mapping.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `map_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `rule_type` ENUM('map-e','map-t') NOT NULL DEFAULT 'map-e',
  `ipv6_prefix` VARCHAR(50) NOT NULL COMMENT 'MAP IPv6 rule prefix',
  `ipv4_prefix` VARCHAR(50) NOT NULL COMMENT 'MAP IPv4 rule prefix',
  `ea_bits_len` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'EA-bits length',
  `br_address` VARCHAR(45) NOT NULL COMMENT 'Border Relay IPv6 address',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_map_rules_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: xlat464_configs (migration 245 — §5.4 IPv6 Transition Mechanisms)
-- Purpose: 464XLAT PLAT/CLAT configuration for IPv4-in-IPv6-only networks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `xlat464_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `plat_prefix` VARCHAR(50) NOT NULL COMMENT 'PLAT (Provider-side translator) prefix',
  `clat_prefix` VARCHAR(50) NULL COMMENT 'CLAT (Customer-side translator) prefix',
  `dns64_prefix` VARCHAR(50) NULL COMMENT 'DNS64 synthesis prefix',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_xlat464_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: poller_nodes (migration 258 — §6.4 Distributed Polling Engine)
-- Purpose: Registry of dedicated SNMP poller nodes; may reference firerelay_nodes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poller_nodes (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  node_identifier       VARCHAR(64)     NOT NULL COMMENT 'Matches firerelay_nodes.id when linked',
  name                  VARCHAR(255)    NOT NULL,
  status                ENUM('active','draining','maintenance','offline') NOT NULL DEFAULT 'active',
  api_url               VARCHAR(512)    NULL,
  max_concurrent_polls  INT UNSIGNED    NOT NULL DEFAULT 10,
  current_queue_depth   INT UNSIGNED    NOT NULL DEFAULT 0,
  total_polls_today     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  failed_polls_today    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  avg_poll_duration_ms  INT UNSIGNED    NULL,
  last_heartbeat_at     DATETIME        NULL,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_poller_nodes_identifier (node_identifier),
  KEY idx_poller_nodes_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: device_polling_configs (migration 258 — §6.4 Polling Engine)
-- Purpose: Per-device or per-device-type polling interval and GETBULK overrides.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_polling_configs (
  id                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id            BIGINT UNSIGNED NULL,
  device_id                  BIGINT UNSIGNED NULL COMMENT 'NULL = applies to all devices of this type',
  device_type                VARCHAR(50)     NULL COMMENT 'Match devices.type; only used when device_id IS NULL',
  poller_node_id             BIGINT UNSIGNED NULL,
  poll_interval_sec          INT UNSIGNED    NOT NULL DEFAULT 300,
  bulk_get_enabled           TINYINT(1)      NOT NULL DEFAULT 1,
  max_repetitions            SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  timeout_ms                 INT UNSIGNED    NOT NULL DEFAULT 5000,
  retries                    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  failover_node_id           BIGINT UNSIGNED NULL,
  adaptive_polling_enabled   TINYINT(1)      NOT NULL DEFAULT 0,
  adaptive_min_interval_sec  INT UNSIGNED    NOT NULL DEFAULT 60,
  is_enabled                 TINYINT(1)      NOT NULL DEFAULT 1,
  deleted_at                 DATETIME        NULL,
  created_at                 DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dpc_org (organization_id),
  KEY idx_dpc_device (device_id),
  CONSTRAINT fk_dpc_org      FOREIGN KEY (organization_id) REFERENCES organizations(id)   ON DELETE CASCADE,
  CONSTRAINT fk_dpc_device   FOREIGN KEY (device_id)       REFERENCES devices(id)         ON DELETE CASCADE,
  CONSTRAINT fk_dpc_node     FOREIGN KEY (poller_node_id)  REFERENCES poller_nodes(id)    ON DELETE SET NULL,
  CONSTRAINT fk_dpc_failover FOREIGN KEY (failover_node_id) REFERENCES poller_nodes(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: poller_performance_snapshots (migration 258 — §6.4 Polling Engine)
-- Purpose: Time-series poller health metrics (poll duration, timeout rate, queue depth).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poller_performance_snapshots (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  poller_node_id        BIGINT UNSIGNED NULL,
  snapshot_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  devices_polled        INT UNSIGNED    NOT NULL DEFAULT 0,
  devices_failed        INT UNSIGNED    NOT NULL DEFAULT 0,
  avg_poll_duration_ms  INT UNSIGNED    NULL,
  max_poll_duration_ms  INT UNSIGNED    NULL,
  queue_depth           INT UNSIGNED    NOT NULL DEFAULT 0,
  timeout_rate_pct      DECIMAL(5,2)    NULL COMMENT 'Failed / total * 100',
  PRIMARY KEY (id),
  KEY idx_pps_node_time (poller_node_id, snapshot_at),
  CONSTRAINT fk_pps_node FOREIGN KEY (poller_node_id) REFERENCES poller_nodes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: alert_escalation_chains (migration 260 — §6.5 Alerting)
-- Purpose: Top-level escalation chain definitions for alert notifications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_escalation_chains (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NULL,
  name             VARCHAR(255)    NOT NULL,
  description      TEXT            NULL,
  deleted_at       DATETIME        NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aec_org (organization_id),
  CONSTRAINT fk_aec_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: alert_escalation_steps (migration 260 — §6.5 Alerting)
-- Purpose: Individual steps within an escalation chain (L1 -> L2 -> L3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_escalation_steps (
  id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  chain_id              BIGINT UNSIGNED  NOT NULL,
  step_number           TINYINT UNSIGNED NOT NULL COMMENT '1=L1, 2=L2, 3=L3',
  delay_minutes         INT UNSIGNED     NOT NULL DEFAULT 15,
  notification_channel  ENUM('email','sms','whatsapp','telegram','webhook') NOT NULL DEFAULT 'email',
  recipient_email       VARCHAR(255)     NULL,
  recipient_phone       VARCHAR(50)      NULL,
  webhook_url           VARCHAR(512)     NULL,
  message_template      TEXT             NULL,
  created_at            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_aes_chain_step (chain_id, step_number),
  KEY idx_aes_chain (chain_id),
  CONSTRAINT fk_aes_chain FOREIGN KEY (chain_id) REFERENCES alert_escalation_chains(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: maintenance_windows (migration 260 — §6.5 Alerting)
-- Purpose: Suppress alerts during planned maintenance work.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id             BIGINT UNSIGNED NULL,
  name                        VARCHAR(255)    NOT NULL,
  description                 TEXT            NULL,
  device_id                   BIGINT UNSIGNED NULL,
  site_id                     BIGINT UNSIGNED NULL,
  starts_at                   DATETIME        NOT NULL,
  ends_at                     DATETIME        NOT NULL,
  is_recurring                TINYINT(1)      NOT NULL DEFAULT 0,
  recurrence_cron             VARCHAR(50)     NULL,
  recurrence_duration_minutes INT UNSIGNED    NULL,
  status                      ENUM('scheduled','active','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  created_by                  BIGINT UNSIGNED NULL,
  deleted_at                  DATETIME        NULL,
  created_at                  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mw_org (organization_id),
  KEY idx_mw_time (organization_id, starts_at, ends_at),
  CONSTRAINT fk_mw_org    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_mw_device FOREIGN KEY (device_id)       REFERENCES devices(id)       ON DELETE SET NULL,
  CONSTRAINT fk_mw_site   FOREIGN KEY (site_id)         REFERENCES sites(id)         ON DELETE SET NULL,
  CONSTRAINT fk_mw_user   FOREIGN KEY (created_by)      REFERENCES users(id)         ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: alert_notification_channels (migration 260 — §6.5 Alerting)
-- Purpose: Multi-channel notification routing config; credentials AES-256 encrypted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_notification_channels (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NULL,
  name             VARCHAR(255)    NOT NULL,
  channel_type     ENUM('email','sms','whatsapp','telegram','webhook') NOT NULL,
  config_encrypted TEXT            NULL COMMENT 'JSON with channel-specific settings, AES-256-GCM encrypted',
  is_enabled       TINYINT(1)      NOT NULL DEFAULT 1,
  deleted_at       DATETIME        NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_anc_org (organization_id),
  CONSTRAINT fk_anc_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: alert_suppression_rules (migration 260 — §6.5 Alerting)
-- Purpose: Suppress downstream device alerts when upstream device is down.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_suppression_rules (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id           BIGINT UNSIGNED NULL,
  name                      VARCHAR(255)    NOT NULL,
  upstream_device_id        BIGINT UNSIGNED NULL,
  downstream_device_id      BIGINT UNSIGNED NULL,
  suppress_duration_minutes INT UNSIGNED    NOT NULL DEFAULT 60,
  is_enabled                TINYINT(1)      NOT NULL DEFAULT 1,
  deleted_at                DATETIME        NULL,
  created_at                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_asr_org (organization_id),
  CONSTRAINT fk_asr_org        FOREIGN KEY (organization_id)      REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_asr_upstream   FOREIGN KEY (upstream_device_id)   REFERENCES devices(id)       ON DELETE SET NULL,
  CONSTRAINT fk_asr_downstream FOREIGN KEY (downstream_device_id) REFERENCES devices(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: config_templates (migration 262 — §6.6 Config Management)
-- Purpose: Named configuration templates with {{variable}} placeholders for batch push.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_templates (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NULL,
  name             VARCHAR(255)    NOT NULL,
  description      TEXT            NULL,
  device_type      VARCHAR(50)     NULL,
  manufacturer     VARCHAR(100)    NULL,
  template_content LONGTEXT        NOT NULL,
  variables_schema JSON            NULL,
  status           ENUM('active','inactive','draft') NOT NULL DEFAULT 'active',
  deleted_at       DATETIME        NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ct_org (organization_id),
  CONSTRAINT fk_ct_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: config_deployment_records (migration 262 — §6.6 Config Management)
-- Purpose: Tracks config template push operations per device.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_deployment_records (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  template_id     BIGINT UNSIGNED NULL,
  device_id       BIGINT UNSIGNED NOT NULL,
  deployed_by     BIGINT UNSIGNED NULL,
  status          ENUM('pending','running','success','failed','rolled_back') NOT NULL DEFAULT 'pending',
  variables_used  JSON            NULL,
  result_output   TEXT            NULL,
  deployed_at     DATETIME        NULL,
  completed_at    DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cdr_org (organization_id),
  KEY idx_cdr_device (device_id),
  CONSTRAINT fk_cdr_org      FOREIGN KEY (organization_id) REFERENCES organizations(id)   ON DELETE CASCADE,
  CONSTRAINT fk_cdr_template FOREIGN KEY (template_id)     REFERENCES config_templates(id) ON DELETE SET NULL,
  CONSTRAINT fk_cdr_device   FOREIGN KEY (device_id)       REFERENCES devices(id)          ON DELETE CASCADE,
  CONSTRAINT fk_cdr_user     FOREIGN KEY (deployed_by)     REFERENCES users(id)             ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: config_backup_schedules (migration 262 — §6.6 Config Management)
-- Purpose: Per-device or per-org config backup schedules (extends global nightly task).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_backup_schedules (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  device_id       BIGINT UNSIGNED NULL COMMENT 'NULL = all org devices',
  schedule_name   VARCHAR(255)    NOT NULL,
  cron_expression VARCHAR(50)     NOT NULL DEFAULT '0 2 * * *',
  is_enabled      TINYINT(1)      NOT NULL DEFAULT 1,
  last_run_at     DATETIME        NULL,
  last_status     ENUM('success','failed','skipped') NULL,
  deleted_at      DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cbs_org (organization_id),
  CONSTRAINT fk_cbs_org    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_cbs_device FOREIGN KEY (device_id)       REFERENCES devices(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: config_compliance_rules (migration 262 — §6.6 Config Management)
-- Purpose: Rules to check device configs against (keyword/regex matching).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_compliance_rules (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id        BIGINT UNSIGNED NULL,
  name                   VARCHAR(255)    NOT NULL,
  description            TEXT            NULL,
  rule_type              ENUM('must_contain','must_not_contain','regex_match','regex_not_match') NOT NULL DEFAULT 'must_contain',
  pattern                TEXT            NOT NULL,
  severity               ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
  applies_to_device_type VARCHAR(50)     NULL,
  is_enabled             TINYINT(1)      NOT NULL DEFAULT 1,
  deleted_at             DATETIME        NULL,
  created_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ccr_org (organization_id),
  CONSTRAINT fk_ccr_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: config_compliance_results (migration 262 — §6.6 Config Management)
-- Purpose: Audit results when compliance rules are evaluated against a backup.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_compliance_results (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id      BIGINT UNSIGNED NOT NULL,
  backup_id    BIGINT UNSIGNED NOT NULL,
  device_id    BIGINT UNSIGNED NOT NULL,
  result       ENUM('pass','fail','error') NOT NULL DEFAULT 'fail',
  details      TEXT            NULL,
  evaluated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ccres_device_time (device_id, evaluated_at),
  KEY idx_ccres_rule_result (rule_id, result),
  CONSTRAINT fk_ccres_rule   FOREIGN KEY (rule_id)   REFERENCES config_compliance_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_ccres_backup FOREIGN KEY (backup_id) REFERENCES device_config_backups(id)   ON DELETE CASCADE,
  CONSTRAINT fk_ccres_device FOREIGN KEY (device_id) REFERENCES devices(id)                 ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: olt_ports
-- Purpose: Physical PON and uplink port inventory per OLT device (§7.1)
-- Migration: 266
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_ports (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL
                            COMMENT 'Tenant scoping — NULL = single-tenant deployment',
    olt_device_id       BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''olt'')',
    port_index          INT UNSIGNED    NOT NULL
                            COMMENT 'IF-MIB ifIndex or vendor PON slot/port index',
    port_name           VARCHAR(50)     NOT NULL
                            COMMENT 'Human-readable name, e.g. GPON 0/1/3',
    port_type           ENUM('gpon','epon','xgspon','uplink','cascade','other')
                            NOT NULL DEFAULT 'gpon',
    slot_no             TINYINT UNSIGNED NULL
                            COMMENT 'Board/slot number on the OLT chassis',
    port_no             TINYINT UNSIGNED NULL
                            COMMENT 'Port number within the slot',
    admin_status        ENUM('up','down') NOT NULL DEFAULT 'up'
                            COMMENT 'Administratively configured state',
    oper_status         ENUM('up','down','testing','unknown','notPresent','lowerLayerDown')
                            NOT NULL DEFAULT 'unknown'
                            COMMENT 'Current operational state from SNMP ifOperStatus',
    onu_count           SMALLINT UNSIGNED NULL DEFAULT 0
                            COMMENT 'Active ONUs registered on this PON port (polled)',
    max_onus            SMALLINT UNSIGNED NULL DEFAULT 128
                            COMMENT 'Maximum ONUs supported (1:128 splitter)',
    tx_power_dbm        DECIMAL(6,2)    NULL
                            COMMENT 'PON port Tx optical power in dBm (polled)',
    rx_power_dbm        DECIMAL(6,2)    NULL
                            COMMENT 'PON port Rx optical power in dBm (polled)',
    bandwidth_up_bps    BIGINT UNSIGNED NULL
                            COMMENT 'Uplink bandwidth utilization in bps (polled)',
    bandwidth_down_bps  BIGINT UNSIGNED NULL
                            COMMENT 'Downlink bandwidth utilization in bps (polled)',
    last_polled_at      DATETIME        NULL
                            COMMENT 'Last time port metrics were polled from device',
    notes               TEXT            NULL,
    maintenance_mode    TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Port shut down for maintenance (migration 270)',
    maintenance_note    VARCHAR(255)    NULL COMMENT 'Reason for maintenance shutdown (migration 270)',
    maintenance_by      BIGINT UNSIGNED NULL COMMENT 'User who set maintenance mode (migration 270)',
    maintenance_at      DATETIME        NULL COMMENT 'When maintenance mode was set (migration 270)',
    xgspon_mode         ENUM('gpon','xgspon_2_5g','xgspon_10g','auto','none') NOT NULL DEFAULT 'none' COMMENT 'XGS-PON sub-mode for dual-mode GPON/XGS-PON ports (migration 270)',
    xgspon_mode_validated TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'Mode validated against olt_vendor_capabilities (migration 270)',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_olt_ports_device_port (olt_device_id, port_index),
    KEY idx_olt_ports_organization_id (organization_id),
    KEY idx_olt_ports_olt_device_id (olt_device_id),
    KEY idx_olt_ports_port_type (port_type),
    KEY idx_olt_ports_oper_status (oper_status),
    KEY idx_olt_ports_deleted_at (deleted_at),
    CONSTRAINT fk_olt_ports_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_olt_ports_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='PON and uplink port inventory per OLT (§7.1/§7.3)';

-- ---------------------------------------------------------------------------
-- Table: onu_profiles
-- Purpose: PON service profile templates (T-CONT/GEM/DBA/VLAN) (§7.2)
-- Migration: 266
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_profiles (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL,
    technology          ENUM('gpon','epon','xgspon','other')
                            NOT NULL DEFAULT 'gpon',
    -- T-CONT / DBA
    tcont_id            TINYINT UNSIGNED NULL
                            COMMENT 'T-CONT index (GPON/XGSPON)',
    dba_profile_name    VARCHAR(100)    NULL
                            COMMENT 'Bandwidth assurance profile name on OLT',
    assured_bw_kbps     INT UNSIGNED    NULL
                            COMMENT 'Assured bandwidth in kbps (DBA type 3/4)',
    max_bw_kbps         INT UNSIGNED    NULL
                            COMMENT 'Maximum/peak bandwidth in kbps',
    -- GEM port
    gem_port_id         SMALLINT UNSIGNED NULL
                            COMMENT 'GEM port ID for service traffic (0-4095)',
    -- VLAN mapping
    service_vlan        SMALLINT UNSIGNED NULL
                            COMMENT 'S-VLAN (outer tag) for this service profile',
    client_vlan         SMALLINT UNSIGNED NULL
                            COMMENT 'C-VLAN (inner tag) for this service profile',
    vlan_mode           ENUM('transparent','tag','translate','double_tag','untagged')
                            NOT NULL DEFAULT 'tag',
    -- Service plan linkage
    plan_id             BIGINT UNSIGNED NULL
                            COMMENT 'Service plan associated with this PON profile',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_onu_profiles_org_name (organization_id, name),
    KEY idx_onu_profiles_organization_id (organization_id),
    KEY idx_onu_profiles_technology (technology),
    KEY idx_onu_profiles_plan_id (plan_id),
    KEY idx_onu_profiles_deleted_at (deleted_at),
    CONSTRAINT fk_onu_profiles_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_profiles_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='PON service profile templates (T-CONT/GEM/DBA/VLAN) (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_details
-- Purpose: GPON/EPON ONU detail extension to devices (§7.2)
-- Migration: 266
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_details (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    device_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''onu'') — the ONU device',
    olt_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'') — the parent OLT',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports — the PON port this ONU is on',
    onu_profile_id      BIGINT UNSIGNED NULL
                            COMMENT 'FK to onu_profiles — active service profile',
    -- Registration identity
    serial_number       VARCHAR(20)     NULL
                            COMMENT 'ONU serial number in PLOAM/OMCI format (e.g. HWTC1A2B3C4D)',
    loid                VARCHAR(64)     NULL
                            COMMENT 'Logical ONU ID used for LOID authentication',
    loid_password_encrypted VARCHAR(255) NULL
                            COMMENT 'LOID password — AES-256 encrypted at app layer',
    -- ONU status (polled or pushed via trap)
    onu_state           ENUM('online','offline','los','dying_gasp','power_off','loc','unconfigured','unknown')
                            NOT NULL DEFAULT 'unknown'
                            COMMENT 'Current PON layer operational state of the ONU',
    last_status_at      DATETIME        NULL
                            COMMENT 'Timestamp of last status update',
    -- OLT-assigned addressing
    onu_id              SMALLINT UNSIGNED NULL
                            COMMENT 'OLT-assigned ONU identifier (0-127 on GPON)',
    ranging_distance_m  INT UNSIGNED    NULL
                            COMMENT 'ONU distance measured by OLT ranging in metres',
    -- Vendor profile references (CLI/NETCONF template names stored on the OLT)
    line_profile_name   VARCHAR(100)    NULL
                            COMMENT 'OLT line-profile name assigned to this ONU',
    service_profile_name VARCHAR(100)   NULL
                            COMMENT 'OLT service-profile name assigned to this ONU',
    -- Bridge/Router mode
    wan_mode            ENUM('bridge','router','mixed')
                            NOT NULL DEFAULT 'bridge'
                            COMMENT 'ONU WAN forwarding mode',
    -- Pending provision job reference
    last_provision_job_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to onu_firmware_jobs — last provision/config job',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_onu_details_device_id (device_id),
    KEY idx_onu_details_organization_id (organization_id),
    KEY idx_onu_details_olt_device_id (olt_device_id),
    KEY idx_onu_details_olt_port_id (olt_port_id),
    KEY idx_onu_details_onu_profile_id (onu_profile_id),
    KEY idx_onu_details_onu_state (onu_state),
    KEY idx_onu_details_serial_number (serial_number),
    KEY idx_onu_details_deleted_at (deleted_at),
    CONSTRAINT fk_onu_details_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_details_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_onu_details_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_details_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_details_onu_profile FOREIGN KEY (onu_profile_id)
        REFERENCES onu_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='GPON/EPON ONU detail extension to devices (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_optical_metrics
-- Purpose: Per-ONU optical diagnostic time-series (§7.2)
-- Migration: 266
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_optical_metrics (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    device_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''onu'')',
    olt_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'')',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports',
    polled_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT 'Timestamp of the measurement',
    -- Optical power (0.01 dBm resolution)
    tx_power_dbm        DECIMAL(6,2)    NULL COMMENT 'ONU Tx optical power (dBm)',
    rx_power_dbm        DECIMAL(6,2)    NULL COMMENT 'ONU Rx optical power at OLT (dBm)',
    -- Laser diagnostics (SFP DDM / OMCI)
    temperature_c       DECIMAL(6,2)    NULL COMMENT 'Laser temperature in °C',
    voltage_v           DECIMAL(6,3)    NULL COMMENT 'Laser supply voltage in V',
    bias_current_ma     DECIMAL(8,3)    NULL COMMENT 'Laser bias current in mA',
    -- OLT-side Rx power for this ONU (from HUAWEI-XPON-MIB or ZTE MIB)
    olt_rx_power_dbm    DECIMAL(6,2)    NULL COMMENT 'OLT-side Rx optical power (dBm)',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_onu_optical_device_polled (device_id, polled_at DESC),
    KEY idx_onu_optical_organization (organization_id),
    KEY idx_onu_optical_olt_port (olt_port_id),
    KEY idx_onu_optical_polled_at (polled_at)
    -- No FKs: high-write metrics table (same pattern as snmp_metrics).
    -- Org-id stored for filtering; olt_port_id stored for queries.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-ONU optical diagnostic time-series (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_whitelist
-- Purpose: ONU MAC/SN allow-block list per OLT (§7.2)
-- Migration: 266
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_whitelist (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    olt_device_id       BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''olt'') owning this list',
    entry_type          ENUM('mac','serial_number') NOT NULL DEFAULT 'serial_number',
    entry_value         VARCHAR(64)     NOT NULL
                            COMMENT 'MAC address (XX:XX:XX:XX:XX:XX) or SN string',
    list_type           ENUM('allow','block') NOT NULL DEFAULT 'allow',
    device_id           BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''onu'') if already provisioned',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_onu_whitelist_olt_entry (olt_device_id, entry_type, entry_value),
    KEY idx_onu_whitelist_organization_id (organization_id),
    KEY idx_onu_whitelist_olt_device_id (olt_device_id),
    KEY idx_onu_whitelist_list_type (list_type),
    KEY idx_onu_whitelist_device_id (device_id),
    KEY idx_onu_whitelist_deleted_at (deleted_at),
    CONSTRAINT fk_onu_whitelist_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_whitelist_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_onu_whitelist_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ONU MAC/SN allow-block list per OLT (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_omci_configs
-- Purpose: OMCI/TR-069 Wi-Fi and WAN config records per ONU (§7.2)
-- Migration: 266
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_omci_configs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    device_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''onu'')',
    -- Config classification
    config_type         ENUM('wifi','wan','lan','voip','omci_raw','tr069','other')
                            NOT NULL DEFAULT 'wifi',
    -- Wi-Fi
    wifi_ssid           VARCHAR(64)     NULL,
    wifi_password_encrypted VARCHAR(512) NULL
                            COMMENT 'Wi-Fi PSK — AES-256 encrypted at app layer',
    wifi_band           ENUM('2.4ghz','5ghz','both') NULL DEFAULT 'both',
    wifi_channel        TINYINT UNSIGNED NULL,
    wifi_security       ENUM('open','wep','wpa2','wpa3') NULL DEFAULT 'wpa2',
    -- WAN mode
    wan_mode            ENUM('bridge','router','mixed') NULL,
    wan_ip_mode         ENUM('dhcp','static','pppoe') NULL,
    wan_ip_address      VARCHAR(45)     NULL,
    wan_netmask         VARCHAR(45)     NULL,
    wan_gateway         VARCHAR(45)     NULL,
    -- Delivery
    delivery_method     ENUM('omci','tr069','ssh_cli','manual','pending')
                            NOT NULL DEFAULT 'pending',
    applied_at          DATETIME        NULL
                            COMMENT 'Timestamp when this config was successfully pushed',
    apply_status        ENUM('pending','in_progress','applied','failed','superseded')
                            NOT NULL DEFAULT 'pending',
    apply_error         TEXT            NULL,
    -- Raw config blob for custom OMCI ME sequences or TR-069 parameter sets
    raw_config          JSON            NULL,
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_onu_omci_configs_organization_id (organization_id),
    KEY idx_onu_omci_configs_device_id (device_id),
    KEY idx_onu_omci_configs_config_type (config_type),
    KEY idx_onu_omci_configs_apply_status (apply_status),
    KEY idx_onu_omci_configs_deleted_at (deleted_at),
    CONSTRAINT fk_onu_omci_configs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_omci_configs_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OMCI / TR-069 Wi-Fi and WAN config records per ONU (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: onu_firmware_jobs
-- Purpose: ONU firmware upgrade and reboot job scheduler (§7.2)
-- Migration: 266
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_firmware_jobs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    job_type            ENUM('firmware_upgrade','reboot','provision','factory_reset','other')
                            NOT NULL DEFAULT 'firmware_upgrade',
    -- Scope: either a single ONU, or all ONUs on a PON port, or all under an OLT
    scope               ENUM('single_onu','olt_port','olt_device','region','all')
                            NOT NULL DEFAULT 'single_onu',
    onu_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''onu'') for single-ONU scope',
    olt_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'') for OLT-level scope',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports for PON-port-level scope',
    -- Firmware details (firmware_upgrade jobs)
    firmware_version    VARCHAR(100)    NULL
                            COMMENT 'Target firmware version string',
    firmware_url        VARCHAR(1024)   NULL
                            COMMENT 'HTTP/TFTP URL to firmware image',
    -- Scheduling
    scheduled_at        DATETIME        NULL
                            COMMENT 'Scheduled start time; NULL = execute immediately',
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    -- Status tracking
    status              ENUM('pending','queued','in_progress','completed','failed','cancelled','partial')
                            NOT NULL DEFAULT 'pending',
    total_devices       INT UNSIGNED    NULL DEFAULT 0,
    completed_devices   INT UNSIGNED    NULL DEFAULT 0,
    failed_devices      INT UNSIGNED    NULL DEFAULT 0,
    result_summary      JSON            NULL
                            COMMENT 'Per-ONU result map { "device_id": "status" }',
    error_message       TEXT            NULL,
    -- Created by
    created_by          BIGINT UNSIGNED NULL
                            COMMENT 'FK to users — operator who created this job',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_onu_firmware_jobs_organization_id (organization_id),
    KEY idx_onu_firmware_jobs_onu_device_id (onu_device_id),
    KEY idx_onu_firmware_jobs_olt_device_id (olt_device_id),
    KEY idx_onu_firmware_jobs_olt_port_id (olt_port_id),
    KEY idx_onu_firmware_jobs_status (status),
    KEY idx_onu_firmware_jobs_scheduled_at (scheduled_at),
    KEY idx_onu_firmware_jobs_deleted_at (deleted_at),
    CONSTRAINT fk_onu_firmware_jobs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_firmware_jobs_onu_device FOREIGN KEY (onu_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_firmware_jobs_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_firmware_jobs_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_firmware_jobs_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ONU firmware upgrade and reboot job scheduler (§7.2)';

-- ---------------------------------------------------------------------------
-- Table: olt_vendor_capabilities
-- Purpose: Per-vendor OLT management capability matrix (§7.1)
-- Migration: 267
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_vendor_capabilities (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    vendor              VARCHAR(50)     NOT NULL
                            COMMENT 'e.g. Huawei, ZTE, VSOL, C-Data, WOLCK, Calix',
    model_pattern       VARCHAR(100)    NOT NULL
                            COMMENT 'SQL LIKE pattern matching device.model, e.g. MA5800%',
    -- Supported management protocols (bitmask stored as JSON array)
    protocols           JSON            NOT NULL
                            COMMENT 'Array of protocols: ["snmp","tl1","netconf","ssh_cli"]',
    snmp_profile_name   VARCHAR(100)    NULL
                            COMMENT 'Matches snmp_profiles.name for this vendor',
    -- CLI template references (config_templates.name)
    provision_template  VARCHAR(100)    NULL
                            COMMENT 'config_templates.name for ONU provisioning CLI',
    firmware_template   VARCHAR(100)    NULL
                            COMMENT 'config_templates.name for firmware upgrade CLI',
    reboot_template     VARCHAR(100)    NULL
                            COMMENT 'config_templates.name for ONU reboot CLI',
    -- NETCONF / TL1 stubs
    netconf_schema      VARCHAR(255)    NULL
                            COMMENT 'Path/URI to YANG schema for this vendor',
    tl1_command_set     VARCHAR(50)     NULL
                            COMMENT 'TL1 dialect variant identifier',
    -- OMCI support
    omci_supported      TINYINT(1)      NOT NULL DEFAULT 0,
    -- Private MIB root OID
    enterprise_oid      VARCHAR(100)    NULL
                            COMMENT 'Root enterprise OID, e.g. 1.3.6.1.4.1.2011 (Huawei)',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_olt_vendor_model (vendor, model_pattern),
    KEY idx_olt_vendor_capabilities_vendor (vendor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-vendor OLT management capability matrix (§7.1)';

-- ---------------------------------------------------------------------------
-- Table: olt_splitters
-- Purpose: PON splitter inventory (§7.1 splitter management)
-- Migration: 267
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_splitters (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL,
    site_id             BIGINT UNSIGNED NULL
                            COMMENT 'Physical site where this splitter is installed',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'Upstream PON port this splitter is connected to',
    ratio               ENUM('1:2','1:4','1:8','1:16','1:32','1:64','1:128')
                            NOT NULL DEFAULT '1:32',
    splitter_type       ENUM('optical','wdm','other') NOT NULL DEFAULT 'optical',
    location_detail     VARCHAR(255)    NULL
                            COMMENT 'Specific location: pole, cabinet, ODF row/column',
    installed_at        DATE            NULL,
    status              ENUM('active','inactive','damaged','removed') NOT NULL DEFAULT 'active',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_olt_splitters_organization_id (organization_id),
    KEY idx_olt_splitters_site_id (site_id),
    KEY idx_olt_splitters_olt_port_id (olt_port_id),
    KEY idx_olt_splitters_ratio (ratio),
    KEY idx_olt_splitters_status (status),
    KEY idx_olt_splitters_deleted_at (deleted_at),
    CONSTRAINT fk_olt_splitters_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_olt_splitters_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_olt_splitters_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='PON splitter inventory (§7.1 splitter management)';

-- ---------------------------------------------------------------------------
-- Table: onu_migration_jobs
-- Purpose: ONU port migration job records — transactional port reassignment (§7.3)
-- Migration: 270
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_migration_jobs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    onu_device_id       BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to devices (type=''onu'') being migrated',
    source_olt_port_id  BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to olt_ports — current OLT port of the ONU',
    target_olt_port_id  BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to olt_ports — destination OLT port',
    source_olt_device_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'') — source OLT',
    target_olt_device_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'') — destination OLT',
    -- Job lifecycle
    status              ENUM('pending','in_progress','completed','failed','cancelled')
                            NOT NULL DEFAULT 'pending',
    scheduled_at        DATETIME        NULL
                            COMMENT 'Planned migration time; NULL = immediate',
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    -- Result detail
    error_message       TEXT            NULL,
    result_detail       JSON            NULL
                            COMMENT 'Per-step results from the driver',
    -- Audit
    created_by          BIGINT UNSIGNED NULL
                            COMMENT 'FK to users — operator who requested migration',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_onu_migration_jobs_organization_id (organization_id),
    KEY idx_onu_migration_jobs_onu_device_id (onu_device_id),
    KEY idx_onu_migration_jobs_source_port (source_olt_port_id),
    KEY idx_onu_migration_jobs_target_port (target_olt_port_id),
    KEY idx_onu_migration_jobs_status (status),
    KEY idx_onu_migration_jobs_scheduled_at (scheduled_at),
    KEY idx_onu_migration_jobs_deleted_at (deleted_at),
    CONSTRAINT fk_onu_migration_jobs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_onu_device FOREIGN KEY (onu_device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_source_port FOREIGN KEY (source_olt_port_id)
        REFERENCES olt_ports (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_target_port FOREIGN KEY (target_olt_port_id)
        REFERENCES olt_ports (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_source_olt FOREIGN KEY (source_olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_target_olt FOREIGN KEY (target_olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_onu_migration_jobs_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ONU migration job records (§7.3)';

-- ---------------------------------------------------------------------------
-- Table: fiber_routes
-- Purpose: Fiber route path records from CO to splitter to ONU (§7.4)
-- Migration: 272
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiber_routes (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL
                            COMMENT 'Human-readable segment name, e.g. "CO-1 → SPL-034"',
    route_type          ENUM('trunk','distribution','drop','feeder','other')
                            NOT NULL DEFAULT 'drop'
                            COMMENT 'Segment class in the PON fiber hierarchy',
    parent_route_id     BIGINT UNSIGNED NULL
                            COMMENT 'FK to fiber_routes — parent trunk segment (nullable)',
    -- Endpoints
    from_device_id      BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices — upstream device (OLT or intermediate)',
    from_olt_port_id    BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports — upstream PON port (for trunk routes)',
    from_splitter_id    BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_splitters — upstream splitter (for distribution routes)',
    to_device_id        BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices — downstream device (splitter premise or ONU)',
    to_splitter_id      BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_splitters — downstream splitter',
    to_onu_detail_id    BIGINT UNSIGNED NULL
                            COMMENT 'FK to onu_details — terminal ONU on this drop',
    -- Physical attributes
    cable_length_m      INT UNSIGNED    NULL
                            COMMENT 'Fiber cable length in metres (measured or estimated)',
    cable_type          VARCHAR(50)     NULL
                            COMMENT 'Fiber cable spec, e.g. G.652D, G.657A2',
    attenuation_db      DECIMAL(6,3)    NULL
                            COMMENT 'Measured or calculated span attenuation in dB',
    -- Installation
    installed_at        DATE            NULL,
    status              ENUM('active','inactive','damaged','removed') NOT NULL DEFAULT 'active',
    gis_path            JSON            NULL
                            COMMENT 'GeoJSON LineString of the cable route (for map display)',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_fiber_routes_organization_id (organization_id),
    KEY idx_fiber_routes_parent_route_id (parent_route_id),
    KEY idx_fiber_routes_from_device_id (from_device_id),
    KEY idx_fiber_routes_from_olt_port_id (from_olt_port_id),
    KEY idx_fiber_routes_from_splitter_id (from_splitter_id),
    KEY idx_fiber_routes_to_device_id (to_device_id),
    KEY idx_fiber_routes_to_splitter_id (to_splitter_id),
    KEY idx_fiber_routes_to_onu_detail_id (to_onu_detail_id),
    KEY idx_fiber_routes_status (status),
    KEY idx_fiber_routes_deleted_at (deleted_at),
    CONSTRAINT fk_fiber_routes_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_parent FOREIGN KEY (parent_route_id)
        REFERENCES fiber_routes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_from_device FOREIGN KEY (from_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_from_olt_port FOREIGN KEY (from_olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_from_splitter FOREIGN KEY (from_splitter_id)
        REFERENCES olt_splitters (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_to_device FOREIGN KEY (to_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_to_splitter FOREIGN KEY (to_splitter_id)
        REFERENCES olt_splitters (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_fiber_routes_to_onu FOREIGN KEY (to_onu_detail_id)
        REFERENCES onu_details (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Fiber plant route records (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: odf_frames
-- Purpose: Optical Distribution Frame physical inventory (§7.4)
-- Migration: 272
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS odf_frames (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL
                            COMMENT 'ODF frame identifier, e.g. "ODF-CO1-R01"',
    site_id             BIGINT UNSIGNED NULL
                            COMMENT 'FK to sites — physical location of this ODF frame',
    frame_type          ENUM('rack','wall_mount','splice_closure','patch_panel','other')
                            NOT NULL DEFAULT 'rack',
    port_count          SMALLINT UNSIGNED NOT NULL DEFAULT 12
                            COMMENT 'Total port capacity of this frame',
    fiber_type          ENUM('sm','mm','om3','om4','other') NOT NULL DEFAULT 'sm'
                            COMMENT 'Fiber type: SM = single-mode, MM = multi-mode',
    connector_type      ENUM('sc','lc','fc','st','mtp','other') NOT NULL DEFAULT 'sc',
    installed_at        DATE            NULL,
    status              ENUM('active','inactive','decommissioned') NOT NULL DEFAULT 'active',
    location_detail     VARCHAR(255)    NULL
                            COMMENT 'Rack row/column or cabinet position',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_odf_frames_organization_id (organization_id),
    KEY idx_odf_frames_site_id (site_id),
    KEY idx_odf_frames_status (status),
    KEY idx_odf_frames_deleted_at (deleted_at),
    CONSTRAINT fk_odf_frames_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_odf_frames_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ODF frame inventory (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: odf_ports
-- Purpose: Individual ODF port records within an ODF frame (§7.4)
-- Migration: 272
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS odf_ports (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    odf_frame_id        BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to odf_frames — parent frame',
    port_number         SMALLINT UNSIGNED NOT NULL
                            COMMENT 'Port position in the frame (1-based)',
    port_label          VARCHAR(50)     NULL
                            COMMENT 'Physical label on the port, e.g. "P-01-A"',
    port_status         ENUM('empty','connected','dirty','damaged','reserved')
                            NOT NULL DEFAULT 'empty',
    -- What is connected to this port
    connected_device_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices — device whose fiber terminates here',
    cable_label         VARCHAR(100)    NULL
                            COMMENT 'Cable/tube label for tracing',
    splitter_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_splitters — if this port feeds a splitter',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_odf_ports_frame_port (odf_frame_id, port_number),
    KEY idx_odf_ports_organization_id (organization_id),
    KEY idx_odf_ports_odf_frame_id (odf_frame_id),
    KEY idx_odf_ports_port_status (port_status),
    KEY idx_odf_ports_connected_device_id (connected_device_id),
    KEY idx_odf_ports_splitter_id (splitter_id),
    KEY idx_odf_ports_deleted_at (deleted_at),
    CONSTRAINT fk_odf_ports_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_odf_ports_frame FOREIGN KEY (odf_frame_id)
        REFERENCES odf_frames (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_odf_ports_device FOREIGN KEY (connected_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_odf_ports_splitter FOREIGN KEY (splitter_id)
        REFERENCES olt_splitters (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ODF port records within an ODF frame (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: odf_cross_connects
-- Purpose: Cross-connect patch records between two ODF ports (§7.4)
-- Migration: 272
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS odf_cross_connects (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    port_a_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to odf_ports — first end of the cross-connect',
    port_b_id           BIGINT UNSIGNED NOT NULL
                            COMMENT 'FK to odf_ports — second end of the cross-connect',
    patch_cord_label    VARCHAR(100)    NULL
                            COMMENT 'Color or label of the patch cord',
    patch_cord_length_m DECIMAL(6,1)   NULL
                            COMMENT 'Physical patch cord length in metres',
    installed_at        DATE            NULL,
    status              ENUM('active','inactive','removed') NOT NULL DEFAULT 'active',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_odf_cross_connects_organization_id (organization_id),
    KEY idx_odf_cross_connects_port_a_id (port_a_id),
    KEY idx_odf_cross_connects_port_b_id (port_b_id),
    KEY idx_odf_cross_connects_status (status),
    KEY idx_odf_cross_connects_deleted_at (deleted_at),
    CONSTRAINT fk_odf_cross_connects_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_odf_cross_connects_port_a FOREIGN KEY (port_a_id)
        REFERENCES odf_ports (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_odf_cross_connects_port_b FOREIGN KEY (port_b_id)
        REFERENCES odf_ports (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ODF cross-connect patch records (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: otdr_test_results
-- Purpose: OTDR test result records and fault location storage (§7.4)
-- Migration: 272
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otdr_test_results (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    -- What was tested
    fiber_route_id      BIGINT UNSIGNED NULL
                            COMMENT 'FK to fiber_routes — route under test',
    olt_port_id         BIGINT UNSIGNED NULL
                            COMMENT 'FK to olt_ports — PON port under test (alternate)',
    olt_device_id       BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices (type=''olt'')',
    -- Test context
    test_type           ENUM('manual','scheduled','fault_locate','baseline','acceptance')
                            NOT NULL DEFAULT 'manual',
    -- Test parameters
    wavelength_nm       SMALLINT UNSIGNED NULL
                            COMMENT 'Test wavelength in nm, e.g. 1310, 1490, 1550, 1625',
    pulse_width_ns      INT UNSIGNED    NULL
                            COMMENT 'Pulse width in nanoseconds',
    range_m             INT UNSIGNED    NULL
                            COMMENT 'Test range in metres',
    -- Results
    total_loss_db       DECIMAL(6,3)    NULL
                            COMMENT 'Total fiber span loss in dB',
    total_length_m      INT UNSIGNED    NULL
                            COMMENT 'Measured fiber length in metres (OFS distance)',
    -- Fault location (if test_type=fault_locate)
    fault_detected      TINYINT(1)      NOT NULL DEFAULT 0,
    fault_distance_m    INT UNSIGNED    NULL
                            COMMENT 'Fault location in metres from launch point',
    fault_type          ENUM('reflection','break','high_splice','end_of_fiber','unknown') NULL,
    -- Full event table (splices, connectors, reflections)
    events              JSON            NULL
                            COMMENT 'Array of OTDR event objects: [{distance_m, loss_db, type}]',
    -- SOR file reference (uploaded binary, stored as file path or object-store key)
    sor_file_path       VARCHAR(512)    NULL
                            COMMENT 'Path/key to the .SOR trace file',
    -- Scheduling (for job-dispatched tests — live OTDR I/O is stubbed)
    job_status          ENUM('pending','in_progress','completed','failed','imported')
                            NOT NULL DEFAULT 'imported'
                            COMMENT 'Status of the test acquisition job',
    tested_at           DATETIME        NULL
                            COMMENT 'When the test was actually performed',
    tested_by           BIGINT UNSIGNED NULL
                            COMMENT 'FK to users — technician who ran the test',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_otdr_test_results_organization_id (organization_id),
    KEY idx_otdr_test_results_fiber_route_id (fiber_route_id),
    KEY idx_otdr_test_results_olt_port_id (olt_port_id),
    KEY idx_otdr_test_results_olt_device_id (olt_device_id),
    KEY idx_otdr_test_results_fault_detected (fault_detected),
    KEY idx_otdr_test_results_tested_at (tested_at),
    KEY idx_otdr_test_results_deleted_at (deleted_at),
    CONSTRAINT fk_otdr_test_results_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_otdr_test_results_fiber_route FOREIGN KEY (fiber_route_id)
        REFERENCES fiber_routes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_otdr_test_results_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_otdr_test_results_olt_device FOREIGN KEY (olt_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_otdr_test_results_tested_by FOREIGN KEY (tested_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OTDR test results and fault location records (§7.4)';

-- ---------------------------------------------------------------------------
-- Table: sfp_inventory
-- Purpose: SFP transceiver lifecycle tracking and DDM diagnostics (§7.4)
-- Migration: 272
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sfp_inventory (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    -- Identification
    serial_number       VARCHAR(64)     NULL
                            COMMENT 'SFP/SFP+ module serial number',
    vendor_name         VARCHAR(64)     NULL
                            COMMENT 'Transceiver vendor (from SFP EEPROM)',
    part_number         VARCHAR(64)     NULL
                            COMMENT 'Vendor part number',
    form_factor         ENUM('sfp','sfp_plus','sfp28','qsfp','qsfp_plus','xfp','gbic','other')
                            NOT NULL DEFAULT 'sfp',
    fiber_type          ENUM('sm','mm','copper') NOT NULL DEFAULT 'sm',
    wavelength_nm       SMALLINT UNSIGNED NULL
                            COMMENT 'Nominal wavelength in nm (e.g. 1310, 1490, 1550)',
    max_distance_m      INT UNSIGNED    NULL
                            COMMENT 'Rated maximum distance in metres',
    speed_gbps          DECIMAL(6,1)    NULL
                            COMMENT 'Rated speed in Gbps (e.g. 1.0, 10.0, 25.0)',
    -- Lifecycle
    lifecycle_status    ENUM('in_stock','installed','removed','failed','retired')
                            NOT NULL DEFAULT 'in_stock',
    installed_device_id BIGINT UNSIGNED NULL
                            COMMENT 'FK to devices — device this SFP is currently in',
    port_name           VARCHAR(50)     NULL
                            COMMENT 'Port/interface name on the device, e.g. "0/0/1"',
    installed_at        DATE            NULL,
    removed_at          DATE            NULL,
    failure_reason      TEXT            NULL,
    -- Catalog linkage (optional)
    inventory_item_id   BIGINT UNSIGNED NULL
                            COMMENT 'FK to inventory_items — catalog entry for cost tracking',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_sfp_inventory_organization_id (organization_id),
    KEY idx_sfp_inventory_serial_number (serial_number),
    KEY idx_sfp_inventory_lifecycle_status (lifecycle_status),
    KEY idx_sfp_inventory_installed_device_id (installed_device_id),
    KEY idx_sfp_inventory_inventory_item_id (inventory_item_id),
    KEY idx_sfp_inventory_deleted_at (deleted_at),
    CONSTRAINT fk_sfp_inventory_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_sfp_inventory_device FOREIGN KEY (installed_device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_sfp_inventory_item FOREIGN KEY (inventory_item_id)
        REFERENCES inventory_items (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SFP transceiver lifecycle and DDM diagnostics (§7.4)';

-- ---------------------------------------------------------------------------
-- §8.1 CPE Device Registry (migration 274)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpe_devices (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    serial_number       VARCHAR(64)     NOT NULL,
    oui                 VARCHAR(6)      NOT NULL COMMENT 'OUI from CWMP DeviceId.OUI (6 hex chars)',
    product_class       VARCHAR(64)     NULL,
    hardware_version    VARCHAR(64)     NULL,
    software_version    VARCHAR(64)     NULL,
    firmware_version    VARCHAR(64)     NULL,
    manufacturer        VARCHAR(100)    NULL,
    model_name          VARCHAR(100)    NULL,
    acs_username        VARCHAR(100)    NULL,
    acs_password_hash   VARCHAR(255)    NULL,
    device_id           BIGINT UNSIGNED NULL COMMENT 'FK to devices table (indoor_cpe/outdoor_cpe types)',
    contract_id         BIGINT UNSIGNED NULL,
    cpe_profile_id      BIGINT UNSIGNED NULL COMMENT 'FK to cpe_profiles, added in migration 276',
    status              ENUM('new','provisioning','active','error','offline') NOT NULL DEFAULT 'new',
    last_inform_at      DATETIME        NULL,
    last_inform_ip      VARCHAR(45)     NULL,
    wan_ip              VARCHAR(45)     NULL,
    lan_subnet          VARCHAR(18)     NULL,
    wifi_ssid           VARCHAR(64)     NULL,
    notes               TEXT            NULL,
    lifecycle_state     ENUM('in_stock','assigned','active','returned','rma') NOT NULL DEFAULT 'in_stock'
                            COMMENT 'CPE lifecycle: in_stock→assigned→active→returned|rma',
    subscriber_id       BIGINT UNSIGNED NULL COMMENT 'FK to clients — subscriber this CPE is assigned to',
    subscriber_linked_at DATETIME       NULL COMMENT 'When subscriber_id was last set (auto-link or manual)',
    purchase_cost       DECIMAL(12,2)   NULL COMMENT 'Original purchase cost for depreciation calculation',
    purchase_date       DATE            NULL COMMENT 'Purchase date — depreciation start',
    depreciation_method ENUM('straight_line','declining_balance','none') NOT NULL DEFAULT 'none'
                            COMMENT 'Depreciation method applied to this device',
    useful_life_months  SMALLINT UNSIGNED NULL DEFAULT 60 COMMENT 'Expected useful life in months',
    salvage_value       DECIMAL(12,2)   NULL DEFAULT 0.00 COMMENT 'Residual/salvage value at end of useful life',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cpe_devices_serial_oui (serial_number, oui),
    KEY idx_cpe_devices_organization_id (organization_id),
    KEY idx_cpe_devices_status (status),
    KEY idx_cpe_devices_device_id (device_id),
    KEY idx_cpe_devices_contract_id (contract_id),
    KEY idx_cpe_devices_cpe_profile_id (cpe_profile_id),
    KEY idx_cpe_devices_subscriber (subscriber_id),
    KEY idx_cpe_devices_deleted_at (deleted_at),
    CONSTRAINT fk_cpe_devices_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_devices_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_devices_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_devices_subscriber FOREIGN KEY (subscriber_id) REFERENCES clients(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='TR-069/CWMP CPE device registry (§8.1)';

CREATE TABLE IF NOT EXISTS cpe_parameters (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cpe_device_id       BIGINT UNSIGNED NOT NULL,
    organization_id     BIGINT UNSIGNED NULL,
    parameter_path      VARCHAR(512)    NOT NULL COMMENT 'TR-069 parameter path e.g. Device.WiFi.SSID.1.SSID',
    parameter_value     TEXT            NULL,
    is_writable         TINYINT(1)      NOT NULL DEFAULT 0,
    last_fetched_at     DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cpe_param (cpe_device_id, parameter_path(255)),
    KEY idx_cpe_parameters_org (organization_id),
    KEY idx_cpe_parameters_cpe (cpe_device_id),
    CONSTRAINT fk_cpe_parameters_device FOREIGN KEY (cpe_device_id) REFERENCES cpe_devices(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_parameters_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='TR-069 parameter tree per CPE (§8.1)';

CREATE TABLE IF NOT EXISTS cpe_tasks (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    cpe_device_id       BIGINT UNSIGNED NOT NULL,
    task_type           ENUM('get_parameter_values','set_parameter_values','get_parameter_names','download','reboot','factory_reset','add_object','delete_object','ping_diagnostic','traceroute_diagnostic','wifi_diagnostics','wan_diagnostics') NOT NULL,
    parameters          JSON            NULL COMMENT 'For set: [{path, value}], for get: [path,...], for download: {url, fileType, fileSize}',
    status              ENUM('queued','in_progress','done','failed') NOT NULL DEFAULT 'queued',
    priority            TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '1=highest 10=lowest',
    result              JSON            NULL,
    error_message       TEXT            NULL,
    created_by          BIGINT UNSIGNED NULL,
    queued_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cpe_tasks_org (organization_id),
    KEY idx_cpe_tasks_device_status (cpe_device_id, status),
    KEY idx_cpe_tasks_status (status),
    CONSTRAINT fk_cpe_tasks_device FOREIGN KEY (cpe_device_id) REFERENCES cpe_devices(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_tasks_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_tasks_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Queued CWMP tasks per CPE device (§8.1)';

-- ---------------------------------------------------------------------------
-- §8.2 CPE Profiles, Mappings, Firmware (migration 275)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpe_profiles (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NULL,
    name                    VARCHAR(100)    NOT NULL,
    description             TEXT            NULL,
    parent_profile_id       BIGINT UNSIGNED NULL COMMENT 'NULL = base profile; non-null = child that inherits+overrides',
    plan_id                 BIGINT UNSIGNED NULL COMMENT 'FK to plans - auto-apply this profile for CPEs on this plan',
    manufacturer            VARCHAR(100)    NULL COMMENT 'NULL = any manufacturer',
    model_name              VARCHAR(100)    NULL COMMENT 'NULL = any model',
    wifi_ssid_template      VARCHAR(64)     NULL COMMENT 'Template string, {{serial}} substituted at provision time',
    wifi_security           VARCHAR(20)     NULL DEFAULT 'WPA2-PSK',
    wifi_channel            TINYINT UNSIGNED NULL,
    wifi_band               ENUM('2.4GHz','5GHz','dual') NULL DEFAULT 'dual',
    wan_mode                ENUM('dhcp','pppoe','static') NULL DEFAULT 'dhcp',
    wan_vlan_id             SMALLINT UNSIGNED NULL,
    parameters              JSON            NULL COMMENT 'Static parameter key/value map to push on provision',
    status                  ENUM('active','inactive','draft') NOT NULL DEFAULT 'active',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at              DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_cpe_profiles_org (organization_id),
    KEY idx_cpe_profiles_plan (plan_id),
    KEY idx_cpe_profiles_parent (parent_profile_id),
    KEY idx_cpe_profiles_deleted_at (deleted_at),
    CONSTRAINT fk_cpe_profiles_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_profiles_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_profiles_parent FOREIGN KEY (parent_profile_id) REFERENCES cpe_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CPE provisioning profiles per service plan (§8.2)';

CREATE TABLE IF NOT EXISTS cpe_parameter_mappings (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    cpe_profile_id      BIGINT UNSIGNED NOT NULL,
    parameter_path      VARCHAR(512)    NOT NULL COMMENT 'TR-069 parameter path',
    source_type         ENUM('static','contract_field','plan_field','device_field') NOT NULL DEFAULT 'static',
    source_field        VARCHAR(100)    NULL COMMENT 'Field name on contract/plan/device when source_type != static',
    static_value        TEXT            NULL COMMENT 'Value when source_type=static',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cpe_param_mappings_org (organization_id),
    KEY idx_cpe_param_mappings_profile (cpe_profile_id),
    CONSTRAINT fk_cpe_param_mappings_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_param_mappings_profile FOREIGN KEY (cpe_profile_id) REFERENCES cpe_profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Automatic parameter mapping rules for CPE profiles (§8.2)';

CREATE TABLE IF NOT EXISTS cpe_firmware_versions (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    manufacturer        VARCHAR(100)    NOT NULL,
    model_name          VARCHAR(100)    NOT NULL,
    version             VARCHAR(64)     NOT NULL,
    firmware_url        VARCHAR(512)    NOT NULL,
    file_size_bytes     BIGINT UNSIGNED NULL,
    checksum            VARCHAR(128)    NULL,
    checksum_type       ENUM('md5','sha1','sha256') NULL DEFAULT 'md5',
    is_stable           TINYINT(1)      NOT NULL DEFAULT 1,
    release_notes       TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cpe_fw_ver (manufacturer, model_name, version),
    KEY idx_cpe_fw_org (organization_id),
    KEY idx_cpe_fw_deleted_at (deleted_at),
    CONSTRAINT fk_cpe_fw_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Firmware version inventory per CPE model (§8.1)';

CREATE TABLE IF NOT EXISTS cpe_firmware_campaigns (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NULL,
    name                    VARCHAR(100)    NOT NULL,
    firmware_version_id     BIGINT UNSIGNED NOT NULL,
    target_manufacturer     VARCHAR(100)    NULL,
    target_model            VARCHAR(100)    NULL,
    target_profile_id       BIGINT UNSIGNED NULL,
    target_device_ids       JSON            NULL COMMENT 'Array of cpe_device IDs for ad-hoc targeting',
    status                  ENUM('scheduled','running','done','failed','cancelled') NOT NULL DEFAULT 'scheduled',
    scheduled_at            DATETIME        NULL,
    started_at              DATETIME        NULL,
    completed_at            DATETIME        NULL,
    total_devices           INT UNSIGNED    NOT NULL DEFAULT 0,
    completed_devices       INT UNSIGNED    NOT NULL DEFAULT 0,
    failed_devices          INT UNSIGNED    NOT NULL DEFAULT 0,
    result_summary          JSON            NULL,
    created_by              BIGINT UNSIGNED NULL,
    notes                   TEXT            NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at              DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_cpe_fw_camp_org (organization_id),
    KEY idx_cpe_fw_camp_status (status),
    KEY idx_cpe_fw_camp_scheduled_at (scheduled_at),
    KEY idx_cpe_fw_camp_deleted_at (deleted_at),
    CONSTRAINT fk_cpe_fw_camp_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_fw_camp_fw FOREIGN KEY (firmware_version_id) REFERENCES cpe_firmware_versions(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_fw_camp_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_fw_camp_profile FOREIGN KEY (target_profile_id) REFERENCES cpe_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Batch firmware upgrade campaigns (§8.1)';

-- ---------------------------------------------------------------------------
-- §8.3 Diagnostics (migration 277)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpe_diagnostics (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    cpe_device_id       BIGINT UNSIGNED NOT NULL,
    cpe_task_id         BIGINT UNSIGNED NULL COMMENT 'FK to the cpe_tasks row that triggered this diagnostic',
    diag_type           ENUM('ping','traceroute','wifi_snapshot','ethernet_status','wan_diagnostics') NOT NULL,
    status              ENUM('pending','running','complete','error') NOT NULL DEFAULT 'pending',
    target_host         VARCHAR(253)    NULL COMMENT 'IP/hostname for ping and traceroute',
    result              JSON            NULL COMMENT 'Structured results: latency_ms, hops[], signal_dbm, client_count, port_stats, wan_details, etc.',
    error_message       TEXT            NULL,
    started_at          DATETIME        NULL,
    completed_at        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_cpe_diag_org (organization_id),
    KEY idx_cpe_diag_device (cpe_device_id),
    KEY idx_cpe_diag_task (cpe_task_id),
    KEY idx_cpe_diag_type_status (diag_type, status),
    KEY idx_cpe_diag_deleted_at (deleted_at),
    CONSTRAINT fk_cpe_diag_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_diag_device FOREIGN KEY (cpe_device_id) REFERENCES cpe_devices(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='TR-069 diagnostic run results per CPE device (§8.3)';

CREATE TABLE IF NOT EXISTS cpe_session_logs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    cpe_device_id       BIGINT UNSIGNED NULL COMMENT 'NULL when device cannot be identified',
    session_id          VARCHAR(64)     NULL COMMENT 'Optional client-supplied session identifier',
    event_type          ENUM('inform','task_dispatched','task_response','fault','auth_failure','parse_error','session_error') NOT NULL DEFAULT 'session_error',
    message_type        VARCHAR(64)     NULL COMMENT 'CWMP SOAP message type (Inform, Fault, etc.)',
    task_type           VARCHAR(64)     NULL COMMENT 'cpe_tasks.task_type when event_type=task_dispatched/task_response',
    fault_code          VARCHAR(16)     NULL,
    fault_string        TEXT            NULL,
    remote_ip           VARCHAR(45)     NULL,
    raw_excerpt         TEXT            NULL COMMENT 'First 2000 chars of SOAP envelope for debugging',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cpe_sl_org (organization_id),
    KEY idx_cpe_sl_device (cpe_device_id),
    KEY idx_cpe_sl_event (event_type),
    KEY idx_cpe_sl_created_at (created_at),
    CONSTRAINT fk_cpe_sl_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CWMP session event and error log per CPE device (§8.3)';

-- ---------------------------------------------------------------------------
-- §8.4 Inventory (migration 278)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpe_lifecycle_history (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    cpe_device_id       BIGINT UNSIGNED NOT NULL,
    from_state          ENUM('in_stock','assigned','active','returned','rma') NULL
                            COMMENT 'NULL for the initial record (device created)',
    to_state            ENUM('in_stock','assigned','active','returned','rma') NOT NULL,
    reason              VARCHAR(255)    NULL COMMENT 'Human-readable reason: swap, decommission, return, etc.',
    swap_in_device_id   BIGINT UNSIGNED NULL COMMENT 'For swap events: the device being swapped IN (new)',
    swap_out_device_id  BIGINT UNSIGNED NULL COMMENT 'For swap events: the device being swapped OUT (old)',
    performed_by        BIGINT UNSIGNED NULL COMMENT 'FK to users — who performed the transition',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cpe_lh_org (organization_id),
    KEY idx_cpe_lh_device (cpe_device_id),
    KEY idx_cpe_lh_created_at (created_at),
    CONSTRAINT fk_cpe_lh_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_lh_device FOREIGN KEY (cpe_device_id) REFERENCES cpe_devices(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Immutable lifecycle state transition audit trail per CPE device (§8.4)';

SET FOREIGN_KEY_CHECKS = 1;
