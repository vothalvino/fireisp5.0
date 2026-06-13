-- =============================================================================
-- Migration 316: §16.4 Numbering & Addressing tables
-- =============================================================================
-- New tables:
--   phone_number_inventory      — VoIP/DID phone number inventory
--   number_portability_records  — MNP/FNP (mobile/fixed number portability)
--   numbering_blocks            — CNMC/IFT numbering block management
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: phone_number_inventory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phone_number_inventory (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    phone_number    VARCHAR(30)     NOT NULL,
    number_type     ENUM('geographic','non_geographic','mobile',
                         'toll_free','premium') NOT NULL DEFAULT 'geographic',
    lada            VARCHAR(10)     NULL COMMENT 'Area code (LADA) for Mexican numbering',
    status          ENUM('available','assigned','ported_in','ported_out',
                         'reserved','blocked') NOT NULL DEFAULT 'available',
    client_id       BIGINT UNSIGNED NULL,
    contract_id     BIGINT UNSIGNED NULL,
    assigned_at     TIMESTAMP       NULL,
    block_id        BIGINT UNSIGNED NULL COMMENT 'Parent numbering block (no FK — chicken-and-egg with numbering_blocks)',
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_phone_number_inventory_number (phone_number),
    CONSTRAINT fk_phone_num_inv_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_phone_num_inv_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_phone_num_inv_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='VoIP/DID phone number inventory with Mexican LADA support (§16.4)';

-- ---------------------------------------------------------------------------
-- Table: number_portability_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS number_portability_records (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id   BIGINT UNSIGNED NULL,
    phone_number      VARCHAR(30)     NOT NULL,
    port_type         ENUM('port_in','port_out') NOT NULL,
    donor_carrier     VARCHAR(100)    NULL COMMENT 'Previous carrier (port-in)',
    recipient_carrier VARCHAR(100)    NULL COMMENT 'Receiving carrier (port-out)',
    requested_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ported_at         TIMESTAMP       NULL,
    status            ENUM('requested','approved','rejected','cancelled','completed')
                                      NOT NULL DEFAULT 'requested',
    ifetel_reference  VARCHAR(100)    NULL COMMENT 'IFT/CRT/IFETEL reference number',
    client_id         BIGINT UNSIGNED NULL,
    notes             TEXT            NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_number_port_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_number_port_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='MNP/FNP number portability records with IFETEL reference tracking (§16.4)';

-- ---------------------------------------------------------------------------
-- Table: numbering_blocks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS numbering_blocks (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED NULL,
    block_prefix         VARCHAR(20)     NOT NULL COMMENT 'E.g. 55 for Mexico City, 33 for Guadalajara',
    range_start          VARCHAR(30)     NOT NULL,
    range_end            VARCHAR(30)     NOT NULL,
    block_size           INT UNSIGNED    NOT NULL DEFAULT 1000,
    assigned_by_authority ENUM('IFT','CRT','IFETEL') NOT NULL DEFAULT 'CRT',
    assigned_at          DATE            NULL,
    expires_at           DATE            NULL,
    status               ENUM('active','exhausted','returned','expired') NOT NULL DEFAULT 'active',
    sepomex_cp           VARCHAR(10)     NULL COMMENT 'SEPOMEX postal code for geographic blocks',
    inegi_code           VARCHAR(10)     NULL COMMENT 'INEGI geographic code',
    notes                TEXT            NULL,
    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_numbering_blocks_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='IFT/CRT/IFETEL numbered block assignments with SEPOMEX/INEGI codes (§16.4)';
