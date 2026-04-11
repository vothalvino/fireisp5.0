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
    last_login_at   TIMESTAMP       NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_organization_id (organization_id),
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
    name            VARCHAR(255)    NOT NULL,
    email           VARCHAR(255)    NULL,
    phone           VARCHAR(30)     NULL,
    client_type     ENUM('personal', 'company') NOT NULL DEFAULT 'personal',
    locale          ENUM('global', 'MX') NOT NULL DEFAULT 'global'
                        COMMENT 'Regional compliance switch: global = no country-specific requirements; MX = SAT CFDI 4.0 + IFT/CRT compliance required',
    tax_id          VARCHAR(50)     NULL,
    curp            VARCHAR(18)     NULL COMMENT 'Mexican personal ID (CURP) — personal clients only',
    address         VARCHAR(255)    NULL,
    city            VARCHAR(100)    NULL,
    state           VARCHAR(100)    NULL,
    country         VARCHAR(100)    NULL DEFAULT 'US',
    zip_code        VARCHAR(20)     NULL,
    notes           TEXT            NULL,
    status          ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_clients_organization_id (organization_id),
    KEY idx_clients_locale (locale),
    KEY idx_clients_status (status),
    KEY idx_clients_email (email),
    CONSTRAINT fk_clients_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
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

    PRIMARY KEY (id),
    KEY idx_contacts_client_id (client_id),
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

    PRIMARY KEY (id),
    KEY idx_sites_organization_id (organization_id),
    KEY idx_sites_site_type (site_type),
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
    download_speed  INT UNSIGNED    NOT NULL COMMENT 'Speed in Mbps',
    upload_speed    INT UNSIGNED    NOT NULL COMMENT 'Speed in Mbps',
    price           DECIMAL(10, 2)  NOT NULL,
    billing_cycle   ENUM('monthly', 'quarterly', 'semi_annual', 'annual') NOT NULL DEFAULT 'monthly',
    burst_download  INT UNSIGNED    NULL COMMENT 'Burst download speed in Mbps',
    burst_upload    INT UNSIGNED    NULL COMMENT 'Burst upload speed in Mbps',
    contention      TINYINT UNSIGNED NULL COMMENT 'Contention ratio e.g. 10 means 10:1',
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_plans_organization_id (organization_id),
    KEY idx_plans_status (status),
    CONSTRAINT fk_plans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: contracts
