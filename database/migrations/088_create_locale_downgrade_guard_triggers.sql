-- Migration: 088_create_locale_downgrade_guard_triggers
-- Description: Prevents downgrading clients.locale or organizations.locale from
--              'MX' to 'global' when MX-dependent records exist.
--
--              Without these guards an operator could accidentally change a
--              client or organization back to 'global' while CFDI documents,
--              MX profiles, concession titles, regulatory filings, IFT reports,
--              or MX contract templates still reference them — silently breaking
--              the data-integrity guarantees established by migration 087.
--
-- Tables guarded:
--   clients       — blocks locale change to 'global' if client_mx_profiles or
--                    cfdi_documents rows exist
--   organizations — blocks locale change to 'global' if organization_mx_profiles,
--                    concession_titles, contract_templates_mx,
--                    regulatory_filings, or ift_statistical_reports rows exist

DELIMITER $$

-- =========================================================================
-- clients — prevent locale downgrade from 'MX' to 'global'
-- =========================================================================
CREATE TRIGGER trg_clients_locale_downgrade_bu
BEFORE UPDATE ON clients
FOR EACH ROW
BEGIN
    DECLARE v_mx_profile_count INT DEFAULT 0;
    DECLARE v_cfdi_count       INT DEFAULT 0;

    IF OLD.locale = 'MX' AND NEW.locale != 'MX' THEN
        SELECT COUNT(*) INTO v_mx_profile_count
        FROM client_mx_profiles
        WHERE client_id = OLD.id
        LIMIT 1;

        IF v_mx_profile_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change client locale from ''MX'': client_mx_profiles record exists. Delete the MX profile first.';
        END IF;

        SELECT COUNT(*) INTO v_cfdi_count
        FROM cfdi_documents
        WHERE client_id = OLD.id
        LIMIT 1;

        IF v_cfdi_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change client locale from ''MX'': cfdi_documents records exist for this client.';
        END IF;
    END IF;
END$$

-- =========================================================================
-- organizations — prevent locale downgrade from 'MX' to 'global'
-- =========================================================================
CREATE TRIGGER trg_organizations_locale_downgrade_bu
BEFORE UPDATE ON organizations
FOR EACH ROW
BEGIN
    DECLARE v_count INT DEFAULT 0;

    IF OLD.locale = 'MX' AND NEW.locale != 'MX' THEN
        -- Check organization_mx_profiles
        SELECT COUNT(*) INTO v_count
        FROM organization_mx_profiles
        WHERE organization_id = OLD.id
        LIMIT 1;

        IF v_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': organization_mx_profiles record exists.';
        END IF;

        -- Check concession_titles
        SELECT COUNT(*) INTO v_count
        FROM concession_titles
        WHERE organization_id = OLD.id
        LIMIT 1;

        IF v_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': concession_titles records exist.';
        END IF;

        -- Check contract_templates_mx
        SELECT COUNT(*) INTO v_count
        FROM contract_templates_mx
        WHERE organization_id = OLD.id
        LIMIT 1;

        IF v_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': contract_templates_mx records exist.';
        END IF;

        -- Check regulatory_filings
        SELECT COUNT(*) INTO v_count
        FROM regulatory_filings
        WHERE organization_id = OLD.id
        LIMIT 1;

        IF v_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': regulatory_filings records exist.';
        END IF;

        -- Check ift_statistical_reports
        SELECT COUNT(*) INTO v_count
        FROM ift_statistical_reports
        WHERE organization_id = OLD.id
        LIMIT 1;

        IF v_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot change organization locale from ''MX'': ift_statistical_reports records exist.';
        END IF;
    END IF;
END$$

DELIMITER ;
