-- Migration: 121_seed_default_tax_rates
-- Description: Seeds the tax_rates table with globally applicable default
--              rates (organization_id = NULL) covering the most common
--              tax scenarios for a multi-country ISP deployment.
--
--              These rows give the billing UI a usable starting set without
--              requiring the administrator to create rates before issuing the
--              first invoice.
--
--              Uses a WHERE NOT EXISTS guard for full idempotency because the
--              tax_rates table does not carry a UNIQUE constraint on name alone
--              (names are unique per-organization, not globally).

INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT NULL, 'Tax Exempt', 0.0000,
       'Zero-rate — applies to tax-exempt services or clients (e.g. non-profit, reseller)',
       FALSE, 'active'
WHERE NOT EXISTS (
    SELECT 1 FROM tax_rates WHERE name = 'Tax Exempt' AND organization_id IS NULL
);

INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT NULL, 'Standard Tax 8%', 0.0800,
       'Generic 8% sales / service tax for regions without a specific rate configured',
       FALSE, 'active'
WHERE NOT EXISTS (
    SELECT 1 FROM tax_rates WHERE name = 'Standard Tax 8%' AND organization_id IS NULL
);

INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT NULL, 'IVA 16% (Mexico)', 0.1600,
       'Mexican IVA (Impuesto al Valor Agregado) 16% — standard rate for most ISP services in Mexico',
       FALSE, 'active'
WHERE NOT EXISTS (
    SELECT 1 FROM tax_rates WHERE name = 'IVA 16% (Mexico)' AND organization_id IS NULL
);

INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT NULL, 'GST 5%', 0.0500,
       'Canadian GST (Goods and Services Tax) 5%',
       FALSE, 'active'
WHERE NOT EXISTS (
    SELECT 1 FROM tax_rates WHERE name = 'GST 5%' AND organization_id IS NULL
);
