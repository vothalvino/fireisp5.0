-- Migration: 096_seed_missing_sat_catalog_entries
-- Description: Adds SAT catalog entries that were omitted from the initial seed
--              (migration 069).  Uses INSERT IGNORE to remain idempotent.
--
--              Missing sat_regimen_fiscal entries:
--                607 — Régimen de Enajenación o Adquisición de Bienes
--                609 — Consolidación
--                611 — Ingresos por Dividendos (y en general por las Sociedades y Asociaciones Civiles)
--                615 — Régimen de los ingresos por obtención de premios
--
--              Missing sat_uso_cfdi entries:
--                D05 — Primas por seguros de gastos médicos
--                D06 — Gastos de transportación escolar obligatoria
--                D07 — Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones
--                D08 — Pagos por servicios educativos (colegiaturas)
--                D09 — Aportaciones voluntarias al SAR
--                D10 — Primas por seguros de gastos médicos mayores

-- ------------------------------------------------------------
-- 1. sat_regimen_fiscal — missing entries
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_regimen_fiscal (code, description, applies_to, status) VALUES
('607', 'Régimen de Enajenación o Adquisición de Bienes',                          'personal', 'active'),
('609', 'Consolidación',                                                             'company',  'active'),
('611', 'Ingresos por Dividendos (y en general por las Sociedades y Asociaciones Civiles)', 'personal', 'active'),
('615', 'Régimen de los ingresos por obtención de premios',                         'personal', 'active');

-- ------------------------------------------------------------
-- 2. sat_uso_cfdi — missing D05–D10 entries
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_uso_cfdi (code, description, applies_to, status) VALUES
('D05', 'Primas por seguros de gastos médicos',                                                             'personal', 'active'),
('D06', 'Gastos de transportación escolar obligatoria',                                                     'personal', 'active'),
('D07', 'Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones',             'personal', 'active'),
('D08', 'Pagos por servicios educativos (colegiaturas)',                                                    'personal', 'active'),
('D09', 'Aportaciones voluntarias al SAR',                                                                  'personal', 'active'),
('D10', 'Primas por seguros de gastos médicos mayores',                                                     'personal', 'active');
