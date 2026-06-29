// =============================================================================
// FireISP 5.0 — Organization Validation Schemas
// =============================================================================

const createOrganization = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  legal_name: { type: 'string', max: 255 },
  email: { type: 'email' },
  phone: { type: 'string', max: 30 },
  website: { type: 'string', max: 255 },
  address: { type: 'string', max: 255 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 100 },
  currency: { type: 'string', min: 3, max: 3 },
  locale: { type: 'string', enum: ['global', 'MX'] },
  tax_id: { type: 'string', max: 50 },
  logo_url: { type: 'string', max: 500 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateOrganization = {
  name: { type: 'string', min: 1, max: 255 },
  legal_name: { type: 'string', max: 255 },
  email: { type: 'email' },
  phone: { type: 'string', max: 30 },
  website: { type: 'string', max: 255 },
  address: { type: 'string', max: 255 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 100 },
  currency: { type: 'string', min: 3, max: 3 },
  locale: { type: 'string', enum: ['global', 'MX'] },
  tax_id: { type: 'string', max: 50 },
  logo_url: { type: 'string', max: 500 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateSetting = {
  value: { type: 'string', required: true, max: 5000 },
};

const patchOrganization = Object.fromEntries(
  Object.entries(updateOrganization).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOrganization, updateOrganization, patchOrganization, updateSetting };
