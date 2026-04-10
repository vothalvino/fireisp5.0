-- Migration: 082_seed_sat_clave_prod_serv_and_unidad
-- Description: Seeds the most common ISP-relevant entries into the SAT
--              c_ClaveProdServ and c_ClaveUnidad catalog tables created in
--              migrations 080 and 081.  Uses INSERT IGNORE so that re-running
--              this migration is idempotent.
--
--              Sources: SAT catalogs published at
--              https://www.sat.gob.mx/consultas/53525/factura-electronica-version-4.0
--
--              The full c_ClaveProdServ catalog (>50 000 codes) can be imported
--              separately from the official SAT Excel publication.

-- ------------------------------------------------------------
-- 1. sat_clave_prod_serv (ISP-relevant subset)
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_clave_prod_serv (code, description, status) VALUES
('81161700', 'Servicios de acceso a Internet',                   'active'),
('81161500', 'Servicios de telefonía y voz sobre IP (VoIP)',     'active'),
('81112200', 'Soporte técnico',                                  'active'),
('81112100', 'Mantenimiento y actualización de software',        'active'),
('43231500', 'Equipo de redes y telecomunicaciones',             'active'),
('43222600', 'Enrutadores y conmutadores de red (routers/switches)', 'active'),
('01010101', 'No aplica',                                        'active');

-- ------------------------------------------------------------
-- 2. sat_clave_unidad (ISP-relevant subset)
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_clave_unidad (code, description, status) VALUES
('E48', 'Unidad de servicio / Service unit',    'active'),
('ACT', 'Actividad / Activity',                 'active'),
('HUR', 'Hora / Hour',                          'active'),
('MON', 'Mes / Month',                          'active'),
('H87', 'Pieza / Piece',                        'active'),
('MTR', 'Metro / Meter',                        'active');
