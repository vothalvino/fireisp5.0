// =============================================================================
// FireISP 5.0 — API Token Scope Utilities
// =============================================================================
// Defines the scope system for API tokens. Scopes restrict what an API token
// can do, layered on top of the user's RBAC permissions.
//
// Format:  "resource:access" where access is "read", "write", or the
// collector-only "ingest" access supported by connection_logs and the
// privacy-minimal CGNAT attribution collector.
// Examples: "clients:read", "invoices:write", "*:read"
//
// - `:read`  → allows `.view` and `.export` permission actions
// - `:write` → allows `.create`, `.update`, `.delete`, `.manage` (implies read)
// - `*`      → wildcard, matches any resource
// - `null` scopes on a token → unrestricted (full access, backward-compatible)
// =============================================================================

/**
 * All resource names that can appear in scopes.
 * Derived from the permission slugs used across all route files.
 */
const VALID_RESOURCES = [
  'api_tokens',
  'audit_logs',
  'cfdi_documents',
  'clients',
  'concession_titles',
  'connection_logs',
  'cgnat_attribution',
  'contracts',
  'coverage_zones',
  'credit_notes',
  'csd_certificates',
  'device_config_backups',
  'devices',
  'expenses',
  'facturas_publicas',
  'files',
  'ift_statistical_reports',
  'inventory',
  'invoices',
  'ip_assignments',
  'ip_attribution',
  'ip_pools',
  'jobs',
  'network_health',
  'network_links',
  'organizations',
  'outages',
  'pac_providers',
  'payment_gateways',
  'payment_transactions',
  'payments',
  'plans',
  'promotions',
  'quotes',
  'recurring_payment_profiles',
  'regulatory_filings',
  'revenue_summary',
  'roles',
  'scheduled_tasks',
  'service_areas',
  'settings',
  'sites',
  'sla_definitions',
  'snmp_profiles',
  'speed_tests',
  'suspension_rules',
  'tax_rates',
  'tax_rules',
  'tickets',
  'users',
  'vlans',
  'webhooks',
];

const ACCESS_READ = 'read';
const ACCESS_WRITE = 'write';
const ACCESS_INGEST = 'ingest';
const INGEST_RESOURCES = new Set(['connection_logs', 'cgnat_attribution']);

/**
 * Permission actions that are satisfied by `:read` scope.
 */
const READ_ACTIONS = new Set(['view', 'export']);

/**
 * Permission actions that require `:write` scope.
 */
const WRITE_ACTIONS = new Set(['create', 'update', 'delete', 'manage']);

/**
 * Map a permission slug (e.g. "clients.view") to the required scope
 * (e.g. "clients:read").
 *
 * @param {string} permissionSlug — e.g. "clients.view", "invoices.create"
 * @returns {{ resource: string, access: string } | null}
 */
function permissionToScope(permissionSlug) {
  const dotIndex = permissionSlug.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const resource = permissionSlug.substring(0, dotIndex);
  const action = permissionSlug.substring(dotIndex + 1);

  if (READ_ACTIONS.has(action)) {
    return { resource, access: ACCESS_READ };
  }
  if (WRITE_ACTIONS.has(action)) {
    return { resource, access: ACCESS_WRITE };
  }
  if (action === ACCESS_INGEST) {
    return { resource, access: ACCESS_INGEST };
  }

  // Unknown action — treat as write for safety
  return { resource, access: ACCESS_WRITE };
}

/**
 * Check whether a set of scopes grants the required scope.
 *
 * Rules:
 *  - SQL `null` scopes → unrestricted (legacy compatibility)
 *  - empty or malformed scope values → deny all
 *  - `*:write` → grants everything
 *  - `*:read` → grants read on all resources
 *  - `resource:write` → grants both read and write on that resource
 *  - `resource:read` → grants read only on that resource
 *
 * @param {string[]|null} scopes — the token's scope array (from DB JSON column)
 * @param {string} requiredResource — e.g. "clients"
 * @param {string} requiredAccess — "read" or "write"
 * @returns {boolean}
 */
