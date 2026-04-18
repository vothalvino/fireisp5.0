// =============================================================================
// FireISP 5.0 — API Token Scope Tests
// =============================================================================

const {
  VALID_RESOURCES,
  ACCESS_READ,
  ACCESS_WRITE,
  permissionToScope,
  hasScope,
  scopeAllowsPermission,
  isValidScope,
  validateScopes,
  listAvailableScopes,
} = require('../src/utils/scopes');

// =============================================================================
// permissionToScope
// =============================================================================
describe('permissionToScope', () => {
  test('maps .view to :read', () => {
    expect(permissionToScope('clients.view')).toEqual({ resource: 'clients', access: 'read' });
  });

  test('maps .export to :read', () => {
    expect(permissionToScope('invoices.export')).toEqual({ resource: 'invoices', access: 'read' });
  });

  test('maps .create to :write', () => {
    expect(permissionToScope('clients.create')).toEqual({ resource: 'clients', access: 'write' });
  });

  test('maps .update to :write', () => {
    expect(permissionToScope('invoices.update')).toEqual({ resource: 'invoices', access: 'write' });
  });

  test('maps .delete to :write', () => {
    expect(permissionToScope('devices.delete')).toEqual({ resource: 'devices', access: 'write' });
  });

  test('maps .manage to :write', () => {
    expect(permissionToScope('roles.manage')).toEqual({ resource: 'roles', access: 'write' });
  });

  test('maps unknown actions to :write for safety', () => {
    expect(permissionToScope('clients.purge')).toEqual({ resource: 'clients', access: 'write' });
  });

  test('returns null for invalid slug without dot', () => {
    expect(permissionToScope('nopermission')).toBeNull();
  });

  test('handles resource names with underscores', () => {
    expect(permissionToScope('credit_notes.view')).toEqual({ resource: 'credit_notes', access: 'read' });
  });
});

// =============================================================================
// hasScope
// =============================================================================
describe('hasScope', () => {
  test('null scopes → unrestricted', () => {
    expect(hasScope(null, 'clients', 'read')).toBe(true);
    expect(hasScope(null, 'clients', 'write')).toBe(true);
  });

  test('undefined scopes → unrestricted', () => {
    expect(hasScope(undefined, 'clients', 'read')).toBe(true);
  });

  test('empty array → unrestricted', () => {
    expect(hasScope([], 'clients', 'write')).toBe(true);
  });

  test('non-array → unrestricted', () => {
    expect(hasScope('not-an-array', 'clients', 'read')).toBe(true);
  });

  test('exact read scope matches read', () => {
    expect(hasScope(['clients:read'], 'clients', 'read')).toBe(true);
  });

  test('read scope does NOT grant write', () => {
    expect(hasScope(['clients:read'], 'clients', 'write')).toBe(false);
  });

  test('write scope grants read (implied)', () => {
    expect(hasScope(['clients:write'], 'clients', 'read')).toBe(true);
  });

  test('write scope grants write', () => {
    expect(hasScope(['clients:write'], 'clients', 'write')).toBe(true);
  });

  test('scope for different resource does not match', () => {
    expect(hasScope(['invoices:write'], 'clients', 'read')).toBe(false);
  });

  test('wildcard read grants read on any resource', () => {
    expect(hasScope(['*:read'], 'clients', 'read')).toBe(true);
    expect(hasScope(['*:read'], 'invoices', 'read')).toBe(true);
  });

  test('wildcard read does NOT grant write', () => {
    expect(hasScope(['*:read'], 'clients', 'write')).toBe(false);
  });

  test('wildcard write grants everything', () => {
    expect(hasScope(['*:write'], 'clients', 'read')).toBe(true);
    expect(hasScope(['*:write'], 'clients', 'write')).toBe(true);
    expect(hasScope(['*:write'], 'invoices', 'write')).toBe(true);
  });

  test('multiple scopes — any match succeeds', () => {
    const scopes = ['clients:read', 'invoices:write'];
    expect(hasScope(scopes, 'clients', 'read')).toBe(true);
    expect(hasScope(scopes, 'invoices', 'write')).toBe(true);
    expect(hasScope(scopes, 'invoices', 'read')).toBe(true); // write implies read
    expect(hasScope(scopes, 'clients', 'write')).toBe(false); // only read granted
    expect(hasScope(scopes, 'devices', 'read')).toBe(false); // not in scopes
  });

  test('ignores malformed scopes without colon', () => {
    expect(hasScope(['badscope'], 'clients', 'read')).toBe(false);
  });
});

