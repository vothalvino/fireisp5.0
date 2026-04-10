-- Migration: 069_seed_sat_catalogs
-- Description: Seeds the six SAT CFDI 4.0 catalog tables created in migration 068
--              with the official SAT values.  Uses INSERT IGNORE so that re-running
--              this migration is idempotent.
--
--              Sources: SAT catalogs published at
--              https://www.sat.gob.mx/consultas/53525/factura-electronica-version-4.0
--              (c_RegimenFiscal, c_UsoCFDI, c_FormaPago, c_MetodoPago,
--               c_TipoDeComprobante, c_Moneda)

-- ------------------------------------------------------------
-- 1. sat_regimen_fiscal
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_regimen_fiscal (code, description, applies_to, status) VALUES
('601', 'General de Ley Personas Morales',                                          'company',  'active'),
('603', 'Personas Morales con Fines no Lucrativos',                                 'company',  'active'),
('605', 'Sueldos y Salarios e Ingresos Asimilados a Salarios',                      'personal', 'active'),
('606', 'Arrendamiento',                                                             'personal', 'active'),
('608', 'Demás ingresos',                                                            'personal', 'active'),
('610', 'Residentes en el Extranjero sin Establecimiento Permanente en México',      'both',     'active'),
('612', 'Personas Físicas con Actividades Empresariales y Profesionales',            'personal', 'active'),
('614', 'Ingresos por intereses',                                                    'personal', 'active'),
('616', 'Sin obligaciones fiscales',                                                 'personal', 'active'),
('620', 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',  'company',  'active'),
('621', 'Incorporación Fiscal',                                                      'personal', 'active'),
('622', 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',                 'company',  'active'),
('623', 'Opcional para Grupos de Sociedades',                                        'company',  'active'),
('624', 'Coordinados',                                                               'company',  'active'),
('625', 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', 'personal', 'active'),
('626', 'Régimen Simplificado de Confianza',                                         'both',     'active');

-- ------------------------------------------------------------
-- 2. sat_uso_cfdi
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_uso_cfdi (code, description, applies_to, status) VALUES
('G01', 'Adquisición de mercancias',                                        'both',     'active'),
('G02', 'Devoluciones, descuentos o bonificaciones',                        'both',     'active'),
('G03', 'Gastos en general',                                                'both',     'active'),
('I01', 'Construcciones',                                                   'both',     'active'),
('I02', 'Mobilario y equipo de oficina por inversiones',                    'both',     'active'),
('I03', 'Equipo de transporte',                                             'both',     'active'),
('I04', 'Equipo de computo y accesorios',                                   'both',     'active'),
('I08', 'Otra maquinaria y equipo',                                         'both',     'active'),
('D01', 'Honorarios médicos, dentales y gastos hospitalarios',              'personal', 'active'),
('D02', 'Gastos médicos por incapacidad o discapacidad',                    'personal', 'active'),
('D03', 'Gastos funerales',                                                 'personal', 'active'),
('D04', 'Donativos',                                                        'personal', 'active'),
('P01', 'Por definir',                                                      'both',     'active'),
('S01', 'Sin efectos fiscales',                                             'both',     'active'),
('CP01', 'Pagos',                                                           'both',     'active');

-- ------------------------------------------------------------
-- 3. sat_forma_pago
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_forma_pago (code, description, status) VALUES
('01', 'Efectivo',                                                          'active'),
('02', 'Cheque nominativo',                                                 'active'),
('03', 'Transferencia electrónica de fondos',                               'active'),
('04', 'Tarjeta de crédito',                                                'active'),
('05', 'Monedero electrónico',                                              'active'),
('06', 'Dinero electrónico',                                                'active'),
('08', 'Vales de despensa',                                                 'active'),
('12', 'Dación en pago',                                                    'active'),
('13', 'Pago por subrogación',                                              'active'),
('14', 'Pago por consignación',                                             'active'),
('15', 'Condonación',                                                       'active'),
('17', 'Compensación',                                                      'active'),
('23', 'Novación',                                                          'active'),
('24', 'Confusión',                                                         'active'),
('25', 'Remisión de deuda',                                                 'active'),
('26', 'Prescripción o caducidad',                                          'active'),
('27', 'A satisfacción del acreedor',                                       'active'),
('28', 'Tarjeta de débito',                                                 'active'),
('29', 'Tarjeta de servicios',                                              'active'),
('30', 'Aplicación de anticipos',                                           'active'),
('31', 'Intermediario pagos',                                               'active'),
('99', 'Por definir',                                                       'active');

-- ------------------------------------------------------------
-- 4. sat_metodo_pago
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_metodo_pago (code, description, status) VALUES
('PUE', 'Pago en una sola exhibición',              'active'),
('PPD', 'Pago en parcialidades o diferido',         'active');

-- ------------------------------------------------------------
-- 5. sat_tipo_comprobante
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_tipo_comprobante (code, description, status) VALUES
('I', 'Ingreso',    'active'),
('E', 'Egreso',     'active'),
('P', 'Pago',       'active'),
('T', 'Traslado',   'active'),
('N', 'Nómina',     'active');

-- ------------------------------------------------------------
-- 6. sat_moneda
-- ------------------------------------------------------------
INSERT IGNORE INTO sat_moneda (code, description, decimals, status) VALUES
('MXN', 'Peso Mexicano',                    2, 'active'),
('USD', 'Dólar americano',                  2, 'active'),
('EUR', 'Euro',                             2, 'active'),
('XXX', 'Los derechos en esta divisa',      2, 'active');
