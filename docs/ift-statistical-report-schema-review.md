# IFT Statistical Report — Schema Review

**Date:** 2026-04-21
**Status:** Draft for sign-off — **DO NOT proceed with UI or export work until reviewed and accepted by the regulatory lead.**
**Scope:** `ift_statistical_reports` table (migration 079), `IftStatisticalReport` model, and the `iftStatisticalReports` validation schema.
**Authority:** Ley Federal de Telecomunicaciones y Radiodifusión (LFTR) **Art. 175** and the IFT *Lineamientos Generales para la Presentación de Información Estadística por parte de los Concesionarios y Autorizados* (most recent published *Formato Estadístico* for fixed‑broadband / *Servicio Fijo de Internet*).

---

## 1. Why this review exists

The issue (`Validate FireISP IFT statistical report schema against official IFT requirements`) requested a formal, field-by-field validation **before** any UI or export work begins. Shipping UI on top of a schema that misses required IFT fields would force a re-issue of every previously stored snapshot and is a compliance risk under LFTR Art. 175.

This document is the deliverable. It does three things:

1. Lists the IFT-required fields for the *Formato Estadístico — Servicio Fijo de Internet*.
2. Compares them, field-by-field, against the three layers of the current implementation:
   - **DB**: `database/migrations/079_create_ift_statistical_reports_table.sql`
   - **Model**: `src/models/IftStatisticalReport.js` (`fillable` list)
   - **Schema**: `src/middleware/schemas/iftStatisticalReports.js` (validation)
3. Records the gaps and the mismatches *between our own layers*, with a recommended action for each.

Until each item below is either marked **Confirmed** or has a follow-up issue with an agreed resolution, the UI/export milestone stays blocked.

---

## 2. IFT-required fields (Formato Estadístico, Servicio Fijo de Internet)

Per the IFT Lineamientos and the published *Formato Estadístico* (Art. 175 LFTR), each periodic report from a concessionaire/authorized provider of fixed Internet must include at least the following data points. References below use the field labels published by IFT.

| # | IFT field | IFT description | Granularity |
|---|-----------|-----------------|-------------|
| F1 | `RFC` / `Concesionario` | Tax ID and registered name of the reporting party | Per filer |
| F2 | `Título de Concesión / Autorización` | Concession or authorization title number under which the service is provided | Per filer |
| F3 | `Periodo de reporte` | Reporting period (typically calendar quarter or month, MM/AAAA) | Per report |
| F4 | `Entidad federativa` | INEGI 2-digit state code | Required breakdown |
| F5 | `Municipio` | INEGI 3-digit municipality code | Required breakdown |
| F6 | `Localidad` | INEGI 4-digit locality code | Required breakdown |
| F7 | `Tecnología de acceso` | xDSL, HFC/Cable, FTTH/FTTB, fixed wireless (incl. WTTx/LTE/5G FWA), satellite, BPL, "otra" | Required breakdown |
| F8 | `Velocidad contratada de bajada` | Contracted downstream speed (Mbps) per package/tier | Required breakdown |
| F9 | `Velocidad contratada de subida` | Contracted upstream speed (Mbps) per package/tier | Required breakdown |
| F10 | `Accesos / Suscripciones` | Active subscriber/access count for the cell defined by F4–F9 | Count |
| F11 | `Tipo de contratación` | Residencial / No residencial (business) | Required breakdown |
| F12 | `Modalidad de pago` | Pospago / Prepago / Empaquetado | Required breakdown |
| F13 | `Ingresos del periodo` | Total revenue for the period attributable to the service (MXN, sin IVA) | Per cell or per filer |
| F14 | `Cobertura — localidades` | List of localities (INEGI codes) with at least one active access | Per filer |
| F15 | `Cobertura — municipios` | Count of municipalities with at least one active access | Per filer |
| F16 | `Disponibilidad / Calidad` | QoS metrics (availability %, mean speed delivered vs contracted, packet loss, latency) — reported via the QoS lineamientos but cross-referenced from the statistical report | Per filer / period |
| F17 | `Folio / Acuse` | Filing acknowledgment id returned by the IFT portal once submitted | Per submission |

> The QoS metrics (F16) are formally collected under a separate *Lineamientos de Calidad* filing, but the statistical report cross-references the same period and concession title, so the snapshot must be linkable by `(concession_title, period)`.

---

## 3. Field-by-field comparison vs current implementation

Legend:
- ✅ **Confirmed** — present and correctly typed in all three layers (DB, model, schema).
- ⚠️ **Partial** — present in some layers but missing or inconsistent in others.
- ❌ **Missing** — not represented at all.
- 🛑 **Mismatch** — a name/type discrepancy between layers that will silently drop data when writing through the model.

