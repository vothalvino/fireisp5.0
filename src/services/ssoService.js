// =============================================================================
// FireISP 5.0 — SSO Service (P2.1)
// =============================================================================
// Handles SAML 2.0 and OIDC authentication flows for per-organization SSO.
//
// Flow:
//   SAML: generateSamlLoginUrl() → processSamlAssertion() → mintTokens()
//   OIDC: generateOidcLoginUrl() → processOidcCallback()  → mintTokens()
//
// Both flows end by calling findOrCreateSsoUser() which resolves the local
// FireISP user (creating one on first login when auto_provision=1) and maps
// IdP group memberships to FireISP roles via the group-mappings table.
// =============================================================================

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
const { UnauthorizedError, NotFoundError, ForbiddenError, ValidationError } = require('../utils/errors');

// SAML standard attribute namespace prefixes (WS-Federation / Active Directory)
const SAML_NS_EMAIL      = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';
const SAML_NS_GIVENNAME  = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname';
const SAML_NS_SURNAME    = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname';

// Refresh token lifetime in seconds (re-use authService parsing logic inline)
function parseExpiry(str) {
  if (!str) return 604800;
  const m = String(str).match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return 604800;
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default:  return 604800;
  }
}

const REFRESH_SECONDS = parseExpiry(config.jwt.refreshExpiresIn);
const ACCESS_SECONDS  = parseExpiry(config.jwt.accessExpiresIn);

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

/**
 * Retrieve the SSO config for an organization + provider type.
 * Returns null when no config exists.
 *
 * @param {number} orgId
 * @param {'saml'|'oidc'} providerType
 */
async function getConfig(orgId, providerType) {
  const [rows] = await db.query(
    'SELECT * FROM organization_sso_configs WHERE organization_id = ? AND provider_type = ?',
    [orgId, providerType],
  );
  if (!rows.length) return null;
  const row = rows[0];
  // Decrypt sensitive fields before returning
  if (row.oidc_client_secret) row.oidc_client_secret = decrypt(row.oidc_client_secret);
  if (row.saml_sp_private_key) row.saml_sp_private_key = decrypt(row.saml_sp_private_key);
  return row;
}

/**
 * Create or update the SSO config for an organization.
 *
 * @param {number} orgId
 * @param {'saml'|'oidc'} providerType
 * @param {object} fields  Writable fields from the request body
 */
async function saveConfig(orgId, providerType, fields) {
  // Encrypt sensitive fields before storage
  const encClientSecret  = (fields.oidc_client_secret  !== null && fields.oidc_client_secret  !== undefined && fields.oidc_client_secret  !== '') ? encrypt(fields.oidc_client_secret)  : undefined;
  const encSpPrivateKey  = (fields.saml_sp_private_key  !== null && fields.saml_sp_private_key  !== undefined && fields.saml_sp_private_key  !== '') ? encrypt(fields.saml_sp_private_key)  : undefined;

  const existing = await db.query(
    'SELECT id FROM organization_sso_configs WHERE organization_id = ? AND provider_type = ?',
    [orgId, providerType],
  );

  const writableFields = {
    is_enabled:         fields.is_enabled        !== null && fields.is_enabled        !== undefined ? (fields.is_enabled ? 1 : 0) : undefined,
    saml_entity_id:     fields.saml_entity_id,
    saml_sso_url:       fields.saml_sso_url,
    saml_slo_url:       fields.saml_slo_url,
    saml_x509_cert:     fields.saml_x509_cert,
    saml_sign_requests: fields.saml_sign_requests !== null && fields.saml_sign_requests !== undefined ? (fields.saml_sign_requests ? 1 : 0) : undefined,
    saml_sp_private_key: encSpPrivateKey,
    oidc_issuer:        fields.oidc_issuer,
    oidc_client_id:     fields.oidc_client_id,
    oidc_client_secret: encClientSecret,
    oidc_scopes:        fields.oidc_scopes,
    attribute_mapping:  fields.attribute_mapping !== null && fields.attribute_mapping !== undefined ? JSON.stringify(fields.attribute_mapping) : undefined,
    idp_group_attribute: fields.idp_group_attribute,
    auto_provision:     fields.auto_provision    !== null && fields.auto_provision    !== undefined ? (fields.auto_provision ? 1 : 0) : undefined,
    default_role:       fields.default_role,
  };

  // Remove undefined keys so we don't clobber existing values
  const defined = Object.fromEntries(
    Object.entries(writableFields).filter(([, v]) => v !== undefined),
  );

  if (existing[0].length > 0) {
    // UPDATE existing row
    const setClauses = Object.keys(defined).map(k => `${k} = ?`).join(', ');
    const values     = [...Object.values(defined), orgId, providerType];
    await db.query(
      `UPDATE organization_sso_configs SET ${setClauses} WHERE organization_id = ? AND provider_type = ?`,
      values,
    );
  } else {
    // INSERT new row
    defined.organization_id = orgId;
    defined.provider_type   = providerType;
    const cols   = Object.keys(defined).join(', ');
    const params = Object.keys(defined).map(() => '?').join(', ');
    await db.query(
      `INSERT INTO organization_sso_configs (${cols}) VALUES (${params})`,
      Object.values(defined),
    );
  }

  return getConfig(orgId, providerType);
}

