// =============================================================================
// FireISP 5.0 — Client Validation Schemas
// =============================================================================

const CLIENT_TYPES = ['personal', 'company', 'residential', 'business', 'corporate', 'government', 'wholesale'];
const RISK_RATINGS = ['low', 'medium', 'high', 'unrated'];

const createClient = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  email: { type: 'email' },
  phone: { type: 'string', max: 30 },
  client_type: { type: 'string', enum: CLIENT_TYPES },
  client_group_id: { type: 'number', min: 1 },
  locale: { type: 'string', enum: ['global', 'MX'] },
  tax_id: { type: 'string', max: 50 },
  curp: { type: 'string', min: 18, max: 18 },
  address: { type: 'string', max: 500 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 2 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  credit_score: { type: 'number', min: 0, max: 1000 },
  risk_rating: { type: 'string', enum: RISK_RATINGS },
  status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
};

const updateClient = {
  name: { type: 'string', min: 1, max: 200 },
  email: { type: 'email' },
  phone: { type: 'string', max: 30 },
  client_type: { type: 'string', enum: CLIENT_TYPES },
  client_group_id: { type: 'number', min: 1 },
  locale: { type: 'string', enum: ['global', 'MX'] },
  tax_id: { type: 'string', max: 50 },
  curp: { type: 'string', min: 18, max: 18 },
  address: { type: 'string', max: 500 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 2 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  credit_score: { type: 'number', min: 0, max: 1000 },
  risk_rating: { type: 'string', enum: RISK_RATINGS },
  status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
  suspension_exempt: { type: 'boolean' },
  suspension_exempt_reason: { type: 'string', max: 500 },
};

const createContact = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  email: { type: 'email' },
  phone: { type: 'string', max: 30 },
  role: { type: 'string', max: 100 },
};

const updateMxProfile = {
  rfc: { type: 'string', required: true, min: 12, max: 13 },
  razon_social: { type: 'string', required: true, min: 1, max: 300 },
  regimen_fiscal: { type: 'string', required: true, min: 3, max: 3 },
  codigo_postal_fiscal: { type: 'string', required: true, min: 5, max: 5 },
  curp: { type: 'string', min: 18, max: 18 },
};

const setCustomField = {
  field_key: { type: 'string', required: true, min: 1, max: 100 },
  field_value: { type: 'string', max: 65535 },
};

const mergeClient = {
  source_id: { type: 'number', required: true, min: 1 },
};

const geocodeClient = {
  // Optional ad-hoc address override; when omitted the client's stored address
  // fields are geocoded.
  address: { type: 'string', max: 500 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 2 },
};

const patchClient = Object.fromEntries(
  Object.entries(updateClient).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = {
  createClient, updateClient, patchClient, createContact, updateMxProfile,
  setCustomField, mergeClient, geocodeClient,
};
