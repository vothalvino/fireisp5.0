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
    status         ENUM('active', 'expired', 'cancelled', 'pending') NOT NULL DEFAULT 'pending',
    created_by     BIGINT UNSIGNED NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_contracts_client_id (client_id),
    KEY idx_contracts_plan_id (plan_id),
    KEY idx_contracts_site_id (site_id),
    KEY idx_contracts_connection_type (connection_type),
    KEY idx_contracts_status (status),
    CONSTRAINT fk_contracts_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_plan FOREIGN KEY (plan_id)
        REFERENCES plans (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_contracts_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
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
    payment_method   ENUM('cash', 'check', 'credit_card', 'debit_card', 'bank_transfer', 'other')
                                     NOT NULL DEFAULT 'cash',
    reference_number VARCHAR(100)    NULL COMMENT 'Check number, transaction ID, etc.',
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
-- Purpose: Running client balance / account statement ledger. Each row records
--          a debit (invoice) or credit (payment, credit note, adjustment) and
--          maintains a running balance per client.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_balance_ledger (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    client_id       BIGINT UNSIGNED  NOT NULL,
    entry_type      ENUM('invoice', 'payment', 'credit_note', 'adjustment') NOT NULL,
    reference_id    BIGINT UNSIGNED  NULL     COMMENT 'Polymorphic ID of the invoice, payment, or credit_note',
    description     VARCHAR(255)     NULL,
    debit           DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount charged (increases balance owed)',
    credit          DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Amount credited (decreases balance owed)',
    running_balance DECIMAL(10, 2)   NOT NULL DEFAULT 0.00 COMMENT 'Client account balance after this entry',
    entry_date      DATE             NOT NULL,
    created_by      BIGINT UNSIGNED  NULL     COMMENT 'User who created this entry; NULL = system',
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ledger_client_id (client_id),
    KEY idx_ledger_entry_date (entry_date),
    KEY idx_ledger_entry_type (entry_type),
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
    CONSTRAINT fk_email_logs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_email_logs_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: scheduled_tasks
-- Purpose: App-level job queue / cron history for observability. Tracks every
--          scheduled task with last-run, next-run, and status beyond the MySQL
--          Event Scheduler's own limited history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    task_name         VARCHAR(100)     NOT NULL,
    description       VARCHAR(255)     NULL,
    cron_expression   VARCHAR(50)      NULL     COMMENT 'Cron expression, e.g. ''0 * * * *'' for every hour',
    last_run_at       TIMESTAMP        NULL,
    next_run_at       TIMESTAMP        NULL,
    last_status       ENUM('success', 'failed', 'running', 'skipped') NULL,
    last_error        TEXT             NULL,
    last_duration_ms  INT UNSIGNED     NULL     COMMENT 'Duration of the last run in milliseconds',
    is_enabled        BOOLEAN          NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_scheduled_tasks_name (task_name),
    KEY idx_scheduled_tasks_enabled_next (is_enabled, next_run_at)
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
        REFERENCES sites (id) ON DELETE CASCADE ON UPDATE CASCADE
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

SET FOREIGN_KEY_CHECKS = 1;
