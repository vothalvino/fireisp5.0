// =============================================================================
// FireISP 5.0 — SSO Validation Schemas (P2.1)
// =============================================================================

const SSO_ROLES = ['admin', 'manager', 'technician', 'billing', 'readonly'];

const samlConfig = {
  is_enabled:         { type: 'boolean' },
  saml_entity_id:     { type: 'string', max: 500 },
  saml_sso_url:       { type: 'string', max: 500 },
  saml_slo_url:       { type: 'string', max: 500 },
  saml_x509_cert:     { type: 'string' },
  saml_sign_requests: { type: 'boolean' },
  saml_sp_private_key:{ type: 'string' },
  attribute_mapping:  { type: 'object' },
  idp_group_attribute:{ type: 'string', max: 255 },
  auto_provision:     { type: 'boolean' },
  default_role:       { type: 'string', enum: SSO_ROLES },
};

const oidcConfig = {
  is_enabled:         { type: 'boolean' },
  oidc_issuer:        { type: 'string', max: 500 },
  oidc_client_id:     { type: 'string', max: 255 },
  oidc_client_secret: { type: 'string' },
  oidc_scopes:        { type: 'string', max: 500 },
  attribute_mapping:  { type: 'object' },
  idp_group_attribute:{ type: 'string', max: 255 },
  auto_provision:     { type: 'boolean' },
  default_role:       { type: 'string', enum: SSO_ROLES },
};

const groupMappings = {
  mappings: { type: 'array', required: true },
};

module.exports = { samlConfig, oidcConfig, groupMappings };