// ---------------------------------------------------------------------------
// Group mappings CRUD
// ---------------------------------------------------------------------------

/**
 * Return all group mappings for a given SSO config ID.
 */
async function getGroupMappings(ssoConfigId) {
  const [rows] = await db.query(
    'SELECT id, idp_group, fireisp_role FROM organization_sso_group_mappings WHERE sso_config_id = ? ORDER BY idp_group',
    [ssoConfigId],
  );
  return rows;
}

/**
 * Replace all group mappings for a config in a single transaction.
 *
 * @param {number} ssoConfigId
 * @param {Array<{idp_group: string, fireisp_role: string}>} mappings
 */
async function saveGroupMappings(ssoConfigId, mappings) {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await conn.query(
      'DELETE FROM organization_sso_group_mappings WHERE sso_config_id = ?',
      [ssoConfigId],
    );
    if (mappings.length > 0) {
      const values = mappings.map(m => [ssoConfigId, m.idp_group, m.fireisp_role]);
      await conn.query(
        'INSERT INTO organization_sso_group_mappings (sso_config_id, idp_group, fireisp_role) VALUES ?',
        [values],
      );
    }
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
  return getGroupMappings(ssoConfigId);
}

// ---------------------------------------------------------------------------
// SAML flow
// ---------------------------------------------------------------------------

/**
 * Build a lazy-initialized SAML strategy instance from the org's SSO config.
 * Returns null when SSO is not configured / not enabled.
 *
 * @param {object} cfg  Row from organization_sso_configs
 * @param {number} orgId
 * @returns {import('@node-saml/node-saml').SAML|null}
 */
function buildSamlInstance(cfg, orgId) {
  const { SAML } = require('@node-saml/node-saml');
  const spEntityId = `${config.appUrl}/api/v1/sso/${orgId}/saml/metadata`;
  const callbackUrl = `${config.appUrl}/api/v1/sso/${orgId}/saml/acs`;

  const samlOptions = {
    entryPoint:      cfg.saml_sso_url,
    issuer:          spEntityId,
    callbackUrl,
    cert:            cfg.saml_x509_cert,
    identifierFormat: null,
    wantAuthnResponseSigned: true,
    wantAssertionsSigned:    false,
  };

  if (cfg.saml_sign_requests && cfg.saml_sp_private_key) {
    samlOptions.privateKey = cfg.saml_sp_private_key;
    samlOptions.signatureAlgorithm = 'sha256';
  }

  return new SAML(samlOptions);
}

/**
 * Generate the SAML SP metadata XML for an organization.
 */
async function getSamlMetadata(orgId) {
  const cfg = await getConfig(orgId, 'saml');
  if (!cfg) throw new NotFoundError('SSO configuration');

  const saml = buildSamlInstance(cfg, orgId);
  const callbackUrl = `${config.appUrl}/api/v1/sso/${orgId}/saml/acs`;

  const decryptionCerts = [];
  if (cfg.saml_sp_private_key) {
    // Include the SP public certificate (derived from private key) if available.
    // In most deployments the SP cert is provided separately; if not configured
    // the metadata is emitted without an encryption key.
    decryptionCerts.push('');
  }

  return saml.generateServiceProviderMetadata(
    cfg.saml_sp_private_key || null,
    callbackUrl,
  );
}