-- Purpose: Service contracts linking clients to plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id      BIGINT UNSIGNED NOT NULL,
    plan_id        BIGINT UNSIGNED NOT NULL,
    site_id        BIGINT UNSIGNED NULL,
    start_date     DATE            NOT NULL,
    end_date       DATE            NULL,
    billing_cycle  ENUM('monthly', 'quarterly', 'semi_annual', 'annual') NULL COMMENT 'Override cycle; NULL means use the plan billing cycle',
    price_override DECIMAL(10, 2)  NULL COMMENT 'Custom price; NULL means use plan price',
    notes          TEXT            NULL,
    connection_type ENUM('pppoe', 'pppoe_dual', 'static', 'dual') NOT NULL DEFAULT 'pppoe'
                       COMMENT 'pppoe = PPPoE IPv4-only (requires RADIUS); pppoe_dual = PPPoE dual-stack IPv4+IPv6 (requires RADIUS); static = static IPv4 (no RADIUS); dual = dual-stack static IPv4+IPv6 (no RADIUS)',
    contract_template_mx_id BIGINT UNSIGNED NULL
                       COMMENT 'IFT/CRT-registered Carta de Adhesión template used for this contract; NULL for non-MX clients',
    facturar       BOOLEAN         NOT NULL DEFAULT FALSE
                       COMMENT 'MX only: TRUE = generate individual CFDI for this contract invoices; FALSE = invoices go to factura pública (venta al público en general). When TRUE the client must have a client_mx_profiles row with valid SAT data. Ignored when client locale is not MX',
    status         ENUM('active', 'expired', 'cancelled', 'pending') NOT NULL DEFAULT 'pending',
    created_by     BIGINT UNSIGNED NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_contracts_client_id (client_id),
    KEY idx_contracts_plan_id (plan_id),
    KEY idx_contracts_site_id (site_id),
    KEY idx_contracts_connection_type (connection_type),
    KEY idx_contracts_contract_template_mx_id (contract_template_mx_id),
    KEY idx_contracts_facturar (facturar),
    KEY idx_contracts_status (status),
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
    name        VARCHAR(255)    NOT NULL,
    ip_address  VARCHAR(45)     NOT NULL COMMENT 'Primary IPv4 address',
    ipv6_address VARCHAR(45)    NULL     COMMENT 'IPv6 management address (dual-stack)',
    secret      VARCHAR(255)    NOT NULL COMMENT 'RADIUS shared secret',
    type        VARCHAR(50)     NOT NULL DEFAULT 'other' COMMENT 'e.g. mikrotik, cisco, ubiquiti',
    ports       INT UNSIGNED    NULL,
    description TEXT            NULL,
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_nas_ip_address (ip_address),
    KEY idx_nas_status (status)
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
    password_hash VARCHAR(255)    NOT NULL,
    ip_address              VARCHAR(45)     NULL COMMENT 'Static IPv4 address if assigned',
    ipv6_address            VARCHAR(45)     NULL COMMENT 'Static IPv6 address if assigned (dual-stack)',
    ipv6_delegated_prefix   VARCHAR(45)     NULL COMMENT 'Delegated IPv6 prefix e.g. 2001:db8:abcd:: (DHCPv6-PD)',
    ipv6_prefix_len         TINYINT UNSIGNED NULL COMMENT 'Delegated prefix length e.g. 48, 56, 64',
    ipv4_pool_id  BIGINT UNSIGNED NULL     COMMENT 'IPv4 pool for dynamic address assignment (PPPoE)',
    ipv6_pool_id  BIGINT UNSIGNED NULL     COMMENT 'IPv6 pool for dynamic prefix delegation (PPPoE dual-stack)',
    mac_address   VARCHAR(17)     NULL COMMENT 'MAC address in XX:XX:XX:XX:XX:XX format',
    profile       VARCHAR(100)    NULL COMMENT 'RADIUS profile / bandwidth profile name',
    status        ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_radius_username (username),
    KEY idx_radius_client_id (client_id),
    KEY idx_radius_contract_id (contract_id),
    KEY idx_radius_nas_id (nas_id),
    KEY idx_radius_ipv4_pool_id (ipv4_pool_id),
    KEY idx_radius_ipv6_pool_id (ipv6_pool_id),
    KEY idx_radius_status (status),
    CONSTRAINT fk_radius_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_radius_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_nas FOREIGN KEY (nas_id)
        REFERENCES nas (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_ipv4_pool FOREIGN KEY (ipv4_pool_id)
        REFERENCES ip_pools (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_ipv6_pool FOREIGN KEY (ipv6_pool_id)
        REFERENCES ip_pools (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: devices
-- Purpose: Network equipment inventory for both client CPE (Outdoor/Indoor)
--          and POP infrastructure (PTP, PTMP, OLT, Router, Switch, ONU, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
                      COMMENT 'Device type — client: outdoor_cpe, indoor_cpe; pop: ptp, ptmp_ap, olt, router, switch, onu',
    manufacturer  VARCHAR(100)    NULL,
    model         VARCHAR(100)    NULL,
    serial_number VARCHAR(100)    NULL,
    mac_address   VARCHAR(17)     NULL COMMENT 'MAC address in XX:XX:XX:XX:XX:XX format',
    ip_address    VARCHAR(45)     NULL COMMENT 'Management IPv4 address',
    ipv6_address  VARCHAR(45)     NULL COMMENT 'Management IPv6 address (dual-stack)',
    firmware      VARCHAR(100)    NULL,
    snmp_enabled  BOOLEAN         NOT NULL DEFAULT FALSE COMMENT 'Enable SNMP polling for this device',
    snmp_community VARCHAR(255)   NULL COMMENT 'SNMP community string (v1/v2c) — store encrypted; decrypt at application layer',
    snmp_version  ENUM('v1','v2c','v3') NULL DEFAULT 'v2c' COMMENT 'SNMP protocol version',
    snmp_port     SMALLINT UNSIGNED NULL DEFAULT 161 COMMENT 'SNMP UDP port',
    snmp_profile_id BIGINT UNSIGNED NULL
                                       COMMENT 'Explicit SNMP profile override; NULL = auto-match by manufacturer/model/type',
    status        ENUM('online', 'offline', 'maintenance') NOT NULL DEFAULT 'offline',
    notes         TEXT            NULL,
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_devices_serial_number (serial_number),
    KEY idx_devices_site_id (site_id),
    KEY idx_devices_client_id (client_id),
    KEY idx_devices_contract_id (contract_id),
    KEY idx_devices_category (category),
    KEY idx_devices_status (status),
    KEY idx_devices_snmp_enabled (snmp_enabled),
    KEY idx_devices_snmp_profile_id (snmp_profile_id),
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
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id    BIGINT UNSIGNED NOT NULL,
    contract_id  BIGINT UNSIGNED NULL     COMMENT 'Contract this ticket concerns (NULL = general client-level ticket)',
    assigned_to  BIGINT UNSIGNED NULL,
    title        VARCHAR(255)    NOT NULL,
    description  TEXT            NULL,
    category     VARCHAR(100)    NULL COMMENT 'e.g. connectivity, billing, hardware',
    priority     ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
    status       ENUM('open', 'in_progress', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    resolved_at  TIMESTAMP       NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_tickets_client_id (client_id),
    KEY idx_tickets_contract_id (contract_id),
    KEY idx_tickets_assigned_to (assigned_to),
    KEY idx_tickets_status (status),
    KEY idx_tickets_priority (priority),
    CONSTRAINT fk_tickets_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tickets_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_tickets_assigned_to FOREIGN KEY (assigned_to)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: invoices
-- Purpose: Billing records issued to clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id      BIGINT UNSIGNED NOT NULL,
    contract_id    BIGINT UNSIGNED NULL,
    invoice_number VARCHAR(50)     NOT NULL,
    issue_date     DATE            NOT NULL,
    due_date       DATE            NOT NULL,
    subtotal       DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    tax_rate       DECIMAL(5, 4)   NOT NULL DEFAULT 0.0000 COMMENT 'e.g. 0.0800 for 8%',
    tax_amount     DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    total          DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    notes          TEXT            NULL,
    status         ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled') NOT NULL DEFAULT 'draft',
    paid_at        TIMESTAMP       NULL,
    created_by     BIGINT UNSIGNED NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_invoices_number (invoice_number),
    KEY idx_invoices_client_id (client_id),
    KEY idx_invoices_contract_id (contract_id),
    KEY idx_invoices_status (status),
    KEY idx_invoices_due_date (due_date),
    CONSTRAINT fk_invoices_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_invoices_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payments
-- Purpose: Records of payments received from clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id        BIGINT UNSIGNED NOT NULL,
    invoice_id       BIGINT UNSIGNED NULL,
    amount           DECIMAL(10, 2)  NOT NULL,
    payment_date     DATE            NOT NULL,
    payment_method   ENUM('cash', 'check', 'credit_card', 'debit_card', 'bank_transfer',
                         'oxxo_pay', 'spei', 'codi', 'convenience_store', 'digital_wallet',
                         'other')
                                     NOT NULL DEFAULT 'cash'
                                     COMMENT 'Payment instrument; MX methods: oxxo_pay, spei, codi, convenience_store, digital_wallet',
    sat_forma_pago   VARCHAR(2)      NULL COMMENT 'SAT c_FormaPago code used to stamp on CFDI pago complement (e.g. 01=cash, 03=SPEI, 06=CoDi)',
    reference_number VARCHAR(100)    NULL COMMENT 'Check number, transaction ID, etc.',
    clabe            VARCHAR(18)     NULL COMMENT '18-digit CLABE interbank key — required for SPEI and CoDi transactions',
    bank_name        VARCHAR(100)    NULL COMMENT 'Bank name for SPEI / CoDi transactions',
    notes            TEXT            NULL,
    recorded_by      BIGINT UNSIGNED NULL,
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_payments_client_id (client_id),
    KEY idx_payments_invoice_id (invoice_id),
    KEY idx_payments_payment_date (payment_date),
    CONSTRAINT fk_payments_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payments_recorded_by FOREIGN KEY (recorded_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payment_allocations
-- Purpose: Junction table for split payments — records what portion of a payment
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

    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_allocations_payment_invoice (payment_id, invoice_id),
    KEY idx_payment_allocations_invoice_id (invoice_id),
    CONSTRAINT fk_payment_allocations_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_payment_allocations_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: quotes
-- Purpose: Service estimates and proposals for prospective or existing clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotes (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id    BIGINT UNSIGNED NOT NULL,
    quote_number VARCHAR(50)     NOT NULL,
    issue_date   DATE            NOT NULL,
    expiry_date  DATE            NULL,
    subtotal     DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    tax_rate     DECIMAL(5, 4)   NOT NULL DEFAULT 0.0000 COMMENT 'e.g. 0.0800 for 8%',
    tax_amount   DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    total        DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    notes        TEXT            NULL,
    status       ENUM('draft', 'sent', 'accepted', 'rejected', 'expired') NOT NULL DEFAULT 'draft',
    created_by   BIGINT UNSIGNED NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_quotes_number (quote_number),
    KEY idx_quotes_client_id (client_id),
    KEY idx_quotes_status (status),
    CONSTRAINT fk_quotes_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
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
    country             VARCHAR(100)    NULL DEFAULT 'US',
    zip_code            VARCHAR(20)     NULL,
    website             VARCHAR(255)    NULL,
    online_payment_url  VARCHAR(255)    NULL COMMENT 'URL for the online payment portal',
    map_url             VARCHAR(500)    NULL COMMENT 'URL or embed link for office/coverage map',
    notes               TEXT            NULL,
    status              ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_organizations_locale (locale),
    KEY idx_organizations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ip_pools
-- Purpose: IP address pools available for subscriber assignment (IPAM)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ip_pools (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(255)    NOT NULL COMMENT 'Pool name e.g. Residential-Pool-1',
    ip_version  ENUM('4', '6') NOT NULL DEFAULT '4' COMMENT 'Address family: 4 = IPv4, 6 = IPv6',
    network     VARCHAR(45)     NOT NULL COMMENT 'Network address e.g. 10.0.0.0 (v4) or 2001:db8:: (v6)',
    cidr        TINYINT UNSIGNED NOT NULL COMMENT 'CIDR prefix length e.g. 24 (v4) or 48 (v6)',
    gateway     VARCHAR(45)     NULL     COMMENT 'Default gateway for the pool',
    dns_primary VARCHAR(45)     NULL     COMMENT 'Primary DNS server',
    dns_secondary VARCHAR(45)   NULL     COMMENT 'Secondary DNS server',
    site_id     BIGINT UNSIGNED NULL     COMMENT 'Site / POP the pool is served from',
    notes       TEXT            NULL,
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ip_pools_network_cidr_ver (network, cidr, ip_version),
    KEY idx_ip_pools_ip_version (ip_version),
    KEY idx_ip_pools_site_id (site_id),
    KEY idx_ip_pools_status (status),
    CONSTRAINT fk_ip_pools_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: ip_assignments
-- Purpose: Track individual IP address assignments to clients / devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ip_assignments (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
                    COMMENT 'Lifecycle state — reservation intent is captured by the type field',
    assigned_at TIMESTAMP       NULL,
    expires_at  TIMESTAMP       NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ip_assignments_ip (ip_address),
    KEY idx_ip_assignments_pool_id (pool_id),
    KEY idx_ip_assignments_contract_id (contract_id),
    KEY idx_ip_assignments_client_id (client_id),
    KEY idx_ip_assignments_device_id (device_id),
    KEY idx_ip_assignments_status (status),
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

    PRIMARY KEY (id),
    KEY idx_notifications_user_id (user_id),
    KEY idx_notifications_is_read (is_read),
    KEY idx_notifications_type (type),
    KEY idx_notifications_created_at (created_at),
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
    total       DECIMAL(10, 2)  GENERATED ALWAYS AS (quantity * unit_price) STORED COMMENT 'quantity * unit_price',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_invoice_items_invoice_id (invoice_id),
    CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE CASCADE ON UPDATE CASCADE
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
    total       DECIMAL(10, 2)  GENERATED ALWAYS AS (quantity * unit_price) STORED COMMENT 'quantity * unit_price',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_quote_items_quote_id (quote_id),
    CONSTRAINT fk_quote_items_quote FOREIGN KEY (quote_id)
        REFERENCES quotes (id) ON DELETE CASCADE ON UPDATE CASCADE
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

    PRIMARY KEY (id),
    KEY idx_ticket_comments_ticket_id (ticket_id),
    KEY idx_ticket_comments_user_id (user_id),
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

    PRIMARY KEY (id),
    KEY idx_files_entity      (entity_type, entity_id),
    KEY idx_files_category    (category),
    KEY idx_files_uploaded_by (uploaded_by),
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
    if_in_octets    BIGINT          NULL       COMMENT 'ifInOctets -- bytes received',
    if_out_octets   BIGINT          NULL       COMMENT 'ifOutOctets -- bytes transmitted',
    if_in_errors    BIGINT          NULL       COMMENT 'ifInErrors -- inbound errors',
    if_out_errors   BIGINT          NULL       COMMENT 'ifOutErrors -- outbound errors',
    cpu_usage       SMALLINT        NULL       COMMENT 'CPU utilization percentage',
    memory_usage    SMALLINT        NULL       COMMENT 'Memory utilization percentage',
    signal_strength INTEGER         NULL       COMMENT 'Wireless signal strength in dBm',
    latency_ms      DECIMAL(10,2)   NULL       COMMENT 'ICMP ping latency in milliseconds',
    polled_at       TIMESTAMP       NOT NULL   COMMENT 'Timestamp of the SNMP poll',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    avg_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Average latency in milliseconds',
    min_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Minimum latency in milliseconds',
    max_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Maximum latency in milliseconds',
    sample_count        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of raw samples aggregated',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    avg_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Average latency in milliseconds',
    min_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Minimum latency in milliseconds',
    max_latency_ms      DECIMAL(10,2)   NULL     COMMENT 'Maximum latency in milliseconds',
    sample_count        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of hourly samples aggregated',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1day_device_iface_period (device_id, interface_id, period_start),
    KEY idx_snmp_1day_period_start (period_start),
    CONSTRAINT fk_snmp_1day_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: snmp_rollup_state
-- Purpose: High-watermark table tracking the last successfully processed
--          timestamp for each rollup tier.  Enables rollup procedures to
--          catch up automatically after a missed run or server restart.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_rollup_state (
    rollup_name    VARCHAR(32)  NOT NULL COMMENT 'Rollup tier identifier (1hr, 1day)',
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

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_profiles_name (name),
    KEY idx_snmp_profiles_manufacturer (manufacturer),
    KEY idx_snmp_profiles_status (status)
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

    PRIMARY KEY (id),
    UNIQUE KEY uq_profile_oid (profile_id, oid),
    KEY idx_snmp_profile_oids_metric (metric_column),
    KEY idx_snmp_profile_oids_status (status),
    CONSTRAINT fk_snmp_profile_oids_profile FOREIGN KEY (profile_id)
        REFERENCES snmp_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: snmp_profiles — pre-built profiles for common ISP device vendors
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
-- Seed: snmp_profile_oids — OID mappings per vendor profile
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

-- =============================================================================
-- Connection Logs (Compliance & Usage)
-- =============================================================================
-- Connection logs record every subscriber session event for regulatory compliance.
-- Session traffic counters (bytes_in/out, packets_in/out) on stop/interim events
-- also serve as the source of truth for per-contract data usage — no separate
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
    contract_id           BIGINT UNSIGNED NOT NULL          COMMENT 'Contract at time of session (no FK — compliance)',
    client_id             BIGINT UNSIGNED NOT NULL          COMMENT 'Client at time of session (no FK — compliance)',
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

    PRIMARY KEY (id, event_at),
    KEY idx_conn_logs_contract_time (contract_id, event_at),
    KEY idx_conn_logs_client_time (client_id, event_at),
    KEY idx_conn_logs_username (username, event_at),
    KEY idx_conn_logs_ip_address (ip_address, event_at),
    KEY idx_connection_logs_ipv6_address (ipv6_address),
    KEY idx_conn_logs_session_id (session_id)
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
         avg_if_in_octets,    min_if_in_octets,    max_if_in_octets,
         avg_if_out_octets,   min_if_out_octets,   max_if_out_octets,
         avg_if_in_errors,    min_if_in_errors,    max_if_in_errors,
         avg_if_out_errors,   min_if_out_errors,   max_if_out_errors,
         avg_cpu_usage,       min_cpu_usage,        max_cpu_usage,
         avg_memory_usage,    min_memory_usage,     max_memory_usage,
         avg_signal_strength, min_signal_strength,  max_signal_strength,
         avg_latency_ms,      min_latency_ms,       max_latency_ms,
         sample_count)
    SELECT
        device_id,
        COALESCE(interface_id, '')                        AS interface_id,
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')       AS period_start,
        AVG(if_in_octets),    MIN(if_in_octets),    MAX(if_in_octets),
        AVG(if_out_octets),   MIN(if_out_octets),   MAX(if_out_octets),
        AVG(if_in_errors),    MIN(if_in_errors),    MAX(if_in_errors),
        AVG(if_out_errors),   MIN(if_out_errors),   MAX(if_out_errors),
        AVG(cpu_usage),       MIN(cpu_usage),        MAX(cpu_usage),
        AVG(memory_usage),    MIN(memory_usage),     MAX(memory_usage),
        AVG(signal_strength), MIN(signal_strength),  MAX(signal_strength),
        AVG(latency_ms),      MIN(latency_ms),       MAX(latency_ms),
        COUNT(*)
    FROM snmp_metrics
    WHERE polled_at >  v_from_ts
      AND polled_at <  v_to_ts
    GROUP BY
        device_id,
        COALESCE(interface_id, ''),
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')
    AS new_data
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets    = new_data.avg_if_in_octets,
        min_if_in_octets    = new_data.min_if_in_octets,
        max_if_in_octets    = new_data.max_if_in_octets,
        avg_if_out_octets   = new_data.avg_if_out_octets,
        min_if_out_octets   = new_data.min_if_out_octets,
        max_if_out_octets   = new_data.max_if_out_octets,
        avg_if_in_errors    = new_data.avg_if_in_errors,
        min_if_in_errors    = new_data.min_if_in_errors,
        max_if_in_errors    = new_data.max_if_in_errors,
        avg_if_out_errors   = new_data.avg_if_out_errors,
        min_if_out_errors   = new_data.min_if_out_errors,
        max_if_out_errors   = new_data.max_if_out_errors,
        avg_cpu_usage       = new_data.avg_cpu_usage,
        min_cpu_usage       = new_data.min_cpu_usage,
        max_cpu_usage       = new_data.max_cpu_usage,
        avg_memory_usage    = new_data.avg_memory_usage,
        min_memory_usage    = new_data.min_memory_usage,
        max_memory_usage    = new_data.max_memory_usage,
        avg_signal_strength = new_data.avg_signal_strength,
        min_signal_strength = new_data.min_signal_strength,
        max_signal_strength = new_data.max_signal_strength,
        avg_latency_ms      = new_data.avg_latency_ms,
        min_latency_ms      = new_data.min_latency_ms,
        max_latency_ms      = new_data.max_latency_ms,
        sample_count        = new_data.sample_count;

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
         avg_if_in_octets,    min_if_in_octets,    max_if_in_octets,
         avg_if_out_octets,   min_if_out_octets,   max_if_out_octets,
         avg_if_in_errors,    min_if_in_errors,    max_if_in_errors,
         avg_if_out_errors,   min_if_out_errors,   max_if_out_errors,
         avg_cpu_usage,       min_cpu_usage,        max_cpu_usage,
         avg_memory_usage,    min_memory_usage,     max_memory_usage,
         avg_signal_strength, min_signal_strength,  max_signal_strength,
         avg_latency_ms,      min_latency_ms,       max_latency_ms,
         sample_count)
    SELECT
        device_id,
        interface_id,
        DATE(period_start)                                AS period_start,
        AVG(avg_if_in_octets),    MIN(min_if_in_octets),    MAX(max_if_in_octets),
        AVG(avg_if_out_octets),   MIN(min_if_out_octets),   MAX(max_if_out_octets),
        AVG(avg_if_in_errors),    MIN(min_if_in_errors),    MAX(max_if_in_errors),
        AVG(avg_if_out_errors),   MIN(min_if_out_errors),   MAX(max_if_out_errors),
        AVG(avg_cpu_usage),       MIN(min_cpu_usage),        MAX(max_cpu_usage),
        AVG(avg_memory_usage),    MIN(min_memory_usage),     MAX(max_memory_usage),
        AVG(avg_signal_strength), MIN(min_signal_strength),  MAX(max_signal_strength),
        AVG(avg_latency_ms),      MIN(min_latency_ms),       MAX(max_latency_ms),
        SUM(sample_count)
    FROM snmp_metrics_1hr
    WHERE period_start >= v_from_date
      AND period_start <  v_to_date
    GROUP BY device_id, interface_id, DATE(period_start)
    AS new_data
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets    = new_data.avg_if_in_octets,
        min_if_in_octets    = new_data.min_if_in_octets,
        max_if_in_octets    = new_data.max_if_in_octets,
        avg_if_out_octets   = new_data.avg_if_out_octets,
        min_if_out_octets   = new_data.min_if_out_octets,
        max_if_out_octets   = new_data.max_if_out_octets,
        avg_if_in_errors    = new_data.avg_if_in_errors,
        min_if_in_errors    = new_data.min_if_in_errors,
        max_if_in_errors    = new_data.max_if_in_errors,
        avg_if_out_errors   = new_data.avg_if_out_errors,
        min_if_out_errors   = new_data.min_if_out_errors,
        max_if_out_errors   = new_data.max_if_out_errors,
        avg_cpu_usage       = new_data.avg_cpu_usage,
        min_cpu_usage       = new_data.min_cpu_usage,
        max_cpu_usage       = new_data.max_cpu_usage,
        avg_memory_usage    = new_data.avg_memory_usage,
        min_memory_usage    = new_data.min_memory_usage,
        max_memory_usage    = new_data.max_memory_usage,
        avg_signal_strength = new_data.avg_signal_strength,
        min_signal_strength = new_data.min_signal_strength,
        max_signal_strength = new_data.max_signal_strength,
        avg_latency_ms      = new_data.avg_latency_ms,
        min_latency_ms      = new_data.min_latency_ms,
        max_latency_ms      = new_data.max_latency_ms,
        sample_count        = new_data.sample_count;

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
-- Retention: connection_logs kept 2 years (DROP PARTITION — compliance)
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

    PRIMARY KEY (id),
    KEY idx_warehouses_organization_id (organization_id),
    KEY idx_warehouses_status (status),
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
    sku             VARCHAR(100)    NULL COMMENT 'Stock-keeping unit / internal part number',
    name            VARCHAR(255)    NOT NULL COMMENT 'Item name (e.g. MikroTik hAP ac³)',
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

    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_items_sku (sku),
    KEY idx_inventory_items_category (category),
    KEY idx_inventory_items_status (status)
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

    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_stock_location (item_id, warehouse_id, aisle, col, shelf),
    KEY idx_inventory_stock_warehouse_id (warehouse_id),
    KEY idx_inventory_stock_item_id (item_id),
    CONSTRAINT fk_inventory_stock_item FOREIGN KEY (item_id)
        REFERENCES inventory_items (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inventory_stock_warehouse FOREIGN KEY (warehouse_id)
        REFERENCES warehouses (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: inventory_transactions
-- Purpose: Immutable log of every stock movement — receiving, job assignments,
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
-- Purpose: Credits issued to clients — for returns, courtesy adjustments,
--          service outages, billing errors, duplicate payments, downgrades,
--          cancellations, or other reasons. Optionally linked to the original
--          invoice being credited.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_notes (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id          BIGINT UNSIGNED NOT NULL,
    contract_id        BIGINT UNSIGNED NULL,
    invoice_id         BIGINT UNSIGNED NULL      COMMENT 'Original invoice being credited, if any',
    payment_id         BIGINT UNSIGNED NULL      COMMENT 'Payment that triggered this credit note (e.g. duplicate payment refund)',
    credit_note_number VARCHAR(50)     NOT NULL,
    issue_date         DATE            NOT NULL,
    reason             ENUM(
                           'return',
                           'courtesy',
                           'service_outage',
                           'billing_error',
                           'duplicate_payment',
                           'downgrade',
                           'cancellation',
                           'other'
                       ) NOT NULL
                           COMMENT 'return=client returned equipment; courtesy=goodwill/customer satisfaction; service_outage=compensation for downtime; billing_error=incorrect charge on invoice; duplicate_payment=client paid twice; downgrade=refund of unused service after plan change; cancellation=prorated refund for early termination; other=see notes',
    subtotal           DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    tax_rate           DECIMAL(5, 4)   NOT NULL DEFAULT 0.0000 COMMENT 'e.g. 0.0800 for 8%',
    tax_amount         DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    total              DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    notes              TEXT            NULL,
    status             ENUM('draft', 'issued', 'applied', 'cancelled') NOT NULL DEFAULT 'draft'
                           COMMENT 'draft=being prepared; issued=sent to client; applied=credit applied to account; cancelled=voided',
    applied_at         TIMESTAMP       NULL      COMMENT 'When the credit was applied to the client account',
    created_by         BIGINT UNSIGNED NULL,
    created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_credit_notes_number (credit_note_number),
    KEY idx_credit_notes_client_id (client_id),
    KEY idx_credit_notes_contract_id (contract_id),
    KEY idx_credit_notes_invoice_id (invoice_id),
    KEY idx_credit_notes_payment_id (payment_id),
    KEY idx_credit_notes_status (status),
    KEY idx_credit_notes_reason (reason),
    KEY idx_credit_notes_issue_date (issue_date),
    CONSTRAINT fk_credit_notes_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE,
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
    total           DECIMAL(10, 2)  GENERATED ALWAYS AS (quantity * unit_price) STORED COMMENT 'quantity * unit_price',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_credit_note_items_credit_note_id (credit_note_id),
    CONSTRAINT fk_credit_note_items_credit_note FOREIGN KEY (credit_note_id)
        REFERENCES credit_notes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: billing_periods
-- Purpose: Tracks each contract's billing windows — which periods have been
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
    KEY idx_billing_periods_contract_id (contract_id),
    KEY idx_billing_periods_invoice_id (invoice_id),
    KEY idx_billing_periods_status (status),
    KEY idx_billing_periods_scheduled_at (scheduled_at),
    CONSTRAINT fk_billing_periods_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_billing_periods_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_billing_periods_invoiced CHECK (
        status != 'invoiced' OR invoice_id IS NOT NULL
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: network_links
-- Purpose: Device-to-device connections — fiber, wireless, copper, or virtual
--          links between two devices, with optional capacity and interface info.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS network_links (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_a_id     BIGINT UNSIGNED NOT NULL  COMMENT 'First endpoint device',
    device_b_id     BIGINT UNSIGNED NOT NULL  COMMENT 'Second endpoint device',
    link_type       ENUM('fiber', 'wireless', 'copper', 'virtual', 'other')
                        NOT NULL DEFAULT 'fiber'
                        COMMENT 'Physical or logical medium connecting the two devices',
    capacity_mbps   INT UNSIGNED    NULL      COMMENT 'Link capacity in Mbps (e.g. 1000 = 1 Gbps)',
    interface_a     VARCHAR(100)    NULL      COMMENT 'Interface name on device A (e.g. eth0, ether1, ge-0/0/0)',
    interface_b     VARCHAR(100)    NULL      COMMENT 'Interface name on device B',
    status          ENUM('active', 'down', 'maintenance', 'decommissioned')
                        NOT NULL DEFAULT 'active'
                        COMMENT 'Operational status of the link',
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_network_links_device_a_id (device_a_id),
    KEY idx_network_links_device_b_id (device_b_id),
    KEY idx_network_links_link_type (link_type),
    KEY idx_network_links_status (status),
    CONSTRAINT fk_network_links_device_a FOREIGN KEY (device_a_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_network_links_device_b FOREIGN KEY (device_b_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_network_links_different_devices CHECK (device_a_id != device_b_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

    PRIMARY KEY (id),
    KEY idx_tax_rules_organization_id (organization_id),
    KEY idx_tax_rules_region (region),
    KEY idx_tax_rules_status (status),
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
    entry_type      ENUM('invoice', 'payment', 'credit_note', 'adjustment', 'topup', 'usage_deduction') NOT NULL
                        COMMENT 'invoice/usage_deduction = debit entries; payment/topup/credit_note/adjustment = credit entries',
    reference_id    BIGINT UNSIGNED  NULL     COMMENT 'Polymorphic ID of the invoice, payment, credit_note, or related entity',
    description     VARCHAR(255)     NULL,
    debit           DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount charged (increases balance owed / decreases prepaid credit)',
    credit          DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount credited (decreases balance owed / increases prepaid credit)',
    running_balance DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Client account balance after this entry',
    entry_date      DATE             NOT NULL,
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
    reference_type   VARCHAR(50)      NULL     COMMENT 'Entity type the message relates to, e.g. invoice, ticket',
    reference_id     BIGINT UNSIGNED  NULL     COMMENT 'ID of the referenced entity',
    status           ENUM('queued', 'sent', 'delivered', 'failed', 'bounced') NOT NULL DEFAULT 'queued',
    error_message    TEXT             NULL     COMMENT 'Delivery error details when status = failed or bounced',
    sent_at          TIMESTAMP        NULL,
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_email_logs_client_id (client_id),
    KEY idx_email_logs_status (status),
    KEY idx_email_logs_reference (reference_type, reference_id),
    KEY idx_email_logs_sent_at (sent_at),
    KEY idx_email_logs_template_id (template_id),
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
                          'notification', 'backup', 'other')
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
    ip_address     VARCHAR(45)      NULL,
    user_agent     VARCHAR(500)     NULL,
    expires_at     TIMESTAMP        NOT NULL,
    last_active_at TIMESTAMP        NULL,
    created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_user_sessions_token (token_hash),
    KEY idx_user_sessions_user_id (user_id),
    KEY idx_user_sessions_expires_at (expires_at),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tables: roles, permissions, role_permissions
-- Purpose: RBAC roles and permissions — flexible custom roles replacing the
--          rigid role ENUM on the users table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name        VARCHAR(50)      NOT NULL,
    description VARCHAR(255)     NULL,
    is_system   BOOLEAN          NOT NULL DEFAULT FALSE COMMENT 'System roles cannot be deleted',
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_name (name)
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
--          affecting many clients at once — per site and/or device with
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

    PRIMARY KEY (id),
    KEY idx_outages_site_id (site_id),
    KEY idx_outages_device_id (device_id),
    KEY idx_outages_status (status),
    KEY idx_outages_started_at (started_at),
    CONSTRAINT fk_outages_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_outages_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_outages_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Multi-currency support (migration 051)
-- Purpose: Adds currency CHAR(3) (ISO 4217) to core financial tables.
-- ---------------------------------------------------------------------------
ALTER TABLE invoices
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE payments
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE credit_notes
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE quotes
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE plans
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE expenses
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

-- ---------------------------------------------------------------------------
-- Table: vlans
-- Purpose: VLAN registry linked to sites. Tracks IEEE 802.1Q VLAN IDs per
--          site for network segmentation, service isolation, and capacity
--          planning. Referenced by contracts and devices.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vlans (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    site_id         BIGINT UNSIGNED  NOT NULL COMMENT 'Site this VLAN belongs to',
    vlan_id         SMALLINT UNSIGNED NOT NULL COMMENT 'IEEE 802.1Q VLAN ID (1-4094)',
    name            VARCHAR(255)     NOT NULL COMMENT 'Descriptive label, e.g. "Client-Data", "Management", "VoIP"',
    description     TEXT             NULL,
    status          ENUM('active', 'reserved', 'deprecated') NOT NULL DEFAULT 'active'
                        COMMENT 'active = in use; reserved = allocated but not yet deployed; deprecated = phasing out',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_vlans_site_vlan (site_id, vlan_id) COMMENT 'A VLAN ID must be unique within a site',
    KEY idx_vlans_site_id (site_id),
    KEY idx_vlans_status (status),
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

    PRIMARY KEY (id),
    KEY idx_tax_rates_organization_id (organization_id),
    KEY idx_tax_rates_status (status),
    KEY idx_tax_rates_is_default (is_default),
    CONSTRAINT fk_tax_rates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tax rate references (migration 056)
-- Purpose: Links invoices, quotes, and credit notes to the tax_rates master
--          table. The existing tax_rate DECIMAL column is kept as a snapshot
--          of the rate at document-creation time.
-- ---------------------------------------------------------------------------
ALTER TABLE invoices
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    ADD KEY idx_invoices_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_invoices_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE quotes
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    ADD KEY idx_quotes_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_quotes_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE credit_notes
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    ADD KEY idx_credit_notes_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_credit_notes_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;

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
    body            TEXT             NOT NULL COMMENT 'Template body — supports placeholder variables e.g. {{client_name}}',
    description     VARCHAR(255)     NULL     COMMENT 'Human-readable purpose of this template',
    variables       JSON             NULL     COMMENT 'List of available placeholder names, e.g. ["client_name","invoice_number"]',
    is_active       TINYINT(1)       NOT NULL DEFAULT 1,
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_message_templates_org_name_channel (organization_id, name, channel),
    KEY idx_message_templates_channel (channel),
    KEY idx_message_templates_is_active (is_active),
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

    PRIMARY KEY (id),
    UNIQUE KEY uq_api_tokens_hash (token_hash),
    KEY idx_api_tokens_user_id (user_id),
    KEY idx_api_tokens_organization_id (organization_id),
    KEY idx_api_tokens_expires_at (expires_at),
    KEY idx_api_tokens_valid (revoked_at, expires_at) COMMENT 'Optimises WHERE revoked_at IS NULL AND expires_at > NOW()',
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
    name            VARCHAR(150)     NOT NULL COMMENT 'Internal label, e.g. "Summer 2026 – 20% off"',
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

    PRIMARY KEY (id),
    UNIQUE KEY uq_promotions_org_code (organization_id, code),
    KEY idx_promotions_organization_id (organization_id),
    KEY idx_promotions_promotion_type (promotion_type),
    KEY idx_promotions_is_active (is_active),
    KEY idx_promotions_dates (starts_at, ends_at) COMMENT 'Optimises WHERE starts_at <= NOW() AND (ends_at IS NULL OR ends_at >= NOW())',
    KEY idx_promotions_code (code),
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

    PRIMARY KEY (id),
    SPATIAL KEY spx_service_areas_boundary (boundary),
    KEY idx_service_areas_organization_id (organization_id),
    KEY idx_service_areas_site_id (site_id),
    KEY idx_service_areas_status (status),
    CONSTRAINT fk_service_areas_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_service_areas_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: coverage_zones
-- Purpose: Coverage zones within a service area — finer-grained polygons
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

    PRIMARY KEY (id),
    SPATIAL KEY spx_coverage_zones_boundary (boundary),
    KEY idx_coverage_zones_service_area_id (service_area_id),
    KEY idx_coverage_zones_zone_type (zone_type),
    KEY idx_coverage_zones_status (status),
    CONSTRAINT fk_coverage_zones_service_area FOREIGN KEY (service_area_id)
        REFERENCES service_areas (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: sla_definitions
-- Purpose: SLA (Service Level Agreement) terms per plan — uptime guarantees,
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

-- ---------------------------------------------------------------------------
-- Table: device_config_backups
-- Purpose: Versioned configuration snapshots per device — MikroTik exports,
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
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_device_config_backups_device_version (device_id, version),
    KEY idx_device_config_backups_device_id (device_id),
    KEY idx_device_config_backups_config_type (config_type),
    KEY idx_device_config_backups_capture_method (capture_method),
    KEY idx_device_config_backups_checksum (checksum),
    KEY idx_device_config_backups_created_at (created_at),
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
--          going to the factura pública aggregate (venta al público en general).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_mx_profiles (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id               BIGINT UNSIGNED NOT NULL
                                COMMENT 'References clients(id) — one profile per client',
    rfc                     VARCHAR(13)     NOT NULL
                                COMMENT 'Registro Federal de Contribuyentes — 12 chars for companies, 13 for individuals; XAXX010101000 for público en general',
    rfc_unique_check        VARCHAR(13)     AS (CASE WHEN rfc = 'XAXX010101000' THEN NULL ELSE rfc END) STORED
                                COMMENT 'Generated column for conditional uniqueness — NULL for público en general (allows duplicates), non-NULL for real RFCs (enforces uniqueness)',
    curp                    VARCHAR(18)     NULL
                                COMMENT 'Clave Única de Registro de Población — personal clients only',
    razon_social            VARCHAR(300)    NOT NULL
                                COMMENT 'Legal name exactly as registered with SAT — must match for CFDI validation',
    regimen_fiscal          VARCHAR(3)      NOT NULL
                                COMMENT 'SAT fiscal regime code from c_RegimenFiscal (e.g. 601, 612, 626)',
    codigo_postal_fiscal    VARCHAR(5)      NOT NULL
                                COMMENT 'Fiscal ZIP code as registered with SAT — required on CFDI 4.0 receptor node',
    uso_cfdi_default        VARCHAR(4)      NULL
                                COMMENT 'Default CFDI use code from c_UsoCFDI (e.g. G03, S01) — pre-filled on new invoices',
    colonia                 VARCHAR(150)    NULL
                                COMMENT 'Neighborhood — required for Mexican addresses on CFDI',
    municipio               VARCHAR(150)    NULL
                                COMMENT 'Municipality — required for Mexican addresses on CFDI',
    exterior_number         VARCHAR(20)     NULL
                                COMMENT 'Street exterior number',
    interior_number         VARCHAR(20)     NULL
                                COMMENT 'Suite / interior number',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_client_mx_profiles_client_id (client_id),
    UNIQUE KEY uq_client_mx_profiles_rfc (rfc_unique_check),
    KEY idx_client_mx_profiles_rfc (rfc),
    KEY idx_client_mx_profiles_regimen_fiscal (regimen_fiscal),
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
                                COMMENT 'References organizations(id) — one profile per organization',

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
                                COMMENT 'CSD private key encrypted at rest (.key) — app handles encryption',
    csd_valid_from          DATE            NULL
                                COMMENT 'CSD certificate validity start date',
    csd_valid_to            DATE            NULL
                                COMMENT 'CSD certificate expiry date — alerts should fire before this date',

    -- PAC (Proveedor Autorizado de Certificación) integration
    pac_provider            VARCHAR(50)     NULL
                                COMMENT 'PAC provider name (e.g. Finkok, TimbraSoft, SW Sapien)',
    pac_username            VARCHAR(255)    NULL
                                COMMENT 'PAC API username',
    pac_password_enc        VARCHAR(500)    NULL
                                COMMENT 'PAC API password encrypted at rest — app handles encryption',
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
                                COMMENT 'Next available folio number — incremented atomically by the app on each issue',

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

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_mx_profiles_org_id (organization_id),
    UNIQUE KEY uq_organization_mx_profiles_rfc (rfc),
    KEY idx_organization_mx_profiles_pac_environment (pac_environment),
    CONSTRAINT fk_organization_mx_profiles_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: sat_regimen_fiscal
-- Purpose: SAT catalog c_RegimenFiscal — fiscal regime codes used on CFDI 4.0
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
  COMMENT='SAT catalog: c_RegimenFiscal — fiscal regime codes for CFDI 4.0';

-- ---------------------------------------------------------------------------
-- Table: sat_uso_cfdi
-- Purpose: SAT catalog c_UsoCFDI — permitted use codes for the CFDI receptor.
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
  COMMENT='SAT catalog: c_UsoCFDI — permitted use codes for CFDI 4.0 receptor';

-- ---------------------------------------------------------------------------
-- Table: sat_forma_pago
-- Purpose: SAT catalog c_FormaPago — how a payment was or will be made.
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
  COMMENT='SAT catalog: c_FormaPago — how a payment was or will be made';

-- ---------------------------------------------------------------------------
-- Table: sat_metodo_pago
-- Purpose: SAT catalog c_MetodoPago — PUE or PPD payment timing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_metodo_pago (
    code        VARCHAR(3)      NOT NULL
                    COMMENT 'SAT c_MetodoPago code: PUE (pago en una sola exhibición) or PPD (pago en parcialidades o diferido)',
    description VARCHAR(200)    NOT NULL
                    COMMENT 'Official SAT description in Spanish',
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    PRIMARY KEY (code),
    KEY idx_sat_metodo_pago_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SAT catalog: c_MetodoPago — PUE or PPD payment timing';

-- ---------------------------------------------------------------------------
-- Table: sat_tipo_comprobante
-- Purpose: SAT catalog c_TipoDeComprobante — CFDI document type.
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
  COMMENT='SAT catalog: c_TipoDeComprobante — CFDI document type';

-- ---------------------------------------------------------------------------
-- Table: sat_moneda
-- Purpose: SAT catalog c_Moneda (subset) — currencies accepted in CFDI 4.0.
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
  COMMENT='SAT catalog: c_Moneda — currencies accepted in CFDI 4.0';

-- ---------------------------------------------------------------------------
-- Seed data: SAT CFDI 4.0 catalog tables (migration 069)
-- Uses INSERT IGNORE for idempotent re-runs.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO sat_regimen_fiscal (code, description, applies_to, status) VALUES
('601', 'General de Ley Personas Morales',                                          'company',  'active'),
('603', 'Personas Morales con Fines no Lucrativos',                                 'company',  'active'),
('605', 'Sueldos y Salarios e Ingresos Asimilados a Salarios',                      'personal', 'active'),
('606', 'Arrendamiento',                                                             'personal', 'active'),
('608', 'Demás ingresos',                                                            'personal', 'active'),
('610', 'Residentes en el Extranjero sin Establecimiento Permanente en México',      'both',     'active'),
('612', 'Personas Físicas con Actividades Empresariales y Profesionales',            'personal', 'active'),
('614', 'Ingresos por intereses',                                                    'personal', 'active'),
('616', 'Sin obligaciones fiscales',                                                 'personal', 'active'),
('620', 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',  'company',  'active'),
('621', 'Incorporación Fiscal',                                                      'personal', 'active'),
('622', 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',                 'company',  'active'),
('623', 'Opcional para Grupos de Sociedades',                                        'company',  'active'),
('624', 'Coordinados',                                                               'company',  'active'),
('625', 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', 'personal', 'active'),
('626', 'Régimen Simplificado de Confianza',                                         'both',     'active');

INSERT IGNORE INTO sat_uso_cfdi (code, description, applies_to, status) VALUES
('G01', 'Adquisición de mercancias',                                        'both',     'active'),
('G02', 'Devoluciones, descuentos o bonificaciones',                        'both',     'active'),
('G03', 'Gastos en general',                                                'both',     'active'),
('I01', 'Construcciones',                                                   'both',     'active'),
('I02', 'Mobilario y equipo de oficina por inversiones',                    'both',     'active'),
('I03', 'Equipo de transporte',                                             'both',     'active'),
('I04', 'Equipo de computo y accesorios',                                   'both',     'active'),
('I08', 'Otra maquinaria y equipo',                                         'both',     'active'),
('D01', 'Honorarios médicos, dentales y gastos hospitalarios',              'personal', 'active'),
('D02', 'Gastos médicos por incapacidad o discapacidad',                    'personal', 'active'),
('D03', 'Gastos funerales',                                                 'personal', 'active'),
('D04', 'Donativos',                                                        'personal', 'active'),
('P01', 'Por definir',                                                      'both',     'active'),
('S01', 'Sin efectos fiscales',                                             'both',     'active'),
('CP01', 'Pagos',                                                           'both',     'active');

INSERT IGNORE INTO sat_forma_pago (code, description, status) VALUES
('01', 'Efectivo',                                                          'active'),
('02', 'Cheque nominativo',                                                 'active'),
('03', 'Transferencia electrónica de fondos',                               'active'),
('04', 'Tarjeta de crédito',                                                'active'),
('05', 'Monedero electrónico',                                              'active'),
('06', 'Dinero electrónico',                                                'active'),
('08', 'Vales de despensa',                                                 'active'),
('12', 'Dación en pago',                                                    'active'),
('13', 'Pago por subrogación',                                              'active'),
('14', 'Pago por consignación',                                             'active'),
('15', 'Condonación',                                                       'active'),
('17', 'Compensación',                                                      'active'),
('23', 'Novación',                                                          'active'),
('24', 'Confusión',                                                         'active'),
('25', 'Remisión de deuda',                                                 'active'),
('26', 'Prescripción o caducidad',                                          'active'),
('27', 'A satisfacción del acreedor',                                       'active'),
('28', 'Tarjeta de débito',                                                 'active'),
('29', 'Tarjeta de servicios',                                              'active'),
('30', 'Aplicación de anticipos',                                           'active'),
('31', 'Intermediario pagos',                                               'active'),
('99', 'Por definir',                                                       'active');

INSERT IGNORE INTO sat_metodo_pago (code, description, status) VALUES
('PUE', 'Pago en una sola exhibición',              'active'),
('PPD', 'Pago en parcialidades o diferido',         'active');

INSERT IGNORE INTO sat_tipo_comprobante (code, description, status) VALUES
('I', 'Ingreso',    'active'),
('E', 'Egreso',     'active'),
('P', 'Pago',       'active'),
('T', 'Traslado',   'active'),
('N', 'Nómina',     'active');

INSERT IGNORE INTO sat_moneda (code, description, decimals, status) VALUES
('MXN', 'Peso Mexicano',                    2, 'active'),
('USD', 'Dólar americano',                  2, 'active'),
('EUR', 'Euro',                             2, 'active'),
('XXX', 'Los derechos en esta divisa',      2, 'active');

-- ---------------------------------------------------------------------------
-- Table: sat_clave_prod_serv
-- Purpose: SAT catalog c_ClaveProdServ — product and service classification
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
  COMMENT='SAT catalog: c_ClaveProdServ — product and service classification codes for CFDI 4.0 concepts';

-- ---------------------------------------------------------------------------
-- Table: sat_clave_unidad
-- Purpose: SAT catalog c_ClaveUnidad — unit-of-measure codes required on
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
  COMMENT='SAT catalog: c_ClaveUnidad — unit-of-measure codes for CFDI 4.0 concepts';

-- ---------------------------------------------------------------------------
-- Seed data: SAT c_ClaveProdServ and c_ClaveUnidad (migration 082)
-- ISP-relevant subset. Uses INSERT IGNORE for idempotent re-runs.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO sat_clave_prod_serv (code, description, status) VALUES
('81161700', 'Servicios de acceso a Internet',                   'active'),
('81161500', 'Servicios de telefonía y voz sobre IP (VoIP)',     'active'),
('81112200', 'Soporte técnico',                                  'active'),
('81112100', 'Mantenimiento y actualización de software',        'active'),
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
                                COMMENT 'SAT c_UsoCFDI — receptor intended use (e.g. G03, S01)',
    metodo_pago             VARCHAR(3)      NULL
                                COMMENT 'SAT c_MetodoPago: PUE or PPD',
    forma_pago              VARCHAR(2)      NULL
                                COMMENT 'SAT c_FormaPago: payment instrument code (e.g. 03, 28)',

    -- Currency
    moneda                  VARCHAR(3)      NOT NULL DEFAULT 'MXN'
                                COMMENT 'SAT c_Moneda currency code',
    tipo_cambio             DECIMAL(10, 4)  NULL
                                COMMENT 'Exchange rate to MXN when moneda != MXN; NULL when moneda = MXN',

    -- Receiver snapshot (denormalized at stamp time — must match SAT records)
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

    -- Source document linkage (polymorphic — at most one may be non-NULL)
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
    CONSTRAINT fk_cfdi_documents_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_credit_note FOREIGN KEY (credit_note_id)
        REFERENCES credit_notes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cfdi_documents_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE,
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
-- Purpose: CfdiRelacionados (CFDI 4.0) — tracks relationships between CFDIs,
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
                            COMMENT 'SAT c_TipoRelacion code (e.g. 01=nota de crédito, 04=sustitución)',
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
-- Purpose: Complemento de Pago 2.0 (Recibo Electrónico de Pago) headers.
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
                            COMMENT 'SAT c_FormaPago — how the payment was made (e.g. 03=transfer, 28=debit card)',
    moneda              VARCHAR(3)      NOT NULL DEFAULT 'MXN'
                            COMMENT 'SAT c_Moneda — currency the payment was received in',
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
                            COMMENT 'SAT c_Moneda — currency of the document being paid (MonedaDR)',
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

    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_pci_complement_id (complement_id),
    KEY idx_cfdi_pci_related_uuid (related_cfdi_uuid),
    CONSTRAINT fk_cfdi_pci_complement FOREIGN KEY (complement_id)
        REFERENCES cfdi_payment_complements (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: cfdi_conceptos
-- Purpose: CFDI 4.0 concept (line item) rows — one per <Concepto> node inside
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
                            COMMENT 'Line total: cantidad × valor_unitario (before discount)',
    descuento           DECIMAL(14, 4)      NULL
                            COMMENT 'Discount amount applied to this line; NULL when no discount',

    -- SAT tax object indicator (ObjetoImp)
    objeto_imp          ENUM('01', '02', '03') NOT NULL DEFAULT '02'
                            COMMENT 'SAT ObjetoImp: 01=No objeto de impuesto, 02=Sí objeto de impuesto, 03=Sí objeto del impuesto y no obligado al desglose',

    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_conceptos_cfdi_document_id (cfdi_document_id),
    KEY idx_cfdi_conceptos_clave_prod_serv (clave_prod_serv),

    CONSTRAINT fk_cfdi_conceptos_cfdi_document FOREIGN KEY (cfdi_document_id)
        REFERENCES cfdi_documents (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='CFDI 4.0 concept (line item) rows — one row per <Concepto> node inside a cfdi_document';

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
                            COMMENT 'Calculated tax amount: base × tasa_o_cuota; NULL when tipo_factor = Exento',

    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_cfdi_ci_cfdi_concepto_id (cfdi_concepto_id),
    KEY idx_cfdi_ci_tax_type (tax_type),
    KEY idx_cfdi_ci_impuesto (impuesto),

    CONSTRAINT fk_cfdi_ci_cfdi_concepto FOREIGN KEY (cfdi_concepto_id)
        REFERENCES cfdi_conceptos (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-line tax breakdown for CFDI 4.0 — one row per <Traslado> or <Retencion> inside a <Concepto>';

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
                            COMMENT 'IFT = Instituto Federal de Telecomunicaciones (pre-2025); CRT = Comisión de Regulación de Telecomunicaciones (from 2025)',
    document_file_id    BIGINT UNSIGNED NULL
                            COMMENT 'Reference to the official title document in the files table',
    status              ENUM('active', 'expired', 'revoked', 'pending_renewal')
                            NOT NULL DEFAULT 'active'
                            COMMENT 'active=valid; expired=past expiry; revoked=cancelled by authority; pending_renewal=renewal in progress',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_concession_titles_title_number (title_number),
    KEY idx_concession_titles_organization_id (organization_id),
    KEY idx_concession_titles_status (status),
    KEY idx_concession_titles_regulatory_body (regulatory_body),
    KEY idx_concession_titles_expiration_date (expiration_date),
    CONSTRAINT fk_concession_titles_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_concession_titles_document FOREIGN KEY (document_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: contract_templates_mx
-- Purpose: IFT/CRT-registered Carta de Adhesión templates. Mexican ISPs must
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

    PRIMARY KEY (id),
    KEY idx_contract_templates_mx_organization_id (organization_id),
    KEY idx_contract_templates_mx_status (status),
    KEY idx_contract_templates_mx_registered_at (registered_at),
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

    PRIMARY KEY (id),
    KEY idx_regulatory_filings_organization_id (organization_id),
    KEY idx_regulatory_filings_concession_title_id (concession_title_id),
    KEY idx_regulatory_filings_filing_type (filing_type),
    KEY idx_regulatory_filings_status (status),
    KEY idx_regulatory_filings_filed_at (filed_at),
    KEY idx_regulatory_filings_period_start (period_start),
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

    -- Subscriber counts
    total_subscribers           INT UNSIGNED    NOT NULL DEFAULT 0
                                    COMMENT 'Total active subscribers at the end of the period',
    subscribers_by_speed_tier   JSON            NULL
                                    COMMENT 'JSON object: speed tier label => subscriber count (e.g. {"10Mbps":120,"50Mbps":300})',
    subscribers_by_state        JSON            NULL
                                    COMMENT 'JSON object: state code => subscriber count',
    subscribers_by_technology   JSON            NULL
                                    COMMENT 'JSON object: technology label => subscriber count (e.g. {"fiber":200,"wireless":220})',
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

    -- Revenue (optional — may be omitted if reported separately)
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

    created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ift_statistical_reports_org_period (organization_id, report_period),
    KEY idx_ift_statistical_reports_organization_id (organization_id),
    KEY idx_ift_statistical_reports_status (status),
    KEY idx_ift_statistical_reports_period_start (period_start),
    KEY idx_ift_statistical_reports_filing_id (filing_id),
    CONSTRAINT fk_ift_statistical_reports_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ift_statistical_reports_filing FOREIGN KEY (filing_id)
        REFERENCES regulatory_filings (id) ON DELETE SET NULL ON UPDATE CASCADE,
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
-- 1. client_mx_profiles — require clients.locale = 'MX'
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
-- 2. organization_mx_profiles — require organizations.locale = 'MX'
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
-- 3. cfdi_documents — require clients.locale = 'MX'
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
-- 4. concession_titles — require organizations.locale = 'MX'
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
-- 5. contract_templates_mx — require organizations.locale = 'MX'
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
-- 6. regulatory_filings — require organizations.locale = 'MX'
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
-- 7. ift_statistical_reports — require organizations.locale = 'MX'
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
-- 8. contracts — require clients.locale = 'MX' when
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
-- clients — prevent locale downgrade from 'MX' to 'global'
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
-- organizations — prevent locale downgrade from 'MX' to 'global'
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
-- Purpose: Factura pública (venta al público en general) periodic aggregation
--          documents.  When MX-locale contracts have facturar = FALSE, their
--          invoices are aggregated into a periodic factura pública per the SAT
--          InformacionGlobal node fields (Periodicidad, Meses, Año).  One row
--          per organization per period.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factura_publica_invoices (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,

    -- Issuer
    organization_id         BIGINT UNSIGNED  NOT NULL
                                COMMENT 'Organization (ISP) issuing this factura pública',

    -- Link to the stamped CFDI record (NULL while accumulating / draft)
    cfdi_document_id        BIGINT UNSIGNED  NULL
                                COMMENT 'Stamped CFDI document record; NULL while the factura pública is still in draft',

    -- SAT InformacionGlobal node fields
    periodicidad            ENUM('01', '02', '03', '04', '05') NOT NULL
                                COMMENT 'SAT c_Periodicidad: 01=Diario, 02=Semanal, 03=Quincenal, 04=Mensual, 05=Bimestral',
    meses                   VARCHAR(2)       NOT NULL
                                COMMENT 'SAT c_Meses: 01-12=individual month, 13=Ene-Feb, 14=Mar-Abr, 15=May-Jun, 16=Jul-Ago, 17=Sep-Oct, 18=Nov-Dic',
    anio                    SMALLINT UNSIGNED NOT NULL
                                COMMENT 'Fiscal year for the InformacionGlobal node (e.g. 2026)',

    -- Aggregated totals (denormalized for quick reads)
    subtotal                DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Sum of all público en general invoice subtotals in this period',
    total_impuestos         DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Total transferred taxes for the period',
    total                   DECIMAL(14, 2)   NOT NULL DEFAULT 0.00
                                COMMENT 'Grand total: subtotal + total_impuestos',

    -- Lifecycle
    status                  ENUM('draft', 'stamped', 'cancelled') NOT NULL DEFAULT 'draft'
                                COMMENT 'draft=accumulating invoices; stamped=factura pública issued via PAC; cancelled=voided',

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
  COMMENT='Factura pública (venta al público en general) — periodic aggregation of non-facturar sales per SAT CFDI 4.0 InformacionGlobal';

-- ---------------------------------------------------------------------------
-- Table: factura_publica_invoice_items
-- Purpose: Junction table linking individual invoices from contracts with
--          facturar = FALSE to their parent factura pública.  Each invoice
--          may belong to at most one factura pública document.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factura_publica_invoice_items (
    id                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    factura_publica_invoice_id      BIGINT UNSIGNED NOT NULL
                                        COMMENT 'Parent factura pública document this invoice is aggregated into',
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
  COMMENT='Links individual invoices to their parent factura pública — each invoice belongs to at most one factura pública';

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- Function: fn_predominant_forma_pago
-- Migration: 091_add_factura_publica_stamping_safeguards
-- Purpose: Returns the SAT FormaPago code (VARCHAR 2) that accounts for the
--          largest share of payments linked to the given factura pública.
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
                SET MESSAGE_TEXT = 'Cannot stamp factura pública: all linked invoices must have status = ''paid''. Remove or pay unpaid invoices before stamping.';
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
            SET MESSAGE_TEXT = 'Cannot add invoice to factura pública: invoice must have status = ''paid''.';
    END IF;
END$$

DELIMITER ;
