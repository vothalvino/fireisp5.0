-- Migration: 065_add_locale_to_clients_and_organizations
-- Description: Introduces a locale column to both clients and organizations as
--              the master switch for regional compliance.
--
--              locale = 'global' (default) — lightweight, no Mexico-specific
--              requirements enforced.  Works for any country.
--
--              locale = 'MX' — activates SAT CFDI 4.0 e-invoicing validation
--              and IFT/CRT telecom-compliance checks at the application layer.
--              The app will require a client_mx_profiles / organization_mx_profiles
--              row to exist before finalizing MX documents.
--
--              Backfill: clients that already have a CURP value (Mexican personal
--              clients) are automatically set to locale = 'MX'.

ALTER TABLE clients
    ADD COLUMN locale ENUM('global', 'MX') NOT NULL DEFAULT 'global'
        COMMENT 'Regional compliance switch: global = no country-specific requirements; MX = SAT CFDI 4.0 + IFT/CRT compliance required'
        AFTER client_type;

ALTER TABLE clients
    ADD KEY idx_clients_locale (locale);

ALTER TABLE organizations
    ADD COLUMN locale ENUM('global', 'MX') NOT NULL DEFAULT 'global'
        COMMENT 'Regional compliance switch: global = no country-specific requirements; MX = SAT CFDI 4.0 + IFT/CRT compliance required'
        AFTER name;

ALTER TABLE organizations
    ADD KEY idx_organizations_locale (locale);

-- Backfill: mark existing clients that have a CURP as Mexican
UPDATE clients SET locale = 'MX' WHERE curp IS NOT NULL;