/**
 * Generate the URL to redirect the user to the IdP for SAML authentication.
 *
 * @param {number} orgId
 * @returns {string} Redirect URL
 */
async function generateSamlLoginUrl(orgId) {
  const cfg = await getConfig(orgId, 'saml');
  if (!cfg || !cfg.is_enabled) {
    throw new ForbiddenError('SSO is not enabled for this organization');
  }
  if (!cfg.saml_sso_url || !cfg.saml_x509_cert) {
    throw new ValidationError('SAML configuration is incomplete (saml_sso_url, saml_x509_cert required)');
  }

  const saml = buildSamlInstance(cfg, orgId);
  const { context } = await saml.getAuthorizeUrlAsync('', '', {});
  return context;
}

/**
 * Validate an incoming SAML assertion (HTTP POST binding from the IdP).
 * Returns a normalized profile object.
 *
 * @param {number} orgId
 * @param {object} body  Express request body (must include SAMLResponse)
 */
async function processSamlAssertion(orgId, body) {
  const cfg = await getConfig(orgId, 'saml');
  if (!cfg || !cfg.is_enabled) {
    throw new UnauthorizedError('SSO is not enabled for this organization');
  }

  const saml = buildSamlInstance(cfg, orgId);
  const { profile } = await saml.validatePostResponseAsync(body);

  const attrMap = parseAttributeMapping(cfg.attribute_mapping);
  return normalizeSamlProfile(profile, attrMap, cfg.idp_group_attribute || 'groups');
}

/** Parse the JSON attribute mapping stored in the DB, defaulting to empty object. */
function parseAttributeMapping(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_e) { return {}; }
}

/**
 * Normalize a raw SAML profile into a common shape.
 */
function normalizeSamlProfile(profile, attrMap, groupAttr) {
  const get = (key, fallback) => {
    const mapped = attrMap[key];
    if (mapped && profile[mapped] !== undefined) return profile[mapped];
    return profile[key] !== undefined ? profile[key] : fallback;
  };

  const email = get('email', profile.nameID || profile[SAML_NS_EMAIL]);
  const firstName = get('firstName', profile.givenname || profile[SAML_NS_GIVENNAME] || '');
  const lastName  = get('lastName',  profile.sn || profile.surname || profile[SAML_NS_SURNAME] || '');

  const rawGroups = profile[groupAttr] || profile['groups'] || [];
  const groups = Array.isArray(rawGroups) ? rawGroups : [rawGroups].filter(Boolean);

  return { email, firstName, lastName, groups, raw: profile };
}

// ---------------------------------------------------------------------------
// OIDC flow
// ---------------------------------------------------------------------------

/** In-memory Issuer cache to avoid repeated discovery calls. */
const issuerCache = new Map();

async function getOidcClient(cfg, orgId) {
  const { Issuer } = require('openid-client');
  const redirectUri = `${config.appUrl}/api/v1/sso/${orgId}/oidc/callback`;

  let issuer = issuerCache.get(cfg.oidc_issuer);
  if (!issuer) {
    issuer = await Issuer.discover(cfg.oidc_issuer);
    issuerCache.set(cfg.oidc_issuer, issuer);
  }

  return new issuer.Client({
    client_id:     cfg.oidc_client_id,
    client_secret: cfg.oidc_client_secret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
  });
}

/**
 * Generate the OIDC authorization URL and persist the state+nonce to the DB.
 * The state is stored in `sso_auth_states` so the callback can verify it.
 *
 * @param {number} orgId
 * @param {string} [redirectTo]  Optional deep-link to return the user to post-auth
 * @returns {string} Authorization URL
 */
