-- Migration: 087_create_mx_locale_enforcement_triggers
-- Description: Adds BEFORE INSERT / BEFORE UPDATE triggers on every MX-specific
--              table to enforce that the referenced client or organization has
--              locale = 'MX' before allowing the row.
--
--              Without these triggers the database accepts MX-specific records
--              (CFDI documents, IFT reports, client/org MX profiles, concession
--              titles, regulatory filings, MX contract templates) for clients or
--              organizations whose locale is 'global', which would allow global
--              entities to leak into country-specific regulatory reports and
--              e-invoicing workflows.
--
--              Also adds a trigger on contracts to prevent setting
--              contract_template_mx_id to a non-NULL value when the contract's
--              client has locale != 'MX'.
--
-- Tables guarded (7 MX-specific + 1 contracts):
--   client_mx_profiles       — requires clients.locale = 'MX'
--   organization_mx_profiles — requires organizations.locale = 'MX'
--   cfdi_documents           — requires clients.locale = 'MX'
--   concession_titles        — requires organizations.locale = 'MX'
--   contract_templates_mx    — requires organizations.locale = 'MX'
--   regulatory_filings       — requires organizations.locale = 'MX'
--   ift_statistical_reports  — requires organizations.locale = 'MX'
--   contracts                — requires clients.locale = 'MX' when
--                               contract_template_mx_id IS NOT NULL

DELIMITER $$

-- =========================================================================
-- 1. client_mx_profiles — require clients.locale = 'MX'
-- =========================================================================
DROP TRIGGER IF EXISTS trg_client_mx_profiles_bi$$
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

DROP TRIGGER IF EXISTS trg_client_mx_profiles_bu$$
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

-- =========================================================================
-- 2. organization_mx_profiles — require organizations.locale = 'MX'
-- =========================================================================
DROP TRIGGER IF EXISTS trg_organization_mx_profiles_bi$$
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

DROP TRIGGER IF EXISTS trg_organization_mx_profiles_bu$$
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

-- =========================================================================
-- 3. cfdi_documents — require clients.locale = 'MX'
-- =========================================================================
DROP TRIGGER IF EXISTS trg_cfdi_documents_bi$$
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

DROP TRIGGER IF EXISTS trg_cfdi_documents_bu$$
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

-- =========================================================================
-- 4. concession_titles — require organizations.locale = 'MX'
-- =========================================================================
DROP TRIGGER IF EXISTS trg_concession_titles_bi$$
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

DROP TRIGGER IF EXISTS trg_concession_titles_bu$$
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

-- =========================================================================
-- 5. contract_templates_mx — require organizations.locale = 'MX'
-- =========================================================================
DROP TRIGGER IF EXISTS trg_contract_templates_mx_bi$$
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

DROP TRIGGER IF EXISTS trg_contract_templates_mx_bu$$
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

-- =========================================================================
-- 6. regulatory_filings — require organizations.locale = 'MX'
-- =========================================================================
DROP TRIGGER IF EXISTS trg_regulatory_filings_bi$$
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

DROP TRIGGER IF EXISTS trg_regulatory_filings_bu$$
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

-- =========================================================================
-- 7. ift_statistical_reports — require organizations.locale = 'MX'
-- =========================================================================
DROP TRIGGER IF EXISTS trg_ift_statistical_reports_bi$$
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

DROP TRIGGER IF EXISTS trg_ift_statistical_reports_bu$$
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

-- =========================================================================
-- 8. contracts — require clients.locale = 'MX' when
--                contract_template_mx_id IS NOT NULL
-- =========================================================================
DROP TRIGGER IF EXISTS trg_contracts_mx_template_bi$$
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

DROP TRIGGER IF EXISTS trg_contracts_mx_template_bu$$
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

DELIMITER ;
