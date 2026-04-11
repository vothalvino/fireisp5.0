// =============================================================================
// FireISP 5.0 — Factura Pública Validation Schemas
// =============================================================================

const createFacturaPublica = {
  periodicidad: { type: 'string', required: true, enum: ['01', '02', '03', '04', '05'] },
  meses: { type: 'string', max: 2 },
  anio: { type: 'number', min: 2020, max: 2099 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'stamped', 'cancelled'] },
};

const updateFacturaPublica = {
  periodicidad: { type: 'string', enum: ['01', '02', '03', '04', '05'] },
  meses: { type: 'string', max: 2 },
  anio: { type: 'number', min: 2020, max: 2099 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'stamped', 'cancelled'] },
};

const addFacturaPublicaItem = {
  invoice_id: { type: 'number', required: true, min: 1 },
};

module.exports = { createFacturaPublica, updateFacturaPublica, addFacturaPublicaItem };
