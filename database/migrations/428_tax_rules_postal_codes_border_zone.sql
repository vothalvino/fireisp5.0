-- =============================================================================
-- Migration 428 — postal-code matching on tax_rules, + MX border-region seeds
-- =============================================================================
-- Mexico has two IVA rates, not one. The standard rate is 16%, but the
-- "estímulo fiscal región fronteriza" decrees reduce it to 8%:
--
--   * REGIÓN FRONTERIZA NORTE — DOF 31/12/2018, extended by DOF 21/12/2021.
--   * REGIÓN FRONTERIZA SUR   — DOF 30/12/2020 (22 municipios).
--
-- Until now resolveTaxContext had exactly one rate per org, so a Mexican ISP
-- serving both sides of the line had to choose which half of its customers to
-- bill wrongly. tax_rules already modelled region-based tax and was wired to
-- nothing (it had a table, a route, a page, seeded permissions and zero
-- readers); this migration gives it the matching key it was missing and the
-- resolver starts consulting it.
--
-- ── THREE THINGS AN OPERATOR MUST KNOW ──────────────────────────────────────
--
-- 1. THE 8% RATE IS NOT AUTOMATIC IN LAW. The stimulus belongs to the
--    TAXPAYER, not the postal code: the ISP must be enrolled in SAT's
--    "Padrón de beneficiarios del estímulo para la región fronteriza" and
--    keep that enrolment current. Applying 8% without it is an underpayment.
--    Geography is a precondition, not the entitlement.
--
-- 2. THE DECREES ARE DEFINED BY MUNICIPIO, NOT BY CP. Postal codes are a
--    practical proxy: they mostly nest inside municipalities, but not
--    perfectly, and the municipality list can change when a decree is
--    amended. Treat the seeded ranges as a STARTING POINT to verify against
--    the current decree for your own service area — they are editable in
--    Billing → Tax Rules precisely so you can.
--
-- 3. THE SEED IS DELIBERATELY INCOMPLETE. It covers the ranges that are
--    unambiguous (the whole state of Baja California, and the major border
--    cities); it does not attempt every municipality in the decrees. That is
--    the SAFE direction to be wrong: an unmatched ZIP falls through to the
--    org's default rate — 16% — and over-taxing is recoverable with a credit
--    note, whereas under-taxing is a liability with SAT. Add your own ranges
--    rather than assuming a missing one means 16% is correct.
--
--    Municipalities in the decrees, for the operator completing this:
--      NORTE — Baja California (all); Sonora: San Luis Río Colorado, Puerto
--        Peñasco, Gral. Plutarco Elías Calles, Caborca, Altar, Sáric, Nogales,
--        Santa Cruz, Cananea, Naco, Agua Prieta; Chihuahua: Janos, Ascensión,
--        Juárez, Praxedis G. Guerrero, Guadalupe, Coyame del Sotol, Ojinaga,
--        Manuel Benavides; Coahuila: Ocampo, Acuña, Zaragoza, Jiménez, Piedras
--        Negras, Nava, Guerrero, Hidalgo; Nuevo León: Anáhuac; Tamaulipas:
--        Nuevo Laredo, Guerrero, Mier, Miguel Alemán, Camargo, Gustavo Díaz
--        Ordaz, Reynosa, Río Bravo, Valle Hermoso, Matamoros.
--      SUR — Campeche: Calakmul, Candelaria; Chiapas: Palenque, Ocosingo,
--        Benemérito de las Américas, Marqués de Comillas, Maravilla Tenejapa,
--        Las Margaritas, La Trinitaria, Frontera Comalapa, Amatenango de la
--        Frontera, Mazapa de Madero, Motozintla, Tapachula, Cacahoatán, Unión
--        Juárez, Tuxtla Chico, Metapa, Frontera Hidalgo, Suchiate; Tabasco:
--        Balancán, Tenosique; Quintana Roo: Othón P. Blanco.
--
-- ── FORMAT ──────────────────────────────────────────────────────────────────
-- postal_codes holds a comma-separated list of 5-digit codes and/or ranges:
--     '21000-22999,32000-32699,88000'
-- Matching happens in JS over the org's handful of active rules, so no index is
-- needed; the column is a list rather than a child table so the existing Tax
-- Rules CRUD screen can edit it without a sub-editor.
--
-- Rules are seeded PER MX-LOCALE ORG, not globally: TaxRule.hasOrgScope is true,
-- so a NULL-organization_id row would be invisible to every tenant that owns it.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_428_tax_rule_postal_codes;
DELIMITER //
CREATE PROCEDURE migration_428_tax_rule_postal_codes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tax_rules'
      AND COLUMN_NAME  = 'postal_codes'
  ) THEN
    ALTER TABLE tax_rules
      ADD COLUMN postal_codes VARCHAR(2000) NULL
        COMMENT 'Comma-separated 5-digit codes and/or ranges this rule applies to, e.g. "21000-22999,88000-88299". NULL = matches no ZIP (rule only applies via is_default) — migration 428'
        AFTER region;
  END IF;
END //
DELIMITER ;

CALL migration_428_tax_rule_postal_codes();
DROP PROCEDURE IF EXISTS migration_428_tax_rule_postal_codes;

-- ── Seed: one rule per MX-locale org, per border region ──────────────────────
-- WHERE NOT EXISTS keeps this idempotent and, just as importantly, means an
-- operator who has edited or deleted these rules is never overwritten on a
-- re-run.

INSERT INTO tax_rules (organization_id, name, region, postal_codes, tax_type, rate, is_default, status)
SELECT o.id,
       'IVA Región Fronteriza Norte (8%)',
       'Frontera Norte',
       -- Baja California (entire state) + the major northern border cities.
       '21000-22999,32000-32699,26000-26099,26200-26299,65000-65099,83400-83499,84000-84099,84200-84299,87300-87499,88000-88299,88500-88799',
       'vat', 0.0800, FALSE, 'active'
FROM organizations o
WHERE o.locale = 'MX'
  AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM tax_rules t
    WHERE t.organization_id = o.id AND t.name = 'IVA Región Fronteriza Norte (8%)'
  );

INSERT INTO tax_rules (organization_id, name, region, postal_codes, tax_type, rate, is_default, status)
SELECT o.id,
       'IVA Región Fronteriza Sur (8%)',
       'Frontera Sur',
       -- Chetumal (Othón P. Blanco) and Tapachula — the two largest of the 22
       -- southern municipios. The rest need adding per service area.
       '77000-77099,30700-30799',
       'vat', 0.0800, FALSE, 'active'
FROM organizations o
WHERE o.locale = 'MX'
  AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM tax_rules t
    WHERE t.organization_id = o.id AND t.name = 'IVA Región Fronteriza Sur (8%)'
  );