async function generateOidcLoginUrl(orgId, redirectTo) {
  const cfg = await getConfig(orgId, 'oidc');
  if (!cfg || !cfg.is_enabled) {
    throw new ForbiddenError('SSO is not enabled for this organization');
  }
  if (!cfg.oidc_issuer || !cfg.oidc_client_id) {
    throw new ValidationError('OIDC configuration is incomplete (oidc_issuer, oidc_client_id required)');
  }

  const { generators } = require('openid-client');
  const state = generators.state();
  const nonce = generators.nonce();

  // Persist state for 10 minutes
  await db.query(
    `INSERT INTO sso_auth_states (state, nonce, organization_id, redirect_to, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [state, nonce, orgId, redirectTo || null],
  );

  const oidcClient = await getOidcClient(cfg, orgId);
  const scopes = cfg.oidc_scopes || 'openid profile email';

  return oidcClient.authorizationUrl({
    scope: scopes,
    state,
    nonce,
  });
}

/**
 * Process the OIDC authorization code callback.
 *
 * @param {number} orgId
 * @param {object} req  Express request object
 * @returns {{ profile: object, redirectTo: string|null }}
 */
async function processOidcCallback(orgId, req) {
  const cfg = await getConfig(orgId, 'oidc');
  if (!cfg || !cfg.is_enabled) {
    throw new UnauthorizedError('SSO is not enabled for this organization');
  }

  const oidcClient = await getOidcClient(cfg, orgId);
  const redirectUri = `${config.appUrl}/api/v1/sso/${orgId}/oidc/callback`;

  // Look up and validate the stored state
  const params = oidcClient.callbackParams(req);
  if (!params.state) throw new UnauthorizedError('Missing OAuth state parameter');

  const [stateRows] = await db.query(
    'SELECT * FROM sso_auth_states WHERE state = ? AND expires_at > NOW()',
    [params.state],
  );
  if (!stateRows.length) {
    throw new UnauthorizedError('Invalid or expired OAuth state');
  }
  const stateRecord = stateRows[0];
  if (Number(stateRecord.organization_id) !== Number(orgId)) {
    throw new UnauthorizedError('OAuth state organization mismatch');
  }

  // Clean up the used state
  await db.query('DELETE FROM sso_auth_states WHERE state = ?', [params.state]);

  const tokenSet = await oidcClient.callback(redirectUri, params, {
    state: stateRecord.state,
    nonce: stateRecord.nonce,
  });

  const userinfo = await oidcClient.userinfo(tokenSet);

  const attrMap = parseAttributeMapping(cfg.attribute_mapping);
  const groupAttr = cfg.idp_group_attribute || 'groups';
  const profile = normalizeOidcProfile(userinfo, attrMap, groupAttr);

  return { profile, redirectTo: stateRecord.redirect_to };
}

/**
 * Normalize a raw OIDC userinfo object into a common shape.
 */
function normalizeOidcProfile(userinfo, attrMap, groupAttr) {
  const get = (key, fallback) => {
    const mapped = attrMap[key];
    if (mapped && userinfo[mapped] !== undefined) return userinfo[mapped];
    return userinfo[key] !== undefined ? userinfo[key] : fallback;
  };

  const email      = get('email', userinfo.email || userinfo.preferred_username || '');
  const firstName  = get('firstName', userinfo.given_name || userinfo.name?.split(' ')[0] || '');
  const lastName   = get('lastName',  userinfo.family_name || userinfo.name?.split(' ').slice(1).join(' ') || '');
  const rawGroups  = userinfo[groupAttr] || userinfo.groups || [];
  const groups     = Array.isArray(rawGroups) ? rawGroups : [rawGroups].filter(Boolean);

  return { email, firstName, lastName, groups, raw: userinfo };
}

// ---------------------------------------------------------------------------
// User resolution and token minting
// ---------------------------------------------------------------------------

/**
 * Resolve (or auto-create) a FireISP user from an SSO profile.
 *
 * Matching strategy:
 *   1. Find existing user by email.
 *   2. If not found and auto_provision=true, create the user.
 *   3. If not found and auto_provision=false, throw UnauthorizedError.
 *   4. Ensure the user has an organization_users membership for the org.
 *   5. Determine the effective role by checking group mappings.
 *
 * @param {number}   orgId
 * @param {object}   profile    Normalized SSO profile (email, firstName, lastName, groups)
 * @param {object}   cfg        organization_sso_configs row
 * @param {object[]} mappings   organization_sso_group_mappings rows
 * @returns {{ user: object, orgRole: string }}
 */
async function findOrCreateSsoUser(orgId, profile, cfg, mappings) {
  if (!profile.email) {
    throw new UnauthorizedError('IdP did not provide an email address — cannot authenticate user');
  }

  const bcrypt = require('bcryptjs');

  // 1. Find by email
  const [userRows] = await db.query(
    'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL',
    [profile.email],
  );
  let user = userRows[0] || null;

  if (!user) {
    if (!cfg.auto_provision) {
      throw new UnauthorizedError('User not found and auto-provisioning is disabled for this organization');
    }
    // 2. Create user — generate a random unusable password (SSO users authenticate via IdP only)
    const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const [insertResult] = await db.query(
      `INSERT INTO users (organization_id, first_name, last_name, email, password_hash, role, status)
       VALUES (?, ?, ?, ?, ?, 'support', 'active')`,
      [orgId, profile.firstName || '', profile.lastName || '', profile.email, randomPassword],
    );
    const [newUserRows] = await db.query(
      'SELECT * FROM users WHERE id = ?',
      [insertResult.insertId],
    );
    user = newUserRows[0];
  }

  // 3. Determine effective role from group mappings (first match wins)
  let orgRole = cfg.default_role || 'readonly';
  if (profile.groups && profile.groups.length > 0 && mappings.length > 0) {
    for (const group of profile.groups) {
      const match = mappings.find(m => m.idp_group === group);
      if (match) {
        orgRole = match.fireisp_role;
        break;
      }
    }
  }

  // 4. Ensure organization membership (upsert)
  await db.query(
    `INSERT INTO organization_users (organization_id, user_id, role)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), deleted_at = NULL`,
    [orgId, user.id, orgRole],
  );

  return { user, orgRole };
}

/**
 * Issue an access token + refresh token pair for a successfully authenticated
 * SSO user and return the same shape as authService.login().
 *
 * @param {object} user    users table row
 * @param {number} orgId   Organization the user is signing into
 * @returns {{ accessToken, refreshToken, expiresIn, user, organizations }}
 */
async function mintTokens(user, orgId) {
  const accessToken = jwt.sign(
    {
      sub:   user.id,
      email: user.email,
      role:  user.role,
      orgId,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn },
  );

  const refreshTokenValue = crypto.randomBytes(32).toString('hex');
  const refreshHash       = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
  const family            = crypto.randomUUID();

  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, token_family, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [user.id, refreshHash, family, null, null, REFRESH_SECONDS],
  );

  // Update last_login_at
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  const [orgRows] = await db.query(`
    SELECT o.*, ou.role AS membership_role
    FROM organization_users ou
    JOIN organizations o ON o.id = ou.organization_id
    WHERE ou.user_id = ? AND ou.deleted_at IS NULL AND o.deleted_at IS NULL
  `, [user.id]);

  const { password_hash: _pw, ...safeUser } = user;
  return {
    accessToken,
    refreshToken:  refreshTokenValue,
    expiresIn:     ACCESS_SECONDS,
    user:          safeUser,
    organizations: orgRows,
  };
}

// ---------------------------------------------------------------------------
// Cleanup helper (called by scheduled task or migration smoke test)
// ---------------------------------------------------------------------------

/**
 * Delete expired sso_auth_states rows.
 */
async function purgeExpiredStates() {
  const [result] = await db.query('DELETE FROM sso_auth_states WHERE expires_at <= NOW()');
  return result.affectedRows || 0;
}

module.exports = {
  getConfig,
  saveConfig,
  getGroupMappings,
  saveGroupMappings,
  getSamlMetadata,
  generateSamlLoginUrl,
  processSamlAssertion,
  generateOidcLoginUrl,
  processOidcCallback,
  findOrCreateSsoUser,
  mintTokens,
  purgeExpiredStates,
  // Exported for testing
  normalizeSamlProfile,
  normalizeOidcProfile,
  parseAttributeMapping,
};
