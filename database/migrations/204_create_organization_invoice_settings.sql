-- Migration 204: organization_invoice_settings — invoice branding per org (§2.2 Phase B)

CREATE TABLE IF NOT EXISTS organization_invoice_settings (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED NOT NULL,
    logo_url             VARCHAR(500)    NULL     COMMENT 'URL for the org logo shown in PDF invoices',
    header_color         VARCHAR(7)      NULL     DEFAULT '#1a5276' COMMENT 'Hex colour for invoice PDF header',
    footer_legal         TEXT            NULL     COMMENT 'Legal disclaimer shown in invoice PDF footer',
    payment_instructions TEXT            NULL     COMMENT 'Payment instructions section in invoice PDF',
    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_org_invoice_settings (organization_id),
    CONSTRAINT fk_org_invoice_settings_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