function hasScope(scopes, requiredResource, requiredAccess) {
  // null/undefined scopes = unrestricted
  if (scopes === null || scopes === undefined) return true;
  if (!Array.isArray(scopes) || scopes.length === 0) return false;

  for (const scope of scopes) {
    const colonIndex = scope.indexOf(':');
    if (colonIndex === -1) continue;

    const scopeResource = scope.substring(0, colonIndex);
    const scopeAccess = scope.substring(colonIndex + 1);

    // Collector ingest is intentionally never implied by wildcard or ordinary
    // write authority. A credential must name the exact resource:ingest scope.
    if (requiredAccess === ACCESS_INGEST) {
      if (scopeResource === requiredResource && scopeAccess === ACCESS_INGEST) return true;
      continue;
    }

    // Wildcard write grants ordinary read/write access (not collector ingest).
    if (scopeResource === '*' && scopeAccess === ACCESS_WRITE) return true;

    // Wildcard read grants all read access
    if (scopeResource === '*' && scopeAccess === ACCESS_READ && requiredAccess === ACCESS_READ) return true;

    // Exact resource match
    if (scopeResource === requiredResource) {
      // Write scope implies read
      if (scopeAccess === ACCESS_WRITE) return true;
      // Read scope only satisfies read requirements
      if (scopeAccess === ACCESS_READ && requiredAccess === ACCESS_READ) return true;
    }
  }

  return false;
}

/**
 * Check whether an API token's scopes allow a given permission slug.
 *
 * @param {string[]|null} scopes — the token's scope array
 * @param {string} permissionSlug — e.g. "clients.view"
 * @returns {boolean}
 */
function scopeAllowsPermission(scopes, permissionSlug) {
  // Unrestricted tokens
  if (scopes === null || scopes === undefined) return true;
  if (!Array.isArray(scopes) || scopes.length === 0) return false;

  const required = permissionToScope(permissionSlug);
  if (!required) return false;

  return hasScope(scopes, required.resource, required.access);
}

/**
 * Parse a scope string and check if it is valid.
 *
 * @param {string} scope — e.g. "clients:read"
 * @returns {boolean}
 */
function isValidScope(scope) {
  if (typeof scope !== 'string') return false;

  const colonIndex = scope.indexOf(':');
  if (colonIndex === -1) return false;

  const resource = scope.substring(0, colonIndex);
  const access = scope.substring(colonIndex + 1);

  if (access === ACCESS_INGEST) return INGEST_RESOURCES.has(resource);
  if (access !== ACCESS_READ && access !== ACCESS_WRITE) return false;
  if (resource === '*') return true;
  return VALID_RESOURCES.includes(resource);
}

/**
 * Validate an array of scopes.
 *
 * @param {*} scopes
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateScopes(scopes) {
  if (scopes === null || scopes === undefined) {
    return { valid: true, errors: [] };
  }

  if (!Array.isArray(scopes)) {
    return { valid: false, errors: ['Scopes must be a JSON array or null'] };
  }

  const errors = [];
  const seen = new Set();

  for (const scope of scopes) {
    if (typeof scope !== 'string') {
      errors.push(`Invalid scope value: ${JSON.stringify(scope)} (must be a string)`);
      continue;
    }
    if (!isValidScope(scope)) {
      errors.push(`Invalid scope: "${scope}". Format: "resource:read" or "resource:write"`);
      continue;
    }
    if (seen.has(scope)) {
      errors.push(`Duplicate scope: "${scope}"`);
      continue;
    }
    seen.add(scope);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Return the full list of available scopes for documentation / UI.
 *
 * @returns {Array<{ scope: string, description: string }>}
 */
function listAvailableScopes() {
  const scopes = [
    { scope: '*:read', description: 'Read-only access to all resources' },
    { scope: '*:write', description: 'Full read-write access to all resources' },
  ];

  for (const resource of VALID_RESOURCES) {
    scopes.push({
      scope: `${resource}:read`,
      description: `Read-only access to ${resource.replace(/_/g, ' ')}`,
    });
    scopes.push({
      scope: `${resource}:write`,
      description: `Read-write access to ${resource.replace(/_/g, ' ')}`,
    });
  }
  for (const resource of INGEST_RESOURCES) {
    scopes.push({
      scope: `${resource}:ingest`,
      description: `Collector-only ingest access to ${resource.replace(/_/g, ' ')}`,
    });
  }

  return scopes;
}

module.exports = {
  VALID_RESOURCES,
  ACCESS_READ,
  ACCESS_WRITE,
  ACCESS_INGEST,
  permissionToScope,
  hasScope,
  scopeAllowsPermission,
  isValidScope,
  validateScopes,
  listAvailableScopes,
};
