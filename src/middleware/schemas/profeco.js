// =============================================================================
// FireISP 5.0 — PROFECO Complaint Validation Schemas
// =============================================================================

const SERVICE_TYPES = ['internet', 'telefonia', 'television', 'paquete'];
const CATEGORIES    = ['facturacion', 'calidad_servicio', 'contrato',
  'suspension_indebida', 'cobros_no_autorizados', 'atencion_cliente', 'otro'];
const STATUSES      = ['recibida', 'en_tramite', 'resuelta', 'archivada'];

const createProfecoComplaint = {
  consumer_name:        { type: 'string', required: true, min: 1, max: 255 },
  description:          { type: 'string', required: true, min: 1, max: 10000 },
  ticket_id:            { type: 'number', min: 1 },
  client_id:            { type: 'number', min: 1 },
  folio_profeco:        { type: 'string', max: 50 },
  consumer_email:       { type: 'string', max: 255 },
  consumer_phone:       { type: 'string', max: 30 },
  service_type:         { type: 'string', enum: SERVICE_TYPES },
  category:             { type: 'string', enum: CATEGORIES },
  resolution_requested: { type: 'string', max: 10000 },
  company_response:     { type: 'string', max: 10000 },
  status:               { type: 'string', enum: STATUSES },
  reported_at:          { type: 'string' },
  resolved_at:          { type: 'string' },
};

const updateProfecoComplaint = {
  consumer_name:        { type: 'string', min: 1, max: 255 },
  description:          { type: 'string', min: 1, max: 10000 },
  ticket_id:            { type: 'number', min: 1 },
  client_id:            { type: 'number', min: 1 },
  folio_profeco:        { type: 'string', max: 50 },
  consumer_email:       { type: 'string', max: 255 },
  consumer_phone:       { type: 'string', max: 30 },
  service_type:         { type: 'string', enum: SERVICE_TYPES },
  category:             { type: 'string', enum: CATEGORIES },
  resolution_requested: { type: 'string', max: 10000 },
  company_response:     { type: 'string', max: 10000 },
  status:               { type: 'string', enum: STATUSES },
  reported_at:          { type: 'string' },
  resolved_at:          { type: 'string' },
};

const patchProfecoComplaint = Object.fromEntries(
  Object.entries(updateProfecoComplaint).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createProfecoComplaint, updateProfecoComplaint, patchProfecoComplaint };
