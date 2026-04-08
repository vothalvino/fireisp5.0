-- Migration: 046_add_organization_id_to_core_tables
-- Description: Adds organization_id FK column to the core tenant-scoped tables
--              (users, clients, sites, plans, warehouses) so that multiple ISP
--              tenants can share one database instance.  NULL default keeps
--              existing single-tenant deployments valid without any data changes.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Tenant organisation this user belongs to; NULL = single-tenant deployment'
        AFTER id,
    ADD KEY idx_users_organization_id (organization_id),
    ADD CONSTRAINT fk_users_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
ALTER TABLE clients
    ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Tenant organisation this client belongs to; NULL = single-tenant deployment'
        AFTER id,
    ADD KEY idx_clients_organization_id (organization_id),
    ADD CONSTRAINT fk_clients_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
ALTER TABLE sites
    ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Tenant organisation this site belongs to; NULL = single-tenant deployment'
        AFTER id,
    ADD KEY idx_sites_organization_id (organization_id),
    ADD CONSTRAINT fk_sites_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
ALTER TABLE plans
    ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Tenant organisation this plan belongs to; NULL = single-tenant deployment'
        AFTER id,
    ADD KEY idx_plans_organization_id (organization_id),
    ADD CONSTRAINT fk_plans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- warehouses
-- ---------------------------------------------------------------------------
ALTER TABLE warehouses
    ADD COLUMN organization_id BIGINT UNSIGNED NULL
        COMMENT 'Tenant organisation this warehouse belongs to; NULL = single-tenant deployment'
        AFTER id,
    ADD KEY idx_warehouses_organization_id (organization_id),
    ADD CONSTRAINT fk_warehouses_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;
