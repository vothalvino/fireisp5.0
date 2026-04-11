-- Migration: 095_add_fks_cfdi_conceptos_to_sat_catalogs
-- Description: Adds foreign key constraints from cfdi_conceptos to the SAT
--              product/service and unit-of-measure catalog tables created in
--              migrations 080 and 081 respectively.
--
--              Fields constrained:
--                clave_prod_serv → sat_clave_prod_serv(code)
--                clave_unidad    → sat_clave_unidad(code)
--
--              This prevents invalid SAT product/service and unit codes from
--              being stored on CFDI line items, which would cause PAC rejection.

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE cfdi_conceptos
    ADD CONSTRAINT fk_cfdi_conceptos_clave_prod_serv
        FOREIGN KEY (clave_prod_serv) REFERENCES sat_clave_prod_serv (code)
        ON UPDATE CASCADE,
    ADD CONSTRAINT fk_cfdi_conceptos_clave_unidad
        FOREIGN KEY (clave_unidad) REFERENCES sat_clave_unidad (code)
        ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