| IFT # | DB column (mig. 079) | Model `fillable` | Validation schema | Status | Notes / required action |
|-------|----------------------|------------------|-------------------|--------|------------------------|
| F1 (RFC / razón social) | *(via `organization_id` → `organizations` + `organization_mx_profiles.rfc`)* | `organization_id` (implicit via org scope) | — | ✅ Confirmed | Resolved at export time by joining `organization_mx_profiles`. |
| F2 (Título de concesión) | ❌ — no FK | ❌ | `concession_title_id` (number, optional) | 🛑 Mismatch | Validation accepts a value the DB cannot persist. Add `concession_title_id BIGINT UNSIGNED NULL` + FK to `concession_titles(id)` in a follow-up migration, then add it to `fillable`. |
| F3 (Periodo) | `report_period VARCHAR(10)`, `period_start DATE`, `period_end DATE` | `report_period` only | `report_period` only (max 20, but DB is 10) | 🛑 Mismatch | (a) `period_start` / `period_end` are NOT NULL in DB but never populated through the model — every insert from the API will fail. Add both to `fillable` and to the validation schema as `required: true` ISO dates. (b) Validation `max: 20` is wider than DB `VARCHAR(10)` — tighten to `max: 10`. |
| F4–F6 (Entidad / Municipio / Localidad breakdowns) | `subscribers_by_state JSON`, `coverage_localities JSON` | `subscribers_by_state`, *missing* `coverage_localities` (model exposes `coverage_municipalities` instead, which is a different DB column) | ❌ neither present | 🛑 Mismatch | (a) Model is missing `coverage_localities`. (b) Schema validates none of the breakdowns. (c) IFT also expects a per-municipio breakdown — add `subscribers_by_municipality JSON` (DB + model + schema) before exports. |
| F7 (Tecnología) | `subscribers_by_technology JSON` | `subscribers_by_technology` | ❌ not validated | ⚠️ Partial | Add to validation schema as `{ type: 'string', max: 5000 }` (JSON-string convention used elsewhere in this file). Document the allowed enum of technology labels (`xDSL`, `HFC`, `FTTH`, `FixedWireless`, `Satellite`, `BPL`, `Other`) in the OpenAPI description so the future UI uses the IFT vocabulary. |
| F8/F9 (Velocidades contratadas de bajada/subida — *per tier*) | `subscribers_by_speed_tier JSON`, `avg_download_speed_mbps DECIMAL(8,2)`, `avg_upload_speed_mbps DECIMAL(8,2)` | `subscribers_by_speed_tier`, `avg_download_speed`, `avg_upload_speed` | `subscribers_by_speed_tier`, `avg_download_speed`, `avg_upload_speed` | 🛑 Mismatch | The model and schema use the column names **without** the `_mbps` suffix; the actual DB columns include `_mbps`. Every insert/update through the model writes to columns that do not exist → silent data loss when MySQL `STRICT_TRANS_TABLES` is off, hard error when on. Rename in model + schema to `avg_download_speed_mbps` / `avg_upload_speed_mbps`. |
| F10 (Accesos totales) | `total_subscribers INT UNSIGNED NOT NULL DEFAULT 0` | ❌ missing | `subscribers_count` (number, ≥ 0) | 🛑 Mismatch | Schema field `subscribers_count` does not match DB column `total_subscribers`. Pick one name (recommend `total_subscribers` to match the migration) and align all three layers. The current code path silently drops the value. |
| F11 (Residencial / No residencial) | ❌ | ❌ | ❌ | ❌ Missing | Required breakdown. Add `subscribers_by_customer_type JSON` (e.g. `{"residential": 1234, "business": 56}`). |
| F12 (Pospago / Prepago / Empaquetado) | ❌ | ❌ | ❌ | ❌ Missing | Required breakdown. Add `subscribers_by_payment_modality JSON`. |
| F13 (Ingresos) | `revenue_total DECIMAL(14,2)` | `revenue` | `revenue` | 🛑 Mismatch | Same issue as F8/F9 — model/schema name (`revenue`) does not match DB column (`revenue_total`). Rename to `revenue_total` everywhere. Document that the value is in MXN and excludes IVA. |
| F14 (Localidades cubiertas) | `coverage_localities JSON` | ❌ missing | ❌ missing | 🛑 Mismatch | Add to `fillable` and validation schema. |
| F15 (Municipios cubiertos) | `coverage_municipalities INT UNSIGNED` | `coverage_municipalities` | ❌ missing | ⚠️ Partial | Add to validation schema as `{ type: 'number', min: 0 }`. |
| F16 (QoS cross-reference) | *(via `filing_id` → `regulatory_filings`)* | ❌ missing | ❌ missing | ⚠️ Partial | Expose `filing_id` and `filed_at` through the model so an operator can link a snapshot to the QoS filing already submitted. |
| F17 (Folio / acuse) | *(stored on `regulatory_filings`)* | n/a | n/a | ✅ Confirmed | Out of scope for this table — handled by `regulatory_filings`. |
| (housekeeping) `status` | `ENUM('draft','final','filed')` | `status` | `status` (enum match) | ✅ Confirmed | — |
| (housekeeping) `notes` | ❌ — no column | ❌ | `notes` (string, max 5000) | 🛑 Mismatch | Either add `notes TEXT NULL` to the table (recommended — useful for filing comments) or remove from validation schema. |

