// =============================================================================
// FireISP 5.0 — Client Validation Schemas
// =============================================================================

const createClient = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  email: { type: 'email' },
  phone: { type: 'string', max: 30 },
  client_type: { type: 'string', enum: ['residential', 'business', 'government', 'wholesale'] },
  locale: { type: 'string', enum: ['global', 'MX'] },
  tax_id: { type: 'string', max: 50 },
  address: { type: 'string', max: 500 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 2 },
  status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
};

const updateClient = {
  name: { type: 'string', min: 1, max: 200 },
  email: { type: 'email' },
  phone: { type: 'string', max: 30 },
  client_type: { type: 'string', enum: ['residential', 'business', 'government', 'wholesale'] },
  locale: { type: 'string', enum: ['global', 'MX'] },
  tax_id: { type: 'string', max: 50 },
  address: { type: 'string', max: 500 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 2 },
  status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
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

const patchClient = Object.fromEntries(
  Object.entries(updateClient).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createClient, updateClient, patchClient, createContact, updateMxProfile };
