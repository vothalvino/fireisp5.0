-- Migration: 092_add_exportacion_to_cfdi_documents
-- Description: Adds the mandatory SAT CFDI 4.0 `Exportacion` attribute to the
--              cfdi_documents table.  The Exportacion field is required on the
--              <Comprobante> node by the SAT since CFDI 4.0 and must be present
--              even for domestic-only ISPs (value '01' = no export).
--
--              Values:
--                01 — No exporta (domestic transaction, most common for ISPs)
--                02 — Exportación definitiva
--                03 — Exportación temporal
--
--              The column is placed logically after the moneda/tipo_cambio pair.

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE cfdi_documents
    ADD COLUMN exportacion ENUM('01','02','03') NOT NULL DEFAULT '01'
        COMMENT 'SAT Exportacion: 01=No exporta, 02=Exportación definitiva, 03=Exportación temporal'
        AFTER tipo_cambio;

SET FOREIGN_KEY_CHECKS = 1;