---

## 4. Internal mismatches found (independent of IFT)

Even before IFT compliance, there are integrity bugs between the three layers that must be fixed:

1. **`avg_download_speed` / `avg_upload_speed`** in model+schema vs **`avg_download_speed_mbps` / `avg_upload_speed_mbps`** in DB — writes are silently dropped (or fail under `STRICT_TRANS_TABLES`).
2. **`revenue`** in model+schema vs **`revenue_total`** in DB — same silent-drop bug.
3. **`subscribers_count`** in schema does not exist in the model, and DB calls it **`total_subscribers`** — every POST that uses the documented field name is a no-op.
4. **`period_start` / `period_end`** are `NOT NULL` in DB but absent from `fillable` and the validation schema, so any insert via the model raises `ER_NO_DEFAULT_FOR_FIELD`.
5. **`concession_title_id`** is in the validation schema but has no corresponding DB column or model field.
6. **`notes`** is in the validation schema but has no corresponding DB column or model field.
7. **`coverage_localities`** is in the DB but missing from `fillable` and the validation schema.
8. **`subscribers_by_state` / `subscribers_by_technology`** are in DB and `fillable` but never validated (no length/type guard for the JSON-string payload).

These are bugs regardless of IFT requirements, and they must be fixed in lock-step with the IFT alignment work below.

---

## 5. Recommendations and gating decisions

**Block the UI/export milestone until the following are addressed:**

- [ ] **Migration `080_align_ift_statistical_reports_with_ift_format.sql`** — adds `concession_title_id`, `subscribers_by_municipality`, `subscribers_by_customer_type`, `subscribers_by_payment_modality`, `notes`; adds FK to `concession_titles(id)`.
- [ ] **Model `fillable` rewrite** to mirror DB columns 1:1 (use the `_mbps` and `_total` suffixes; add `period_start`, `period_end`, `coverage_localities`, `concession_title_id`, `total_subscribers`, `filing_id`, `filed_at`).
- [ ] **Validation schema rewrite** mirroring the new `fillable`; require `period_start`, `period_end` and the renamed `total_subscribers`/`avg_*_speed_mbps`/`revenue_total`. Tighten `report_period` to `max: 10` (matches `VARCHAR(10)`).
- [ ] **OpenAPI regeneration** so the published request bodies use the IFT field vocabulary (the future UI consumes the typed client).
- [ ] **Tests** for the validation schema covering each newly-required field and each renamed field.
- [ ] **Sign-off** from the regulatory lead that the *Tecnología* enum, the *Tipo de contratación* enum, and the *Modalidad de pago* enum match the latest published IFT formato.

Once those items are merged and the regulatory lead has signed off this document, the UI and CSV/XLSX export work tracked under the *Reporting / Export* milestone may begin.

**Confirmations (no change required):**

- Snapshot-per-`(organization_id, report_period)` shape is correct (see `uq_ift_statistical_reports_org_period`).
- `status` enum (`draft` / `final` / `filed`) matches the workflow expected by the regulatory team.
- Linkage to `regulatory_filings` via `filing_id` correctly captures F16 and F17 once the filing exists.
- MX-locale enforcement triggers (migration 087) and the locale downgrade guard (migration 088) already cover this table — no additional locale work is needed.

---

## 6. References

- LFTR, Art. 175 — obligación de los concesionarios y autorizados de entregar información estadística al Instituto.
- IFT — *Lineamientos Generales para la Presentación de Información Estadística* (publicación más reciente en el DOF).
- IFT — *Formato Estadístico — Servicio Fijo de Internet* (descargable desde el portal del IFT, <https://www.ift.org.mx/>).
- INEGI — Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades (códigos usados en F4–F6).
- Internal: migration `database/migrations/079_create_ift_statistical_reports_table.sql`, model `src/models/IftStatisticalReport.js`, schema `src/middleware/schemas/iftStatisticalReports.js`, routes `src/routes/iftStatisticalReports.js`.
