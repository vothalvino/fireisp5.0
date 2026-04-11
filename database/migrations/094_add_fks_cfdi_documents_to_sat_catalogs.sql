-- Migration: 094_add_fks_cfdi_documents_to_sat_catalogs
-- Description: Adds foreign key constraints from cfdi_documents to the SAT
--              catalog tables created in migration 068.
--
--              Fields constrained:
--                tipo_comprobante → sat_tipo_comprobante(code)
--                uso_cfdi         → sat_uso_cfdi(code)
--                metodo_pago      → sat_metodo_pago(code)   (NULLable — FK still valid)
--                forma_pago       → sat_forma_pago(code)    (NULLable — FK still valid)
--                moneda           → sat_moneda(code)
--
--              This prevents invalid SAT codes from being stored and keeps the
--              database consistent with the SAT CFDI 4.0 catalogs.

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE cfdi_documents
    ADD CONSTRAINT fk_cfdi_documents_tipo_comprobante
        FOREIGN KEY (tipo_comprobante) REFERENCES sat_tipo_comprobante (code)
        ON UPDATE CASCADE,
    ADD CONSTRAINT fk_cfdi_documents_uso_cfdi
        FOREIGN KEY (uso_cfdi) REFERENCES sat_uso_cfdi (code)
        ON UPDATE CASCADE,
    ADD CONSTRAINT fk_cfdi_documents_metodo_pago
        FOREIGN KEY (metodo_pago) REFERENCES sat_metodo_pago (code)
        ON UPDATE CASCADE,
    ADD CONSTRAINT fk_cfdi_documents_forma_pago
        FOREIGN KEY (forma_pago) REFERENCES sat_forma_pago (code)
        ON UPDATE CASCADE,
    ADD CONSTRAINT fk_cfdi_documents_moneda
        FOREIGN KEY (moneda) REFERENCES sat_moneda (code)
        ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