// =============================================================================
// scopeAllowsPermission
// =============================================================================
describe('scopeAllowsPermission', () => {
  test('null scopes allows everything', () => {
    expect(scopeAllowsPermission(null, 'clients.view')).toBe(true);
    expect(scopeAllowsPermission(null, 'clients.create')).toBe(true);
  });

  test('empty array allows everything', () => {
    expect(scopeAllowsPermission([], 'clients.view')).toBe(true);
  });

  test('clients:read allows clients.view', () => {
    expect(scopeAllowsPermission(['clients:read'], 'clients.view')).toBe(true);
  });

  test('clients:read allows clients.export', () => {
    expect(scopeAllowsPermission(['clients:read'], 'clients.export')).toBe(true);
  });

  test('clients:read denies clients.create', () => {
    expect(scopeAllowsPermission(['clients:read'], 'clients.create')).toBe(false);
  });

  test('clients:read denies clients.update', () => {
    expect(scopeAllowsPermission(['clients:read'], 'clients.update')).toBe(false);
  });

  test('clients:read denies clients.delete', () => {
    expect(scopeAllowsPermission(['clients:read'], 'clients.delete')).toBe(false);
  });

  test('clients:write allows clients.view', () => {
    expect(scopeAllowsPermission(['clients:write'], 'clients.view')).toBe(true);
  });

  test('clients:write allows clients.create', () => {
    expect(scopeAllowsPermission(['clients:write'], 'clients.create')).toBe(true);
  });

  test('*:read allows any .view permission', () => {
    expect(scopeAllowsPermission(['*:read'], 'invoices.view')).toBe(true);
    expect(scopeAllowsPermission(['*:read'], 'devices.export')).toBe(true);
  });

  test('*:read denies any .create permission', () => {
    expect(scopeAllowsPermission(['*:read'], 'invoices.create')).toBe(false);
  });

  test('returns false for invalid permission slug', () => {
    expect(scopeAllowsPermission(['clients:read'], 'nopermission')).toBe(false);
  });
});

// =============================================================================
// isValidScope
// =============================================================================
describe('isValidScope', () => {
  test('valid resource:read', () => {
    expect(isValidScope('clients:read')).toBe(true);
  });

  test('valid resource:write', () => {
    expect(isValidScope('invoices:write')).toBe(true);
  });

  test('valid wildcard:read', () => {
    expect(isValidScope('*:read')).toBe(true);
  });

  test('valid wildcard:write', () => {
    expect(isValidScope('*:write')).toBe(true);
  });

  test('invalid access level', () => {
    expect(isValidScope('clients:admin')).toBe(false);
  });

  test('unknown resource', () => {
    expect(isValidScope('nonexistent:read')).toBe(false);
  });

  test('missing colon', () => {
    expect(isValidScope('clientsread')).toBe(false);
  });

  test('non-string', () => {
    expect(isValidScope(123)).toBe(false);
    expect(isValidScope(null)).toBe(false);
  });

  test('all VALID_RESOURCES are accepted', () => {
    for (const res of VALID_RESOURCES) {
      expect(isValidScope(`${res}:read`)).toBe(true);
      expect(isValidScope(`${res}:write`)).toBe(true);
    }
  });
});

// =============================================================================
// validateScopes
// =============================================================================
describe('validateScopes', () => {
  test('null is valid (unrestricted)', () => {
    expect(validateScopes(null)).toEqual({ valid: true, errors: [] });
  });

  test('undefined is valid (unrestricted)', () => {
    expect(validateScopes(undefined)).toEqual({ valid: true, errors: [] });
  });

  test('non-array is invalid', () => {
    const result = validateScopes('clients:read');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  test('valid scopes array passes', () => {
    const result = validateScopes(['clients:read', 'invoices:write']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('detects invalid scope format', () => {
    const result = validateScopes(['clients:read', 'badscope']);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('detects duplicate scopes', () => {
    const result = validateScopes(['clients:read', 'clients:read']);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Duplicate')]),
    );
  });

  test('detects non-string elements', () => {
    const result = validateScopes([123, 'clients:read']);
    expect(result.valid).toBe(false);
  });

  test('empty array is valid', () => {
    expect(validateScopes([])).toEqual({ valid: true, errors: [] });
  });

  test('detects unknown resource', () => {
    const result = validateScopes(['fake_resource:read']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid scope');
  });
});

// =============================================================================
// listAvailableScopes
// =============================================================================
describe('listAvailableScopes', () => {
  test('returns array of scope objects', () => {
    const scopes = listAvailableScopes();
    expect(Array.isArray(scopes)).toBe(true);
    expect(scopes.length).toBe(2 + VALID_RESOURCES.length * 2); // 2 wildcards + 2 per resource
  });

  test('first two entries are wildcards', () => {
    const scopes = listAvailableScopes();
    expect(scopes[0].scope).toBe('*:read');
    expect(scopes[1].scope).toBe('*:write');
  });

  test('each scope has scope and description properties', () => {
    const scopes = listAvailableScopes();
    for (const s of scopes) {
      expect(s).toHaveProperty('scope');
      expect(s).toHaveProperty('description');
      expect(typeof s.scope).toBe('string');
      expect(typeof s.description).toBe('string');
    }
  });
});
